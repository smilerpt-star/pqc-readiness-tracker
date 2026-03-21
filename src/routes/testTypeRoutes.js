const express = require("express");

const testTypeService = require("../services/testTypeService");
const { parseIdParam } = require("../lib/validation");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const data = await testTypeService.listTestTypes();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = await testTypeService.createTestType(req.body);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id);
    const data = await testTypeService.updateTestType(id, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
