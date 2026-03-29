const express = require("express");

const domainService = require("../services/domainService");
const { autoAssignTlsScan, runDomainTest } = require("../services/domainTestService");
const { requireAuth } = require("../middleware/auth");
const { parseIdParam } = require("../lib/validation");

const router = express.Router();

// When a domain becomes active, auto-assign a daily tls_scan test and
// fire the first run in the background so results appear immediately.
async function maybeAutoAssign(domain) {
  if (!domain.active) return;
  try {
    const result = await autoAssignTlsScan(domain.id);
    if (result?.created) {
      // Fire-and-forget — don't block the HTTP response
      runDomainTest(result.id, "auto").catch(() => {});
    }
  } catch {
    // Never let auto-assignment break the main operation
  }
}

router.get("/", async (req, res, next) => {
  try {
    const data = await domainService.listDomains();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = await domainService.createDomain(req.body);
    res.status(201).json({ data });
    maybeAutoAssign(data); // after response is sent
  } catch (error) {
    next(error);
  }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id);
    const data = await domainService.updateDomain(id, req.body);
    res.json({ data });
    maybeAutoAssign(data); // after response is sent
  } catch (error) {
    next(error);
  }
});

module.exports = router;
