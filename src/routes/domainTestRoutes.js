const express = require("express");

const domainTestService = require("../services/domainTestService");
const { parseIdParam } = require("../lib/validation");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const data = await domainTestService.listDomainTests();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = await domainTestService.createDomainTest(req.body);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id);
    const data = await domainTestService.updateDomainTest(id, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/run", async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id);
    const data = await domainTestService.runDomainTest(id, "api");
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
