const express = require("express");

const domainService = require("../services/domainService");
const { autoAssignTlsScan, runDomainTest } = require("../services/domainTestService");
const { requireAuth, isAdmin } = require("../middleware/auth");
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
    // `notes` can hold submitter details from public submissions — admin only.
    res.json({ data: isAdmin(req) ? data : (data || []).map(({ notes, ...rest }) => rest) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    let body = req.body;
    if (!isAdmin(req)) {
      // Public submission: always pending review, whatever the client sends.
      // Only an admin can create an active (monitored) domain.
      const notes = typeof body?.notes === "string" ? body.notes : "";
      body = {
        ...body,
        active: false,
        notes: notes.includes("Source: public submission") ? notes : [notes, "Source: public submission"].filter(Boolean).join("\n"),
      };
    }
    const data = await domainService.createDomain(body);
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
