const express = require("express");
const indexService = require("../services/indexService");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const data = await indexService.listIndexes();
    res.json({ data });
  } catch (e) { next(e); }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const data = await indexService.createIndex(req.body);
    res.status(201).json({ data });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const data = await indexService.getIndexById(req.params.id);
    res.json({ data });
  } catch (e) { next(e); }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const data = await indexService.updateIndex(req.params.id, req.body);
    res.json({ data });
  } catch (e) { next(e); }
});

router.get("/:id/domains", async (req, res, next) => {
  try {
    const data = await indexService.listDomainsByIndex(req.params.id);
    res.json({ data });
  } catch (e) { next(e); }
});

router.post("/:id/import", requireAuth, async (req, res, next) => {
  try {
    // body: { rows: [{ domain, company_name, country, sector, rank, year }] }
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows array required" });
    }
    const result = await indexService.bulkImport(Number(req.params.id), rows);
    res.json({ data: result });
  } catch (e) { next(e); }
});

module.exports = router;
