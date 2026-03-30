#!/usr/bin/env node
/**
 * fetch-forbes-2000.js
 *
 * Fetches the world's major publicly-listed companies from Wikidata.
 * This covers the Forbes Global 2000 universe (large public companies worldwide).
 * Uses the Wikidata "preferred rank" website to avoid duplicates per company.
 *
 * No API key required.
 *
 * Optional Clearbit enrichment for companies still missing a domain:
 *   CLEARBIT_KEY=sk_xxx node scripts/fetch-forbes-2000.js
 *
 * Output:
 *   scripts/forbes-global-2000.csv       — ready to upload in Admin → Indexes
 *   scripts/forbes-missing-domains.csv   — companies without a domain
 */

const fs   = require('fs');
const path = require('path');

const OUTPUT  = path.join(__dirname, 'forbes-global-2000.csv');
const MISSING = path.join(__dirname, 'forbes-missing-domains.csv');

const WD_SPARQL    = 'https://query.wikidata.org/sparql';
const CLEARBIT_KEY = process.env.CLEARBIT_KEY || null;
const DELAY_MS     = 500;

// ── Sector mapping ────────────────────────────────────────────────────────────
const SECTOR_MAP = [
  [['bank','financ','invest','asset management','capital market','brokerage','wealth management','stock exchange'], 'Banking & Finance'],
  [['insur'],                                                                                'Insurance'],
  [['software','technology','semiconductor','electronic','computer','internet platform','cloud','saas','information technology'], 'Technology'],
  [['telecom','wireless','mobile network','broadband','telephone'],                         'Telecommunications'],
  [['oil','gas','petroleum','energy','electric util','power generat','renewable','mining','coal'], 'Energy & Utilities'],
  [['retail','e-commerce','supermarket','consumer goods','food manufacture','beverage','restaurant','luxury brand'], 'Retail & E-commerce'],
  [['health','pharma','hospital','medical','biotech','drug'],                               'Healthcare'],
  [['media','entertainment','publishing','broadcast','streaming'],                          'Media & Entertainment'],
  [['education','university'],                                                              'Education'],
  [['legal','law firm','consulting','advisory','professional service'],                    'Legal & Professional Services'],
  [['transport','logistics','airline','shipping','rail','freight','automotive','car manufacturer','truck'], 'Transportation & Logistics'],
  [['aerospace','defence','defense','military','weapon'],                                  'Defence & Security'],
  [['construction','infrastructure','real estate','property'],                             'Critical Infrastructure'],
  [['cloud hosting','data centre','hosting'],                                              'Cloud & Hosting'],
];

function mapSector(label) {
  if (!label) return 'Other';
  const l = label.toLowerCase();
  for (const [keywords, sector] of SECTOR_MAP) {
    if (keywords.some(k => l.includes(k))) return sector;
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

async function fetchWikidata(sparql, label) {
  process.stdout.write(`  ${label}… `);
  const url = `${WD_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': 'PQCReadinessTracker/1.0' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wikidata ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const rows = json.results.bindings;
  console.log(`${rows.length} rows`);
  return rows;
}

// ── Optional Clearbit ─────────────────────────────────────────────────────────
async function clearbitLookup(name) {
  try {
    const res = await fetch(
      `https://company.clearbit.com/v1/domains/find?name=${encodeURIComponent(name)}`,
      { headers: { Authorization: 'Bearer ' + CLEARBIT_KEY } }
    );
    if (!res.ok) return null;
    return (await res.json()).domain || null;
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Forbes Global 2000 Domain Fetcher ===\n');
  console.log('Querying Wikidata for major publicly-listed companies…\n');

  const allRows = new Map(); // QID → { company_name, domain, country, sector }

  // Query in regional batches to avoid Wikidata timeouts
  // Use preferred-rank website only (main domain, not country variants)
  const regions = [
    { label: 'Americas',         continent: 'wd:Q828' },
    { label: 'Europe',           continent: 'wd:Q46' },
    { label: 'Asia',             continent: 'wd:Q48' },
    { label: 'Africa + Oceania', continent: null, extra: 'wd:Q15 wd:Q55643' },
  ];

  for (const region of regions) {
    const continentFilter = region.extra
      ? `VALUES ?continent { ${region.extra} } ?country wdt:P30 ?continent.`
      : `?country wdt:P30 ${region.continent}.`;

    // Query 1: companies with preferred-rank website
    const sparqlPreferred = `
SELECT DISTINCT ?company ?companyLabel ?website ?countryLabel ?industryLabel WHERE {
  ?company wdt:P31 wd:Q891723.
  ?company p:P856 ?websiteStmt.
  ?websiteStmt ps:P856 ?website;
              wikibase:rank wikibase:PreferredRank.
  ?company wdt:P17 ?country.
  ${continentFilter}
  OPTIONAL { ?company wdt:P452 ?industry. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

    await sleep(DELAY_MS);
    let rows = [];
    try {
      rows = await fetchWikidata(sparqlPreferred, `${region.label} (preferred websites)`);
    } catch (e) {
      console.warn(`  Failed: ${e.message}`);
      continue;
    }

    for (const b of rows) {
      const qid = b.company.value.split('/').pop();
      if (!allRows.has(qid)) {
        allRows.set(qid, {
          company_name: b.companyLabel?.value || qid,
          domain: cleanDomain(b.website?.value || ''),
          country: b.countryLabel?.value || '',
          sector: mapSector(b.industryLabel?.value || ''),
        });
      }
    }

    // Query 2: companies with any website (to catch those without preferred rank set)
    const sparqlAny = `
SELECT DISTINCT ?company ?companyLabel ?website ?countryLabel ?industryLabel WHERE {
  ?company wdt:P31 wd:Q891723.
  ?company wdt:P856 ?website.
  ?company wdt:P17 ?country.
  ${continentFilter}
  FILTER NOT EXISTS {
    ?company p:P856 ?s.
    ?s wikibase:rank wikibase:PreferredRank.
  }
  OPTIONAL { ?company wdt:P452 ?industry. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

    await sleep(DELAY_MS);
    try {
      const rows2 = await fetchWikidata(sparqlAny, `${region.label} (any website, no preferred)`);
      for (const b of rows2) {
        const qid = b.company.value.split('/').pop();
        if (!allRows.has(qid) && b.website?.value) {
          allRows.set(qid, {
            company_name: b.companyLabel?.value || qid,
            domain: cleanDomain(b.website.value),
            country: b.countryLabel?.value || '',
            sector: mapSector(b.industryLabel?.value || ''),
          });
        }
      }
    } catch (e) {
      console.warn(`  Failed: ${e.message}`);
    }
  }

  // Also query companies without websites (so we know what's missing)
  await sleep(DELAY_MS);
  try {
    const sparqlNoWebsite = `
SELECT DISTINCT ?company ?companyLabel ?countryLabel ?industryLabel WHERE {
  ?company wdt:P31 wd:Q891723.
  ?company wdt:P17 ?country.
  FILTER NOT EXISTS { ?company wdt:P856 ?website. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 3000`;
    const noWebRows = await fetchWikidata(sparqlNoWebsite, 'Companies without website');
    for (const b of noWebRows) {
      const qid = b.company.value.split('/').pop();
      if (!allRows.has(qid)) {
        allRows.set(qid, {
          company_name: b.companyLabel?.value || qid,
          domain: '',
          country: b.countryLabel?.value || '',
          sector: mapSector(b.industryLabel?.value || ''),
        });
      }
    }
  } catch (e) {
    console.warn(`  No-website query failed: ${e.message}`);
  }

  let rows = [...allRows.values()];
  console.log(`\nTotal unique companies: ${rows.length}`);

  // Filter out Wikidata QIDs that leaked as names (Q12345 format)
  rows = rows.filter(r => !r.company_name.match(/^Q\d+$/));

  // Filter out clearly non-.tld domains
  rows = rows.map(r => ({
    ...r,
    domain: r.domain.includes('.') ? r.domain : '',
  }));

  let withDomain    = rows.filter(r => r.domain);
  let withoutDomain = rows.filter(r => !r.domain);

  console.log(`  With domain:    ${withDomain.length}`);
  console.log(`  Without domain: ${withoutDomain.length}`);

  // Optional Clearbit enrichment
  if (CLEARBIT_KEY && withoutDomain.length > 0) {
    console.log(`\nClearbit enrichment for up to ${Math.min(withoutDomain.length, 500)} companies…`);
    let enriched = 0;
    for (const row of withoutDomain.slice(0, 500)) {
      await sleep(300);
      const domain = await clearbitLookup(row.company_name);
      if (domain) { row.domain = domain; enriched++; process.stdout.write('.'); }
    }
    console.log(`\nClearbit added ${enriched} domains`);
    withDomain    = rows.filter(r => r.domain);
    withoutDomain = rows.filter(r => !r.domain);
  }

  // Write main CSV
  const readyRows = withDomain.sort((a, b) => a.company_name.localeCompare(b.company_name));
  const csvLines = [
    'rank,domain,company_name,country,sector',
    ...readyRows.map((r, i) => [
      i + 1, r.domain, csvEscape(r.company_name), csvEscape(r.country), csvEscape(r.sector),
    ].join(',')),
  ];
  fs.writeFileSync(OUTPUT, csvLines.join('\n'));
  console.log(`\n✓ ${readyRows.length} companies with domains → ${path.basename(OUTPUT)}`);

  // Write missing CSV
  if (withoutDomain.length > 0) {
    const missingLines = [
      'company_name,country,sector',
      ...withoutDomain.map(r => [csvEscape(r.company_name), csvEscape(r.country), csvEscape(r.sector)].join(',')),
    ];
    fs.writeFileSync(MISSING, missingLines.join('\n'));
    console.log(`  ${withoutDomain.length} without domain → ${path.basename(MISSING)}`);
  }

  console.log('\nDone! Go to Admin → Indexes → Create index "Forbes Global 2000" → Import CSV.');
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
