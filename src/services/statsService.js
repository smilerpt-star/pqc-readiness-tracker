const { supabase } = require("../db/supabase");

async function getStats() {
  const [{ data: domains, error: dErr }, { data: domainTests, error: dtErr }] = await Promise.all([
    supabase.from("domains").select("id, country, sector, active"),
    supabase.from("domain_tests").select("domain_id, last_score, last_status, last_run_at"),
  ]);

  if (dErr) throw dErr;
  if (dtErr) throw dtErr;

  // Best score per domain (take max if multiple tests)
  const scoreMap = {};
  (domainTests || []).forEach(dt => {
    if (dt.last_score !== null && dt.last_score !== undefined) {
      if (scoreMap[dt.domain_id] === undefined || dt.last_score > scoreMap[dt.domain_id]) {
        scoreMap[dt.domain_id] = dt.last_score;
      }
    }
  });

  const activeDomains = (domains || []).filter(d => d.active !== false);

  function aggregate(key, list) {
    const map = {};
    list.forEach(d => {
      const val = d[key] || "Unknown";
      if (!map[val]) map[val] = { count: 0, scores: [] };
      map[val].count++;
      const score = scoreMap[d.id];
      if (score !== undefined) map[val].scores.push(score);
    });
    return Object.entries(map)
      .map(([label, { count, scores }]) => ({
        [key]: label,
        count,
        avg_score: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        scored: scores.length,
      }))
      .sort((a, b) => b.count - a.count);
  }

  const allScores = Object.values(scoreMap);

  return {
    total_domains: (domains || []).length,
    active_domains: activeDomains.length,
    total_scored: allScores.length,
    avg_score: allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null,
    by_country: aggregate("country", activeDomains),
    by_sector: aggregate("sector", activeDomains),
  };
}

module.exports = { getStats };
