#!/usr/bin/env node
/**
 * import-index.js
 *
 * Fast bulk importer for an index CSV.
 * Usage:
 *   node scripts/import-index.js <index_id> <csv_file>
 *
 * CSV columns: rank,domain,company_name,country,sector
 *
 * Strategy (batched, avoids N+1 queries):
 *   1. Upsert all domains in batches (conflict: domain) → get back IDs
 *   2. Batch upsert domain_indexes
 *   3. Batch auto-assign tls_scan domain_test where missing
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH = 200;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const [,, indexIdArg, csvFile] = process.argv;
if (!indexIdArg || !csvFile) {
  console.error('Usage: node scripts/import-index.js <index_id> <csv_file>');
  process.exit(1);
}
const INDEX_ID = Number(indexIdArg);

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const vals = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !inQ) { inQ = true; }
    else if (c === '"' && inQ && line[i + 1] === '"') { cur += '"'; i++; }
    else if (c === '"' && inQ) { inQ = false; }
    else if (c === ',' && !inQ) { vals.push(cur); cur = ''; }
    else cur += c;
  }
  vals.push(cur);
  return vals;
}

function loadCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
  return lines.slice(1).map(l => {
    const v = parseCsvLine(l);
    return {
      rank: Number(v[0]) || null,
      domain: (v[1] || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      company_name: v[2] || null,
      country: v[3] || null,
      sector: v[4] || null,
    };
  }).filter(r => r.domain && r.domain.includes('.'));
}

// ── Batch helpers ─────────────────────────────────────────────────────────────
async function upsertDomainsBatch(rows) {
  const payload = rows.map(r => ({
    domain: r.domain,
    company_name: r.company_name,
    country: r.country,
    sector: r.sector,
    active: true,
  }));
  const { data, error } = await supabase
    .from('domains')
    .upsert(payload, { onConflict: 'domain', ignoreDuplicates: false })
    .select('id, domain');
  if (error) throw new Error(`upsert domains: ${error.message}`);
  return data; // [{ id, domain }]
}

async function fetchDomainIds(domainNames) {
  // Split into batches to avoid URL length limits
  const all = [];
  for (let i = 0; i < domainNames.length; i += BATCH) {
    const chunk = domainNames.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('domains')
      .select('id, domain')
      .in('domain', chunk);
    if (error) throw new Error(`fetchDomainIds: ${error.message}`);
    all.push(...(data || []));
  }
  return all;
}

async function upsertDomainIndexesBatch(entries) {
  const { error } = await supabase
    .from('domain_indexes')
    .upsert(entries, { onConflict: 'domain_id,index_id', ignoreDuplicates: true });
  if (error) throw new Error(`upsert domain_indexes: ${error.message}`);
}

async function autoAssignTlsScans(domainIds) {
  // Get the tls_scan test type
  const { data: tt } = await supabase
    .from('test_types')
    .select('id')
    .eq('key', 'tls_scan')
    .single();
  if (!tt) { console.warn('  [warn] tls_scan test type not found — skipping auto-assign'); return 0; }

  // Find domain IDs that already have a domain_test for tls_scan
  const existing = new Set();
  for (let i = 0; i < domainIds.length; i += BATCH) {
    const chunk = domainIds.slice(i, i + BATCH);
    const { data } = await supabase
      .from('domain_tests')
      .select('domain_id')
      .in('domain_id', chunk)
      .eq('test_type_id', tt.id);
    (data || []).forEach(r => existing.add(r.domain_id));
  }

  const newIds = domainIds.filter(id => !existing.has(id));
  if (newIds.length === 0) return 0;

  const payload = newIds.map(id => ({ domain_id: id, test_type_id: tt.id, active: true }));
  for (let i = 0; i < payload.length; i += BATCH) {
    const { error } = await supabase.from('domain_tests').insert(payload.slice(i, i + BATCH));
    if (error) throw new Error(`insert domain_tests: ${error.message}`);
  }
  return newIds.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Loading ${csvFile}…`);
  let rows = loadCsv(csvFile);
  // Deduplicate by domain (keep first occurrence)
  const _seen = new Set();
  rows = rows.filter(r => { if (_seen.has(r.domain)) return false; _seen.add(r.domain); return true; });
  console.log(`  ${rows.length} unique domains after deduplication`);

  // Step 1: Upsert all domains in batches
  console.log('\nStep 1/3 — Upserting domains…');
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await upsertDomainsBatch(batch);
    process.stdout.write(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log(`  Done.                       `);

  // Step 2: Fetch all domain IDs
  console.log('\nStep 2/3 — Fetching domain IDs…');
  const domainNames = [...new Set(rows.map(r => r.domain))];
  const domainRecords = await fetchDomainIds(domainNames);
  const domainMap = {};
  domainRecords.forEach(d => { domainMap[d.domain] = d.id; });
  console.log(`  Resolved ${Object.keys(domainMap).length} domain IDs`);

  // Step 3a: Upsert domain_indexes
  console.log('\nStep 3/3 — Linking to index…');
  const rowMap = {};
  rows.forEach(r => { rowMap[r.domain] = r; });
  const indexEntries = Object.entries(domainMap).map(([domain, domainId]) => ({
    domain_id: domainId,
    index_id: INDEX_ID,
    rank: rowMap[domain]?.rank || null,
    year: rowMap[domain]?.year || null,
  }));
  for (let i = 0; i < indexEntries.length; i += BATCH) {
    await upsertDomainIndexesBatch(indexEntries.slice(i, i + BATCH));
    process.stdout.write(`  ${Math.min(i + BATCH, indexEntries.length)}/${indexEntries.length}\r`);
  }
  console.log(`  Done.                       `);

  // Step 3b: Auto-assign tls_scan
  console.log('\nAuto-assigning tls_scan tests…');
  const allDomainIds = Object.values(domainMap);
  const assigned = await autoAssignTlsScans(allDomainIds);
  console.log(`  Assigned ${assigned} new tls_scan tests`);

  console.log(`\n✓ Import complete — ${domainRecords.length} domains in index ${INDEX_ID}`);
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
