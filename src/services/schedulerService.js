const { getConfig, setConfig } = require("../repositories/configRepository");
const domainTestRepository = require("../repositories/domainTestRepository");
const { runDomainTest } = require("./domainTestService");
const { unwrapResult } = require("./databaseService");

const TICK_MS = 60_000; // check every minute
const CONCURRENCY = 10;

let _lastScanDate = null; // 'YYYY-MM-DD' UTC — kept in sync with DB config key 'last_scan_date'
let _running = false;
let _lastRunStats = null; // { date, total, pass, fail, errors, duration_ms }

function getLastRunStats() { return _lastRunStats; }
function isRunning() { return _running; }

async function runWithConcurrency(tasks, concurrency) {
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      await task().catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

async function runAll(trigger = "scheduled") {
  if (_running) return { skipped: true, reason: "already running" };
  _running = true;
  const start = Date.now();
  let pass = 0, fail = 0, errors = 0;

  try {
    // Get all active domain_tests for active domains
    const { data: dts, error } = await domainTestRepository.findAllActiveDomainTests();
    if (error) throw error;
    const domainTests = dts || [];

    const tasks = domainTests.map(dt => async () => {
      try {
        const result = await runDomainTest(dt.id, trigger);
        if (result?.status === "pass") pass++;
        else fail++;
      } catch {
        errors++;
      }
    });

    await runWithConcurrency(tasks, CONCURRENCY);

    _lastRunStats = {
      date: new Date().toISOString(),
      total: domainTests.length,
      pass,
      fail,
      errors,
      duration_ms: Date.now() - start,
      trigger,
    };
  } finally {
    _running = false;
  }

  return _lastRunStats;
}

async function tick() {
  const now = new Date();
  const todayUTC = now.toISOString().split("T")[0];

  // Sync in-memory state from DB on first tick after restart
  if (_lastScanDate === null) {
    try { _lastScanDate = (await getConfig("last_scan_date")) || ""; } catch {}
  }

  if (_lastScanDate === todayUTC) return;

  let scanTime = "02:00";
  try { scanTime = (await getConfig("daily_scan_time")) || "02:00"; } catch {}

  const [h, m] = scanTime.split(":").map(Number);
  if (now.getUTCHours() > h || (now.getUTCHours() === h && now.getUTCMinutes() >= m)) {
    _lastScanDate = todayUTC;
    setConfig("last_scan_date", todayUTC).catch(console.error);
    runAll("scheduled").catch(console.error);
  }
}

function start() {
  tick();
  setInterval(tick, TICK_MS);
}

module.exports = { start, runAll, isRunning, getLastRunStats };
