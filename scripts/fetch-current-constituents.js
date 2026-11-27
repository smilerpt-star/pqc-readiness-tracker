#!/usr/bin/env node
/**
 * fetch-current-constituents.js
 *
 * Builds CURRENT constituent lists for stock indices from the constituent tables
 * on English Wikipedia (kept up to date, unlike Wikidata "part of", which also
 * returns former members), then resolves each company's official website via
 * Wikidata (P856) using the exact article -> QID link.
 *
 * It then matches every constituent against the domains already tracked
 * (via the public API) so existing companies are reused instead of duplicated:
 *   1. exact domain match (normalised, www. stripped)
 *   2. company-name match (normalised) — catches e.g. unicreditgroup.eu vs unicredit.it
 *
 * READ-ONLY: never writes to the database.
 *
 * Usage:  node scripts/fetch-current-constituents.js [key ...]
 * Output: scripts/indices/current/<key>.csv   (rank,domain,company_name,country,sector,index,match)
 *         scripts/indices/current/report.txt  (entries / exits / new / missing per index)
 */

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.PQC_API_BASE || 'https://pqc-readiness-tracker-production.up.railway.app';
const OUT_DIR = path.join(__dirname, 'indices', 'current');
const UA = { 'User-Agent': 'PQCReadinessTracker/1.0 (index constituent sync)' };

// page = Wikipedia article; size = expected member count (to pick the right table);
// dbIndexId = id in the `indexes` table if this index is already tracked.
const INDICES = [
  { key: 'sp500',        name: 'S&P 500',       page: 'List of S&P 500 companies', size: 503, country: 'United States', dbIndexId: 2 },
  { key: 'ftse100',      name: 'FTSE 100',      page: 'FTSE 100 Index',            size: 100 },
  { key: 'dax',          name: 'DAX',           page: 'DAX',                       size: 40  },
  { key: 'cac40',        name: 'CAC 40',        page: 'CAC 40',                    size: 40  },
  { key: 'ibex35',       name: 'IBEX 35',       page: 'IBEX 35',                   size: 35  },
  { key: 'euro-stoxx50', name: 'Euro Stoxx 50', page: 'EURO STOXX 50',             size: 50  },
];

const COMPANY_COL = /^(security|company|name|constituent)$/i;
const SECTOR_COL = /sector/i;

const SECTOR_MAP = [
  [['bank', 'financ', 'invest', 'asset management', 'capital market', 'brokerage', 'wealth', 'exchange'], 'Banking & Finance'],
  [['insur'], 'Insurance'],
  [['software', 'technology', 'semiconductor', 'electronic', 'computer', 'internet', 'information'], 'Technology'],
  [['telecom', 'communication', 'wireless', 'broadband'], 'Telecommunications'],
  [['oil', 'gas', 'petroleum', 'energy', 'utilit', 'power', 'renewable', 'mining', 'coal'], 'Energy & Utilities'],
  [['retail', 'consumer', 'food', 'beverage', 'restaurant', 'luxury', 'personal', 'household', 'tobacco'], 'Retail & Consumer'],
  [['health', 'pharma', 'hospital', 'medical', 'biotech', 'drug'], 'Healthcare'],
  [['media', 'entertainment', 'publishing', 'broadcast'], 'Media & Entertainment'],
  [['transport', 'logistics', 'airline', 'shipping', 'rail', 'freight', 'automo', 'travel'], 'Transportation & Logistics'],
  [['aerospace', 'defence', 'defense'], 'Defence & Security'],
  [['construction', 'infrastructure', 'real estate', 'property', 'reit'], 'Real Estate & Infrastructure'],
  [['chemical', 'material', 'steel', 'metal', 'packaging', 'paper'], 'Materials & Chemicals'],
  [['industrial', 'engineering', 'machinery', 'conglomerate'], 'Industrials'],
];

function mapSector(label) {
  if (!label) return 'Other';
  const l = label.toLowerCase();
  for (const [kws, sector] of SECTOR_MAP) if (kws.some((k) => l.includes(k))) return sector;
  return 'Other';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normDomain = (d) => String(d || '').toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\d?\./, '').split(/[/?#]/)[0].replace(/\.$/, '');
const normName = (n) => String(n || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&amp;/g, '&').replace(/[.,'’()]/g, ' ')
  .replace(/\b(the|plc|ag|sa|se|nv|n v|spa|s p a|inc|incorporated|corp|corporation|co|company|group|holdings?|ltd|limited|kgaa|& co|sociedad anonima|s a)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const stripTags = (h) => h.replace(/<[^>]+>/g, '').replace(/&#91;.*?&#93;/g, '').replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').trim();
const csvEsc = (s) => (s == null || s === '' ? '' : '"' + String(s).replace(/"/g, '""') + '"');

async function getJson(url) {
  // Polite: sequential requests, honour Retry-After, exponential backoff on 429/5xx.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { ...UA, Accept: 'application/json' } });
    if (res.ok) { await sleep(1000); return res.json(); }
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const wait = Math.max(retryAfter * 1000, 5000 * 2 ** attempt);
    console.warn(`  [http ${res.status}] waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/6)`);
    await res.text();
    await sleep(wait);
  }
  throw new Error(`GET failed: ${url.slice(0, 120)}`);
}

// ── 1. Wikipedia constituent table ───────────────────────────────────────────
async function fetchConstituents(idx) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&prop=text&page=${encodeURIComponent(idx.page)}`;
  const html = (await getJson(url)).parse?.text?.['*'] || '';
  const tables = [...html.matchAll(/<table[^>]*wikitable[^>]*>([\s\S]*?)<\/table>/g)].map((m) => m[1]);

  let best = null;
  for (const t of tables) {
    const rows = t.split(/<tr[^>]*>/).slice(1);
    const header = (rows[0].match(/<th[^>]*>[\s\S]*?(?=<th|$)/g) || []).map(stripTags);
    const ci = header.findIndex((h) => COMPANY_COL.test(h));
    if (ci < 0) continue;
    const dataRows = rows.slice(1).filter((r) => /<td/.test(r));
    const diff = Math.abs(dataRows.length - idx.size);
    if (!best || diff < best.diff) best = { header, ci, si: header.findIndex((h) => SECTOR_COL.test(h)), dataRows, diff };
  }
  if (!best || best.diff > idx.size * 0.15) throw new Error(`${idx.name}: no constituent table matching ~${idx.size} rows`);

  return best.dataRows.map((r, i) => {
    // Cells: header-less rows use <td>; some tables put the company in a <th scope=row>.
    const cells = r.match(/<t[dh][^>]*>[\s\S]*?(?=<t[dh][^>]*>|$)/g) || [];
    const cell = cells[best.ci] || '';
    const link = [...cell.matchAll(/<a href="\/wiki\/([^"#]+)"[^>]*>/g)].map((m) => decodeURIComponent(m[1]))
      .find((t) => !/^(File|Image|Help|Wikipedia):/i.test(t));
    return {
      rank: i + 1,
      company_name: stripTags(cell),
      wiki_title: link ? link.replace(/_/g, ' ') : null,
      sector_label: best.si >= 0 ? stripTags(cells[best.si] || '') : '',
    };
  }).filter((r) => r.company_name);
}

// ── 2. Wikipedia titles -> Wikidata QIDs ─────────────────────────────────────
async function titlesToQids(titles) {
  const map = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(chunk.join('|'))}`;
    const j = await getJson(url);
    const alias = new Map();
    for (const n of j.query?.normalized || []) alias.set(n.to, n.from);
    for (const r of j.query?.redirects || []) alias.set(r.to, alias.get(r.from) || r.from);
    for (const p of Object.values(j.query?.pages || {})) {
      const qid = p.pageprops?.wikibase_item;
      if (!qid) continue;
      map.set(p.title, qid);
      if (alias.has(p.title)) map.set(alias.get(p.title), qid);
    }
    await sleep(300);
  }
  return map;
}

// ── 3. QIDs -> official website + country (Wikidata) ─────────────────────────
async function qidsToWebsites(qids) {
  const out = new Map();
  for (let i = 0; i < qids.length; i += 150) {
    const values = qids.slice(i, i + 150).map((q) => `wd:${q}`).join(' ');
    const sparql = `
SELECT ?company ?website ?rank ?countryLabel WHERE {
  VALUES ?company { ${values} }
  OPTIONAL { ?company p:P856 ?st. ?st ps:P856 ?website; wikibase:rank ?rank.
             FILTER(?rank != wikibase:DeprecatedRank) }
  OPTIONAL { ?company wdt:P17 ?country. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const j = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`);
    for (const b of j.results.bindings) {
      const q = b.company.value.split('/').pop();
      const cur = out.get(q) || { websites: [], country: '' };
      if (b.website) cur.websites.push({ url: b.website.value, preferred: /PreferredRank$/.test(b.rank?.value || '') });
      if (!cur.country && b.countryLabel) cur.country = b.countryLabel.value;
      out.set(q, cur);
    }
    await sleep(800);
  }
  for (const v of out.values()) {
    const sorted = v.websites.sort((a, b) => Number(b.preferred) - Number(a.preferred));
    v.domain = sorted.length ? normDomain(sorted[0].url) : '';
    v.alternatives = [...new Set(sorted.map((w) => normDomain(w.url)))];
  }
  return out;
}

// ── 4. Current tracked state (public API, read-only) ─────────────────────────
async function loadTracked() {
  const unwrap = (j) => (Array.isArray(j) ? j : j.data || []);
  const domains = unwrap(await getJson(`${API_BASE}/domains`));
  const byDomain = new Map(domains.map((d) => [normDomain(d.domain), d]));
  const byName = new Map();
  for (const d of domains) {
    const k = normName(d.company_name);
    if (k) byName.set(k, d);
  }
  const membership = new Map();
  for (const idx of INDICES.filter((x) => x.dbIndexId)) {
    const rows = unwrap(await getJson(`${API_BASE}/indexes/${idx.dbIndexId}/domains`));
    membership.set(idx.key, rows.map((r) => (typeof r.domain === 'object' ? r.domain : r)));
  }
  return { domains, byDomain, byName, membership };
}

async function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? INDICES.filter((i) => only.includes(i.key)) : INDICES;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Loading tracked domains from API…');
  const tracked = await loadTracked();
  console.log(`  ${tracked.domains.length} domains tracked\n`);

  const report = [`Generated ${new Date().toISOString()}`, ''];

  for (const idx of targets) {
    console.log(`== ${idx.name}`);
    const members = await fetchConstituents(idx);
    const qmap = await titlesToQids([...new Set(members.map((m) => m.wiki_title).filter(Boolean))]);
    const wmap = await qidsToWebsites([...new Set([...qmap.values()])]);

    const rows = members.map((m) => {
      const qid = m.wiki_title ? qmap.get(m.wiki_title) : null;
      const wd = qid ? wmap.get(qid) : null;
      const candidates = wd?.alternatives || [];
      // Prefer an already-tracked domain: exact domain (any alternative), then company name.
      let existing = candidates.map((d) => tracked.byDomain.get(d)).find(Boolean);
      let match = existing ? 'domain' : null;
      if (!existing) {
        existing = tracked.byName.get(normName(m.company_name)) || tracked.byName.get(normName(m.wiki_title));
        if (existing) match = 'name';
      }
      const domain = existing ? normDomain(existing.domain) : (wd?.domain || '');
      return {
        rank: m.rank,
        domain,
        company_name: existing?.company_name || m.company_name,
        country: existing?.country || wd?.country || idx.country || '',
        sector: existing?.sector || mapSector(m.sector_label),
        index: idx.name,
        match: match || (domain ? 'new' : 'missing'),
        qid: qid || '',
      };
    });

    // Same company listed twice (dual listings / share classes) -> keep first.
    const seen = new Set();
    const unique = rows.filter((r) => {
      const k = r.domain || `missing:${normName(r.company_name)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const header = 'rank,domain,company_name,country,sector,index,match,qid';
    const body = unique.map((r) => [r.rank, r.domain, csvEsc(r.company_name), csvEsc(r.country), csvEsc(r.sector), csvEsc(r.index), r.match, r.qid].join(','));
    fs.writeFileSync(path.join(OUT_DIR, `${idx.key}.csv`), [header, ...body].join('\n') + '\n');

    const count = (m) => unique.filter((r) => r.match === m).length;
    const lines = [
      `== ${idx.name}: ${members.length} rows on Wikipedia, ${unique.length} unique companies`,
      `   already tracked: ${count('domain')} by domain + ${count('name')} by name | new: ${count('new')} | no website found: ${count('missing')}`,
    ];

    if (tracked.membership.has(idx.key)) {
      const cur = new Set(unique.map((r) => r.domain).filter(Boolean));
      const linked = tracked.membership.get(idx.key);
      const linkedSet = new Set(linked.map((d) => normDomain(d.domain)));
      const entered = unique.filter((r) => r.domain && !linkedSet.has(r.domain));
      const exited = linked.filter((d) => !cur.has(normDomain(d.domain)));
      lines.push(`   ENTERED since last import: ${entered.length} -> ${entered.map((r) => `${r.company_name} (${r.domain})`).join('; ') || '-'}`);
      lines.push(`   EXITED since last import:  ${exited.length} -> ${exited.map((d) => `${d.company_name} (${d.domain})`).join('; ') || '-'}`);
    }
    const missing = unique.filter((r) => r.match === 'missing');
    if (missing.length) lines.push(`   no website: ${missing.map((r) => r.company_name).join('; ')}`);
    const byName = unique.filter((r) => r.match === 'name');
    if (byName.length) lines.push(`   matched by NAME (review): ${byName.map((r) => `${r.company_name} -> ${r.domain}`).join('; ')}`);

    lines.forEach((l) => console.log(l));
    report.push(...lines, '');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'report.txt'), report.join('\n'));
  console.log(`\nWrote ${OUT_DIR}/<key>.csv and report.txt`);
}

main().catch((e) => { console.error(e); process.exit(1); });
