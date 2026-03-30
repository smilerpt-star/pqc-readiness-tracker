#!/usr/bin/env node
/**
 * fetch-stock-indices.js
 *
 * Fetches constituents + official domains for major stock market indices via Wikidata.
 * Uses wdt:P361 (part of) for index membership and wdt:P856 (website) for domains.
 *
 * Indices covered (Wikidata P361 well-maintained):
 *   S&P 500       Q242345  ~500 US companies
 *   FTSE 100      Q466496  ~100 UK companies
 *   DAX           Q155718  ~40  German companies
 *   CAC 40        Q648828  ~40  French companies
 *   Euro Stoxx 50 Q981010  ~50  Eurozone blue-chips
 *   IBEX 35       Q938032  ~35  Spanish companies
 *
 * No API key required. SEC EDGAR used as fallback for S&P 500 missing domains.
 *
 * Output:
 *   scripts/indices/<key>.csv        — one CSV per index
 *   scripts/indices/combined.csv     — all indices merged, deduplicated by domain
 *   scripts/indices/missing.csv      — companies without a domain
 */

const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'indices');
const DELAY_MS = 600;
const WD_SPARQL = 'https://query.wikidata.org/sparql';

// ── Index definitions ─────────────────────────────────────────────────────────
const INDICES = [
  { key: 'sp500',       name: 'S&P 500',       qid: 'Q242345', region: 'Americas' },
  { key: 'ftse100',     name: 'FTSE 100',       qid: 'Q466496', region: 'Europe'   },
  { key: 'dax',         name: 'DAX',            qid: 'Q155718', region: 'Europe'   },
  { key: 'cac40',       name: 'CAC 40',         qid: 'Q648828', region: 'Europe'   },
  { key: 'euro-stoxx50',name: 'Euro Stoxx 50',  qid: 'Q981010', region: 'Europe'   },
  { key: 'ibex35',      name: 'IBEX 35',        qid: 'Q938032', region: 'Europe'   },
];

// ── Sector mapping ────────────────────────────────────────────────────────────
const SECTOR_MAP = [
  [['bank','financ','invest','asset management','capital market','brokerage','wealth','stock exchange'], 'Banking & Finance'],
  [['insur'],                                                                          'Insurance'],
  [['software','technology','semiconductor','electronic','computer','internet','cloud','saas'], 'Technology'],
  [['telecom','wireless','mobile network','broadband','telephone'],                   'Telecommunications'],
  [['oil','gas','petroleum','energy','electric util','power','renewable','mining','coal'], 'Energy & Utilities'],
  [['retail','e-commerce','supermarket','consumer goods','food','beverage','restaurant','luxury'], 'Retail & Consumer'],
  [['health','pharma','hospital','medical','biotech','drug'],                         'Healthcare'],
  [['media','entertainment','publishing','broadcast','streaming'],                    'Media & Entertainment'],
  [['transport','logistics','airline','shipping','rail','freight','automotive'],      'Transportation & Logistics'],
  [['aerospace','defence','defense','military'],                                      'Defence & Security'],
  [['construction','infrastructure','real estate','property'],                        'Real Estate & Infrastructure'],
  [['chemical','material','steel','aluminium','packaging'],                           'Materials & Chemicals'],
];

function mapSector(label) {
  if (!label) return 'Other';
  const l = label.toLowerCase();
  for (const [kws, sector] of SECTOR_MAP) {
    if (kws.some(k => l.includes(k))) return sector;
  }
  return 'Other';
}

function cleanDomain(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].toLowerCase().trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function csvEscape(s) {
  if (!s) return '';
  return '"' + String(s).replace(/"/g, '""') + '"';
}

// ── Wikidata fetch ────────────────────────────────────────────────────────────
async function fetchWikidata(sparql, label) {
  process.stdout.write(`  ${label}… `);
  const url = `${WD_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PQCReadinessTracker/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()).results.bindings;
  console.log(`${rows.length} rows`);
  return rows;
}

// Fetch all members of an index — preferred-rank website first, any website as fallback
async function fetchIndexMembers(idx) {
  const allRows = new Map(); // QID → row

  // Query 1: preferred-rank website
  const sparqlPref = `
SELECT DISTINCT ?company ?companyLabel ?website ?countryLabel ?industryLabel WHERE {
  ?company wdt:P361 wd:${idx.qid}.
  ?company p:P856 ?ws. ?ws ps:P856 ?website; wikibase:rank wikibase:PreferredRank.
  OPTIONAL { ?company wdt:P17 ?country. }
  OPTIONAL { ?company wdt:P452 ?industry. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  await sleep(DELAY_MS);
  const pref = await fetchWikidata(sparqlPref, `${idx.name} (preferred website)`);
  for (const b of pref) {
    const qid = b.company.value.split('/').pop();
    allRows.set(qid, {
      qid,
      company_name: b.companyLabel?.value || qid,
      domain: cleanDomain(b.website?.value || ''),
      country: b.countryLabel?.value || '',
      sector: mapSector(b.industryLabel?.value || ''),
    });
  }

  // Query 2: any website for companies not yet captured or lacking preferred rank
  const sparqlAny = `
SELECT DISTINCT ?company ?companyLabel ?website ?countryLabel ?industryLabel WHERE {
  ?company wdt:P361 wd:${idx.qid}.
  ?company wdt:P856 ?website.
  FILTER NOT EXISTS { ?company p:P856 ?s. ?s wikibase:rank wikibase:PreferredRank. }
  OPTIONAL { ?company wdt:P17 ?country. }
  OPTIONAL { ?company wdt:P452 ?industry. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  await sleep(DELAY_MS);
  const any = await fetchWikidata(sparqlAny, `${idx.name} (any website fallback)`);
  for (const b of any) {
    const qid = b.company.value.split('/').pop();
    if (!allRows.has(qid) && b.website?.value) {
      allRows.set(qid, {
        qid,
        company_name: b.companyLabel?.value || qid,
        domain: cleanDomain(b.website.value),
        country: b.countryLabel?.value || '',
        sector: mapSector(b.industryLabel?.value || ''),
      });
    }
    // Also fill in missing domains for companies we found but without a domain
    if (allRows.has(qid) && !allRows.get(qid).domain && b.website?.value) {
      allRows.get(qid).domain = cleanDomain(b.website.value);
    }
  }

  // Query 3: companies with no website at all (so we know what's missing)
  const sparqlNone = `
SELECT DISTINCT ?company ?companyLabel ?countryLabel ?industryLabel WHERE {
  ?company wdt:P361 wd:${idx.qid}.
  FILTER NOT EXISTS { ?company wdt:P856 ?w. }
  OPTIONAL { ?company wdt:P17 ?country. }
  OPTIONAL { ?company wdt:P452 ?industry. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  await sleep(DELAY_MS);
  const none = await fetchWikidata(sparqlNone, `${idx.name} (no website)`);
  for (const b of none) {
    const qid = b.company.value.split('/').pop();
    if (!allRows.has(qid)) {
      allRows.set(qid, {
        qid,
        company_name: b.companyLabel?.value || qid,
        domain: '',
        country: b.countryLabel?.value || '',
        sector: mapSector(b.industryLabel?.value || ''),
      });
    }
  }

  return [...allRows.values()];
}

// ── SEC EDGAR fallback for S&P 500 missing domains ────────────────────────────
let _edgarTickers = null;

async function getEdgarTickers() {
  if (_edgarTickers) return _edgarTickers;
  console.log('  Fetching EDGAR company tickers…');
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': 'PQCReadinessTracker/1.0 contact@pqctracker.io' },
  });
  const json = await res.json();
  // Returns { "0": { cik_str, ticker, title }, ... }
  _edgarTickers = Object.values(json);
  return _edgarTickers;
}

function normalizeName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function edgarLookup(companyName) {
  try {
    const tickers = await getEdgarTickers();
    const norm = normalizeName(companyName);
    // Find closest match by normalized name
    const match = tickers.find(t => normalizeName(t.title) === norm)
      || tickers.find(t => normalizeName(t.title).startsWith(norm.slice(0, 8)));
    if (!match) return null;

    const cik = String(match.cik_str).padStart(10, '0');
    await sleep(150);
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': 'PQCReadinessTracker/1.0 contact@pqctracker.io' },
    });
    if (!res.ok) return null;
    const sub = await res.json();
    return sub.website ? cleanDomain(sub.website) : null;
  } catch { return null; }
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function writeCsv(filepath, rows) {
  const lines = [
    'rank,domain,company_name,country,sector,index',
    ...rows.map((r, i) => [i + 1, r.domain, csvEscape(r.company_name), csvEscape(r.country), csvEscape(r.sector), csvEscape(r.index)].join(',')),
  ];
  fs.writeFileSync(filepath, lines.join('\n'));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Stock Index Domain Fetcher ===\n');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const combined = new Map(); // domain → row (deduplicated across indices)
  const allMissing = [];

  for (const idx of INDICES) {
    console.log(`\n── ${idx.name} (${idx.qid}) ──`);
    let rows;
    try {
      rows = await fetchIndexMembers(idx);
    } catch (e) {
      console.warn(`  FAILED: ${e.message}`);
      continue;
    }

    // Filter QID-leaked names
    rows = rows.filter(r => !r.company_name.match(/^Q\d+$/));

    const withDomain    = rows.filter(r => r.domain && r.domain.includes('.'));
    const withoutDomain = rows.filter(r => !r.domain || !r.domain.includes('.'));

    console.log(`  Total: ${rows.length} | With domain: ${withDomain.length} | Missing: ${withoutDomain.length}`);

    // SEC EDGAR fallback for S&P 500
    if (idx.key === 'sp500' && withoutDomain.length > 0) {
      console.log(`  Running EDGAR fallback for ${withoutDomain.length} companies…`);
      let found = 0;
      for (const row of withoutDomain) {
        const domain = await edgarLookup(row.company_name);
        if (domain) { row.domain = domain; found++; process.stdout.write('.'); }
      }
      if (found) console.log(`\n  EDGAR added ${found} domains`);
    }

    // Write per-index CSV
    const indexRows = rows
      .filter(r => r.domain && r.domain.includes('.'))
      .sort((a, b) => a.company_name.localeCompare(b.company_name))
      .map(r => ({ ...r, index: idx.name }));

    writeCsv(path.join(OUT_DIR, `${idx.key}.csv`), indexRows);
    console.log(`  ✓ ${indexRows.length} rows → indices/${idx.key}.csv`);

    // Add to combined (first occurrence wins for deduplication)
    for (const r of indexRows) {
      if (!combined.has(r.domain)) combined.set(r.domain, r);
    }

    // Collect missing
    const stillMissing = rows.filter(r => !r.domain || !r.domain.includes('.'));
    stillMissing.forEach(r => allMissing.push({ ...r, index: idx.name }));
  }

  // Write combined CSV
  const combinedRows = [...combined.values()].sort((a, b) => a.company_name.localeCompare(b.company_name));
  writeCsv(path.join(OUT_DIR, 'combined.csv'), combinedRows);
  console.log(`\n✓ Combined: ${combinedRows.length} unique domains → indices/combined.csv`);

  // Write missing CSV
  if (allMissing.length > 0) {
    const missingLines = [
      'company_name,country,sector,index',
      ...allMissing.map(r => [csvEscape(r.company_name), csvEscape(r.country), csvEscape(r.sector), csvEscape(r.index)].join(',')),
    ];
    fs.writeFileSync(path.join(OUT_DIR, 'missing.csv'), missingLines.join('\n'));
    console.log(`  ${allMissing.length} without domain → indices/missing.csv`);
  }

  // Coverage report
  console.log('\n── Coverage report ──');
  const total = combinedRows.length + allMissing.length;
  console.log(`  Companies with domain : ${combinedRows.length} / ${total} (${Math.round(combinedRows.length/total*100)}%)`);
  console.log(`  Unique domains        : ${combined.size}`);
  const bySector = {};
  combinedRows.forEach(r => { bySector[r.sector] = (bySector[r.sector]||0)+1; });
  console.log('  By sector:');
  Object.entries(bySector).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`    ${String(n).padStart(4)}  ${s}`));

  console.log('\nDone! Upload combined.csv (or per-index CSVs) in Admin → Indexes.');
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
