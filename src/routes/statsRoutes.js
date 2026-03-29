const express = require("express");
const statsService = require("../services/statsService");
const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const data = await statsService.getStats();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
