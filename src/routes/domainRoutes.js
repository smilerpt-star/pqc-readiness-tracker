const express = require("express");

const {
  createDomain,
  listDomains
} = require("../services/domainService");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const domain = await createDomain(req.body);

    res.status(201).json({
      data: domain
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const domains = await listDomains();

    res.json({
      data: domains
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
