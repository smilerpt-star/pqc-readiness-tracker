const domainTestRepository = require("../repositories/domainTestRepository");
const { runDomainTest } = require("./domainTestService");
const { unwrapResult } = require("./databaseService");

const INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
let _busy = false;

async function tick() {
  if (_busy) return;
  _busy = true;
  try {
    const due = unwrapResult(await domainTestRepository.findDueDomainTests());
    if (!due || due.length === 0) return;

    console.log(`[scheduler] ${due.length} test(s) due`);
    for (const dt of due) {
      try {
        await runDomainTest(dt.id, "scheduled");
        console.log(`[scheduler] ok domain_test=${dt.id}`);
      } catch (err) {
        console.error(`[scheduler] failed domain_test=${dt.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[scheduler] tick error: ${err.message}`);
  } finally {
    _busy = false;
  }
}

function start() {
  console.log("[scheduler] started — interval 5min");
  tick(); // run once immediately on boot
  setInterval(tick, INTERVAL_MS);
}

module.exports = { start };
