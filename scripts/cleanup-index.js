#!/usr/bin/env node
/**
 * cleanup-index.js
 *
 * Removes all domains, domain_tests and domain_indexes associated with a given index.
 * Usage: node scripts/cleanup-index.js <index_id>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BATCH = 200;

const [,, indexIdArg] = process.argv;
if (!indexIdArg) { console.error('Usage: node scripts/cleanup-index.js <index_id>'); process.exit(1); }
const INDEX_ID = Number(indexIdArg);

async function main() {
  // 1. Get all domain_ids in this index (paginated — Supabase default limit is 1000)
  console.log(`Fetching domain_ids for index ${INDEX_ID}…`);
  const allLinks = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('domain_indexes')
      .select('domain_id')
      .eq('index_id', INDEX_ID)
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allLinks.push(...data);
    offset += data.length;
    if (data.length < BATCH) break;
  }
  const domainIds = [...new Set(allLinks.map(l => l.domain_id))];
  console.log(`  Found ${domainIds.length} domains`);

  // 2. Delete domain_tests for these domains
  console.log('Deleting domain_tests…');
  for (let i = 0; i < domainIds.length; i += BATCH) {
    const chunk = domainIds.slice(i, i + BATCH);
    const { error } = await supabase.from('domain_tests').delete().in('domain_id', chunk);
    if (error) throw new Error(`domain_tests: ${error.message}`);
    process.stdout.write(`  ${Math.min(i + BATCH, domainIds.length)}/${domainIds.length}\r`);
  }
  console.log('  Done.                 ');

  // 3. Delete domain_indexes entries
  console.log('Deleting domain_indexes…');
  const { error: e2 } = await supabase.from('domain_indexes').delete().eq('index_id', INDEX_ID);
  if (e2) throw new Error(e2.message);
  console.log('  Done.');

  // 4. Delete the domains themselves
  console.log('Deleting domains…');
  for (let i = 0; i < domainIds.length; i += BATCH) {
    const chunk = domainIds.slice(i, i + BATCH);
    const { error } = await supabase.from('domains').delete().in('id', chunk);
    if (error) throw new Error(`domains: ${error.message}`);
    process.stdout.write(`  ${Math.min(i + BATCH, domainIds.length)}/${domainIds.length}\r`);
  }
  console.log('  Done.                 ');

  // 5. Delete the index record
  console.log('Deleting index record…');
  const { error: e3 } = await supabase.from('indexes').delete().eq('id', INDEX_ID);
  if (e3) throw new Error(e3.message);
  console.log('  Done.');

  console.log(`\n✓ Index ${INDEX_ID} and all associated data removed.`);
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
