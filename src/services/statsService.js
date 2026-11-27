const { supabase, selectAll } = require("../db/supabase");

// /stats is served from a PRECOMPUTED snapshot (stats_cache table), refreshed on
// a schedule (right after the daily scan) — never computed on a user request.
// The heavy year-long aggregation against the tiny free-tier DB thus runs ~once
// a day in the background instead of on every page load. A short in-memory layer
// avoids even the single-row snapshot read on back-to-back hits.
const MEM_TTL_MS = 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 25 * 60 * 60 * 1000;
// Bump when the snapshot shape/meaning changes; stale versions are recomputed on boot.
// v2: paginated reads (previous snapshots could be truncated at 1000 rows) + "Other".
const SNAPSHOT_VERSION = 2;
let _mem = { at: 0, data: null };

// Read path: snapshot only. Falls back to a one-off compute if no snapshot
// exists yet (first boot), so the endpoint is never empty.
async function getStats() {
  if (_mem.data && Date.now() - _mem.at < MEM_TTL_MS) return _mem.data;

  const { data: row, error } = await supabase
    .from("stats_cache").select("data").eq("id", 1).maybeSingle();
  if (error) throw error;

  if (row?.data) {
    _mem = { at: Date.now(), data: row.data };
    return row.data;
  }
  return refreshStatsCache(); // bootstrap: no snapshot yet
}

// Write path: compute the heavy aggregation once and store it. Called by the
// scheduler after the daily scan, and on startup if the snapshot is stale.
async function refreshStatsCache() {
  const start = Date.now();
  const data = await computeStats();
  const { error } = await supabase
    .from("stats_cache")
    .upsert({ id: 1, data, computed_at: new Date().toISOString() });
  if (error) throw error;
  _mem = { at: Date.now(), data };
  console.log(`[stats] snapshot refreshed in ${Date.now() - start}ms`);
  return data;
}

// Refresh only when the stored snapshot is missing or older than maxAgeMs.
async function ensureFreshSnapshot(maxAgeMs = SNAPSHOT_MAX_AGE_MS) {
  try {
    const { data: row } = await supabase
      .from("stats_cache").select("computed_at, version:data->snapshot_version").eq("id", 1).maybeSingle();
    const age = row?.computed_at ? Date.now() - new Date(row.computed_at).getTime() : Infinity;
    if (age > maxAgeMs || Number(row?.version) !== SNAPSHOT_VERSION) {
      console.log("[stats] snapshot missing/stale — refreshing on startup");
      await refreshStatsCache();
    }
  } catch (e) {
    console.error(`[stats] ensureFreshSnapshot failed: ${e.message}`);
  }
}

async function computeStats() {
  // Trends come from a single combined RPC (stats_trends) that scans test_runs
  // once, instead of three concurrent scans that saturated the free-tier DB and
  // hit the statement timeout. The remaining queries are small.
  const [
    { data: domains,     error: dErr  },
    { data: domainTests, error: dtErr },
    { data: indexes },
    { data: diLinks },
    { data: lastRunRow },
    { data: trends,      error: trErr },
    { data: deltaRows,   error: deErr },
  ] = await Promise.all([
    selectAll(() => supabase.from("domains").select("id, country, sector, active").order("id")),
    selectAll(() => supabase.from("domain_tests").select("id, domain_id, last_score, last_status, last_run_at").order("id")),
    selectAll(() => supabase.from("indexes").select("id, key, name").order("id")),
    selectAll(() => supabase.from("domain_indexes").select("domain_id, index_id").order("id")),
    supabase.from("test_runs").select("started_at").not("score", "is", null)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc("stats_trends"),
    supabase.rpc("stats_delta_1d"),
  ]);

  if (dErr)  throw dErr;
  if (dtErr) throw dtErr;
  if (trErr) throw trErr;
  if (deErr) throw deErr;

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  // Best score per domain
  const scoreMap = {};
  (domainTests || []).forEach(dt => {
    if (dt.last_score !== null && dt.last_score !== undefined) {
      if (scoreMap[dt.domain_id] === undefined || dt.last_score > scoreMap[dt.domain_id]) {
        scoreMap[dt.domain_id] = dt.last_score;
      }
    }
  });

  const lastRunAt = lastRunRow?.started_at ?? null;

  const activeDomains = (domains || []).filter(d => d.active !== false);
  const allScores = Object.values(scoreMap);

  // Domains whose latest scan found no reachable TLS endpoint: not scored and
  // therefore absent from every readiness figure. Reported for transparency.
  const activeIds = new Set(activeDomains.map(d => d.id));
  const unreachable_count = new Set(
    (domainTests || [])
      .filter(dt => dt.last_status === "unreachable" && activeIds.has(dt.domain_id))
      .map(dt => dt.domain_id)
  ).size;

  // ── Delta (today vs yesterday) by country and sector — from stats_delta_1d ──
  const deltaMap = { country: {}, sector: {} };
  (deltaRows || []).forEach(r => {
    const d = (r.today_avg !== null && r.yesterday_avg !== null) ? r.today_avg - r.yesterday_avg : null;
    if (deltaMap[r.dimension]) deltaMap[r.dimension][r.label] = d;
  });
  const delta1d = (dim, label) =>
    (deltaMap[dim] && label in deltaMap[dim]) ? deltaMap[dim][label] : null;

  // ── Aggregation helper ─────────────────────────────────────────────────────
  function aggregate(key, list) {
    const map = {};
    list.forEach(d => {
      const val = d[key] || "Unknown";
      if (!map[val]) map[val] = { count: 0, scores: [] };
      map[val].count++;
      const score = scoreMap[d.id];
      if (score !== undefined) map[val].scores.push(score);
    });
    return Object.entries(map).map(([label, { count, scores }]) => ({
      [key]: label,
      count,
      avg_score: avg(scores),
      scored: scores.length,
      pqc_ready: scores.filter(s => s >= 80).length,
    }));
  }

  // ── By index ───────────────────────────────────────────────────────────────
  const domainIndexMap = {};
  (diLinks || []).forEach(({ domain_id, index_id }) => {
    if (!domainIndexMap[domain_id]) domainIndexMap[domain_id] = [];
    domainIndexMap[domain_id].push(index_id);
  });

  const indexAgg = {};
  (indexes || []).forEach(idx => {
    indexAgg[idx.id] = { name: idx.name, key: idx.key, scores: [], count: 0 };
  });
  activeDomains.forEach(d => {
    (domainIndexMap[d.id] || []).forEach(idxId => {
      if (!indexAgg[idxId]) return;
      indexAgg[idxId].count++;
      const score = scoreMap[d.id];
      if (score !== undefined) indexAgg[idxId].scores.push(score);
    });
  });

  const by_index = Object.values(indexAgg).map(({ name, key, scores, count }) => ({
    index: name, key, count,
    avg_score: avg(scores),
    scored: scores.length,
    pqc_ready: scores.filter(s => s >= 80).length,
    pct_ready: scores.length ? Math.round(scores.filter(s => s >= 80).length / scores.length * 100) : 0,
  })).sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1));

  // "Other": monitored organisations that are not (or no longer) in any tracked
  // index — former constituents and approved community submissions. Listed last.
  const otherScores = activeDomains
    .filter(d => !(domainIndexMap[d.id] || []).length)
    .map(d => scoreMap[d.id])
    .filter(sc => sc !== undefined);
  const otherCount = activeDomains.filter(d => !(domainIndexMap[d.id] || []).length).length;
  if (otherCount > 0) {
    by_index.push({
      index: "Other", key: "other", count: otherCount,
      avg_score: avg(otherScores),
      scored: otherScores.length,
      pqc_ready: otherScores.filter(sc => sc >= 80).length,
      pct_ready: otherScores.length ? Math.round(otherScores.filter(sc => sc >= 80).length / otherScores.length * 100) : 0,
    });
  }

  // ── Score distribution ─────────────────────────────────────────────────────
  const score_distribution = [
    { label: "Legacy",        key: "legacy",        min: 0,  max: 40  },
    { label: "Transitioning", key: "transitioning", min: 40, max: 80  },
    { label: "PQC-Active",    key: "pqc_active",    min: 80, max: 101 },
  ].map(b => ({
    label: b.label,
    key:   b.key,
    count: allScores.filter(s => s >= b.min && s < b.max).length,
  }));

  // ── Trend data (daily / weekly / monthly) — from the combined stats_trends ──
  const byBucket = (bucket, keyName, keep) =>
    (trends || [])
      .filter(r => r.bucket === bucket)
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
      .slice(-keep)
      .map(r => ({ [keyName]: r.period, avg_score: r.avg_score, count: r.cnt }));

  const trend_daily   = byBucket("daily",   "day",   30);
  const trend_weekly  = byBucket("weekly",  "week",  12);
  const trend_monthly = byBucket("monthly", "month", 12);

  // ── PQC readiness summary ──────────────────────────────────────────────────
  const n = allScores.length;
  const pqc_ready_count   = allScores.filter(s => s >= 80).length;
  const pqc_partial_count = allScores.filter(s => s >= 40 && s < 80).length;
  const pqc_legacy_count  = allScores.filter(s => s < 40).length;

  return {
    snapshot_version: SNAPSHOT_VERSION,
    total_domains:  (domains || []).length,
    active_domains: activeDomains.length,
    total_scored:   n,
    unreachable_count,
    avg_score:      avg(allScores),
    last_scan_at:   lastRunAt,
    pqc_ready:   { count: pqc_ready_count,   pct: n ? Math.round(pqc_ready_count   / n * 100) : 0 },
    pqc_partial: { count: pqc_partial_count, pct: n ? Math.round(pqc_partial_count / n * 100) : 0 },
    pqc_legacy:  { count: pqc_legacy_count,  pct: n ? Math.round(pqc_legacy_count  / n * 100) : 0 },
    by_index,
    by_country: aggregate("country", activeDomains)
      .map(r => ({ ...r, delta_1d: delta1d("country", r.country) }))
      .sort((a, b) => b.count - a.count),
    by_sector: aggregate("sector", activeDomains)
      .map(r => ({ ...r, delta_1d: delta1d("sector", r.sector) }))
      .sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1)),
    score_distribution,
    trend_daily,
    trend_weekly,
    trend_monthly,
  };
}

module.exports = { getStats, refreshStatsCache, ensureFreshSnapshot };
