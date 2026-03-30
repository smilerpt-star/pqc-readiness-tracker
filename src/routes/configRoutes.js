const express = require("express");
const configRepository = require("../repositories/configRepository");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const all = await configRepository.getAllConfig();
    const data = {};
    all.forEach(row => { data[row.key] = row.value; });
    res.json({ data });
  } catch (e) { next(e); }
});

router.put("/", requireAuth, async (req, res, next) => {
  try {
    // body: { key: value, ... }
    const updates = req.body;
    const allowed = ["daily_scan_time"];
    const results = {};
    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.includes(key)) continue;
      results[key] = await configRepository.setConfig(key, value);
    }
    res.json({ data: results });
  } catch (e) { next(e); }
});

module.exports = router;
