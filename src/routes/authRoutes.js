const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Protected ping — used by the frontend login page to validate a token
router.get("/verify", requireAuth, (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
