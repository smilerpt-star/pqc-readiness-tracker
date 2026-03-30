#!/usr/bin/env node
/**
 * fetch-stoxx600.js
 *
 * Fetches the STOXX Europe 600 constituent list from Wikipedia (maintained quarterly)
 * and enriches each company with its official domain from Wikidata.
 *
 * Pipeline:
 *   1. Wikipedia API → parse STOXX 600 "Index components" table
 *      (ticker, company wiki-link, ICB sector, country)
 *   2. Wikipedia API → resolve each company article → Wikidata QID
 *   3. Wikidata SPARQL → batch P856 (website) for all QIDs
 *   4. Output CSV ready for Admin → Indexes → Import
 *
 * No API key required. Fully replicable.
 *
 * Output:
 *   scripts/indices/stoxx600.csv
 *   scripts/indices/stoxx600-missing.csv
 */

const fs   = require('fs');
const path = require('path');

const OUT_DIR  = path.join(__dirname, 'indices');
const OUT_FILE = path.join(OUT_DIR, 'stoxx600.csv');
const MISS_FILE= path.join(OUT_DIR, 'stoxx600-missing.csv');
const DELAY_MS = 150;
const WD_BATCH = 50; // QIDs per Wikidata query

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function csvEscape(s) { return s ? '"' + String(s).replace(/"/g, '""') + '"' : ''; }
function cleanDomain(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].toLowerCase().trim();
}

// ── ICB → internal sector mapping ────────────────────────────────────────────
const ICB_MAP = {
  'Technology':                          'Technology',
  'Health Care':                         'Healthcare',
  'Consumer Products and Services':      'Retail & Consumer',
  'Food, Beverage and Tobacco':          'Retail & Consumer',
  'Personal Care Drug And Grocery Stores': 'Retail & Consumer',
  'Insurance':                           'Insurance',
  'Banks':                               'Banking & Finance',
  'Financial Services':                  'Banking & Finance',
  'Industrial Goods and Services':       'Transportation & Logistics',
  'Energy':                              'Energy & Utilities',
  'Utilities':                           'Energy & Utilities',
  'Telecommunications':                  'Telecommunications',
  'Media':                               'Media & Entertainment',
  'Chemicals':                           'Materials & Chemicals',
  'Basic Resources':                     'Materials & Chemicals',
  'Construction And Materials':          'Real Estate & Infrastructure',
  'Real Estate':                         'Real Estate & Infrastructure',
  'Automobiles And Parts':               'Transportation & Logistics',
  'Travel And Leisure':                  'Retail & Consumer',
};
function mapSector(icb) { return ICB_MAP[icb?.trim()] || 'Other'; }

// ── Step 1: Parse Wikipedia wikitext ─────────────────────────────────────────
async function fetchWikipediaComponents() {
  process.stdout.write('Fetching Wikipedia STOXX 600 components… ');
  const url = 'https://en.wikipedia.org/w/api.php?action=parse&page=STOXX_Europe_600&prop=wikitext&section=3&format=json';
  const res = await fetch(url, { headers: { 'User-Agent': 'PQCReadinessTracker/1.0' } });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  const j = await res.json();
  const wt = j.parse?.wikitext?.['*'] || '';

  // Parse table rows: | TICKER || [[Company]] || ICB Sector || {{flag|Country}} || [[City]]
  const rows = [];
  const lines = wt.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.startsWith('|!') || line.startsWith('|-') || line.startsWith('|}')) continue;
    const cols = line.split('||').map(c => c.replace(/^\s*\|?\s*/, '').trim());
    if (cols.length < 4) continue;

    // Company: first [[Link]] in col 1
    const compMatch = cols[1].match(/\[\[([^\]|#]+?)(?:\|[^\]]*?)?\]\]/);
    if (!compMatch) continue;
    const wikiTitle = compMatch[1].trim();

    // Country: {{flag|Country}}
    const countryMatch = cols[3].match(/\{\{flag\|([^}]+)\}\}/);
    const country = countryMatch ? countryMatch[1] : '';

    // ICB sector: col 2
    const icbSector = cols[2].replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim();

    rows.push({ wikiTitle, company_name: wikiTitle, country, sector: mapSector(icbSector), icbSector });
  }

  console.log(`${rows.length} companies`);
  return rows;
}

// ── Step 2: Resolve Wikipedia titles → Wikidata QIDs ─────────────────────────
async function resolveQids(rows) {
  process.stdout.write(`Resolving ${rows.length} Wikipedia articles to Wikidata QIDs… `);
  const CHUNK = 50;
  const qidMap = {}; // wikiTitle → QID

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const titles = chunk.map(r => r.wikiTitle).join('|');
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageprops&ppprop=wikibase_item&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'PQCReadinessTracker/1.0' } });
    if (!res.ok) { console.warn(`  Wikipedia batch ${i} failed`); continue; }
    const j = await res.json();
    const pages = j.query?.pages || {};
    for (const page of Object.values(pages)) {
      const qid = page.pageprops?.wikibase_item;
      const title = page.title;
      if (qid && title) qidMap[title] = qid;
    }
    await sleep(DELAY_MS);
    process.stdout.write('.');
  }

  // Fallback: Wikidata label search for unresolved titles
  const unresolved = rows.filter(r => !qidMap[r.wikiTitle]);
  if (unresolved.length > 0) {
    process.stdout.write(`\n  Label search fallback for ${unresolved.length} unresolved… `);
    for (const row of unresolved) {
      try {
        const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(row.wikiTitle)}&language=en&type=item&limit=1&format=json`;
        const res = await fetch(url, { headers: { 'User-Agent': 'PQCReadinessTracker/1.0' } });
        if (!res.ok) continue;
        const j = await res.json();
        const hit = j.search?.[0];
        if (hit?.id) qidMap[row.wikiTitle] = hit.id;
        await sleep(100);
      } catch { /* skip */ }
    }
    process.stdout.write(`done\n`);
  }

  console.log(`  Total resolved: ${Object.keys(qidMap).length}`);
  return qidMap;
}

// ── Step 3: Batch Wikidata P856 (website) lookup ──────────────────────────────
async function fetchDomains(qids) {
  process.stdout.write(`Fetching domains for ${qids.length} QIDs from Wikidata… `);
  const domainMap = {}; // QID → domain

  for (let i = 0; i < qids.length; i += WD_BATCH) {
    const chunk = qids.slice(i, i + WD_BATCH);
    const values = chunk.map(q => `wd:${q}`).join(' ');
    // Preferred rank first; any rank as fallback within same query
    const sparql = `
SELECT ?company ?website (IF(EXISTS { ?company p:P856 [ps:P856 ?website; wikibase:rank wikibase:PreferredRank] }, 1, 0) AS ?pref) WHERE {
  VALUES ?company { ${values} }
  ?company wdt:P856 ?website.
} ORDER BY DESC(?pref)`;
    try {
      const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
      const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'PQCReadinessTracker/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      for (const b of j.results.bindings) {
        const qid = b.company.value.split('/').pop();
        if (b.website?.value && !domainMap[qid]) {
          domainMap[qid] = cleanDomain(b.website.value);
        }
      }
    } catch (e) { console.warn(`  Batch ${i} failed: ${e.message}`); }
    await sleep(400);
    process.stdout.write('.');
  }

  console.log(`\n  ${Object.keys(domainMap).length} domains found`);
  return domainMap;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== STOXX Europe 600 Domain Fetcher ===\n');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Step 1: Get company list from Wikipedia
  const rows = await fetchWikipediaComponents();

  // Step 2: Resolve Wikipedia articles → QIDs
  const qidMap = await resolveQids(rows);

  // Attach QIDs to rows
  for (const row of rows) {
    row.qid = qidMap[row.wikiTitle] || null;
  }
  const withQid = rows.filter(r => r.qid);
  const noQid   = rows.filter(r => !r.qid);
  console.log(`  With QID: ${withQid.length} | No QID: ${noQid.length}`);

  // Step 3: Batch fetch domains
  const allQids = [...new Set(withQid.map(r => r.qid))];
  const domainMap = await fetchDomains(allQids);

  // Attach domains
  for (const row of withQid) {
    row.domain = domainMap[row.qid] || '';
  }

  // Final split
  const withDomain    = withQid.filter(r => r.domain && r.domain.includes('.'));
  const withoutDomain = [
    ...withQid.filter(r => !r.domain || !r.domain.includes('.')),
    ...noQid,
  ];

  console.log(`\nResults: ${withDomain.length} with domain | ${withoutDomain.length} missing`);
  console.log(`Coverage: ${Math.round(withDomain.length / rows.length * 100)}%`);

  // Write main CSV
  const sorted = withDomain.sort((a, b) => a.company_name.localeCompare(b.company_name));
  const csvLines = [
    'rank,domain,company_name,country,sector',
    ...sorted.map((r, i) => [i + 1, r.domain, csvEscape(r.company_name), csvEscape(r.country), csvEscape(r.sector)].join(',')),
  ];
  fs.writeFileSync(OUT_FILE, csvLines.join('\n'));
  console.log(`✓ ${sorted.length} companies → indices/stoxx600.csv`);

  // Write missing CSV
  if (withoutDomain.length > 0) {
    const missLines = [
      'company_name,country,sector,qid',
      ...withoutDomain.map(r => [csvEscape(r.company_name), csvEscape(r.country), csvEscape(r.sector), r.qid || ''].join(',')),
    ];
    fs.writeFileSync(MISS_FILE, missLines.join('\n'));
    console.log(`  ${withoutDomain.length} missing → indices/stoxx600-missing.csv`);
  }

  // Sector breakdown
  const bySector = {};
  withDomain.forEach(r => { bySector[r.sector] = (bySector[r.sector] || 0) + 1; });
  console.log('\nBy sector:');
  Object.entries(bySector).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}  ${s}`));

  console.log('\nDone. Upload scripts/indices/stoxx600.csv in Admin → Indexes.');
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
