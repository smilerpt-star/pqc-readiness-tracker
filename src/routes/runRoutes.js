const express = require("express");

const testRunService = require("../services/testRunService");
const { parseIdParam } = require("../lib/validation");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const data = await testRunService.listRuns();
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
