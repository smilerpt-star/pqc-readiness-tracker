const express = require("express");

const testRunService = require("../services/testRunService");
const { parseIdParam } = require("../lib/validation");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const domainId = req.query.domain_id || null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = domainId
      ? await testRunService.listRunsByDomainId(domainId, limit)
      : await testRunService.listRuns(limit);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id);
    const data = await testRunService.getRunById(id);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
