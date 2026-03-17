const express = require("express");

const {
  createScanForDomain,
  getScanHistoryByDomain
} = require("../services/scanService");

const router = express.Router();

router.post("/scan", async (req, res, next) => {
  try {
    const scan = await createScanForDomain(req.body);

    res.status(201).json({
      data: scan
    });
  } catch (error) {
    next(error);
  }
});

router.get("/scans/:domain", async (req, res, next) => {
  try {
    const scanHistory = await getScanHistoryByDomain(req.params.domain);

    res.json({
      data: scanHistory
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
