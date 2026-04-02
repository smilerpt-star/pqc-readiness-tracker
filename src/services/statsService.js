const { supabase } = require("../db/supabase");

async function getStats() {
  const [
    { data: domains,     error: dErr      },
    { data: domainTests, error: dtErr     },
    { data: indexes },
    { data: diLinks },
    { data: trendRows,   error: trendErr  },
  ] = await Promise.all([
    supabase.from("domains").select("id, country, sector, active"),
    supabase.from("domain_tests").select("domain_id, last_score, last_status, last_run_at"),
    supabase.from("indexes").select("id, key, name"),
    supabase.from("domain_indexes").select("domain_id, index_id"),
    supabase.rpc("get_trend_data"),
  ]);

  if (dErr) throw dErr;
  if (dtErr) throw dtErr;
  if (trendErr) console.error("[statsService] get_trend_data RPC error:", trendErr.message);
  else console.log("[statsService] get_trend_data rows:", (trendRows || []).length);

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

  // last_scan_at: most recent started_at across all trend rows
  const allTrend = trendRows || [];
  const lastRunAt = allTrend.length > 0
    ? allTrend.reduce((max, r) => r.last_started_at > max ? r.last_started_at : max, "")
    : null;

  const activeDomains = (domains || []).filter(d => d.active !== false);
  const allScores = Object.values(scoreMap);

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

  // ── Trend data — pre-aggregated by Supabase RPC ────────────────────────────
  const trend_daily   = allTrend
    .filter(r => r.period_type === "daily")
    .sort((a, b) => a.period_key.localeCompare(b.period_key))
    .map(r => ({ day:   r.period_key, avg_score: r.avg_score, count: r.run_count }));

  const trend_weekly  = allTrend
    .filter(r => r.period_type === "weekly")
    .sort((a, b) => a.period_key.localeCompare(b.period_key))
    .map(r => ({ week:  r.period_key, avg_score: r.avg_score, count: r.run_count }));

  const trend_monthly = allTrend
    .filter(r => r.period_type === "monthly")
    .sort((a, b) => a.period_key.localeCompare(b.period_key))
    .map(r => ({ month: r.period_key, avg_score: r.avg_score, count: r.run_count }));

  // ── PQC readiness summary ──────────────────────────────────────────────────
  const n = allScores.length;
  const pqc_ready_count   = allScores.filter(s => s >= 80).length;
  const pqc_partial_count = allScores.filter(s => s >= 40 && s < 80).length;
  const pqc_legacy_count  = allScores.filter(s => s < 40).length;

  return {
    total_domains:  (domains || []).length,
    active_domains: activeDomains.length,
    total_scored:   n,
    avg_score:      avg(allScores),
    last_scan_at:   lastRunAt,
    pqc_ready:   { count: pqc_ready_count,   pct: n ? Math.round(pqc_ready_count   / n * 100) : 0 },
    pqc_partial: { count: pqc_partial_count, pct: n ? Math.round(pqc_partial_count / n * 100) : 0 },
    pqc_legacy:  { count: pqc_legacy_count,  pct: n ? Math.round(pqc_legacy_count  / n * 100) : 0 },
    by_index,
    by_country: aggregate("country", activeDomains).sort((a, b) => b.count - a.count),
    by_sector:  aggregate("sector",  activeDomains).sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1)),
    score_distribution,
    trend_daily,
    trend_weekly,
    trend_monthly,
  };
}

module.exports = { getStats };
