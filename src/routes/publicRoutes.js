const express = require("express");
const { runPublicTest } = require("../services/publicTestService");

const router = express.Router();

router.post("/test", async (req, res, next) => {
  try {
    const data = await runPublicTest(req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
