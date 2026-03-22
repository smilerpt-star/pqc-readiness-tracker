const express = require("express");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");

const execFileAsync = promisify(execFile);
const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "pqc-readiness-tracker",
    timestamp: new Date().toISOString()
  });
});

// Temporary debug endpoint — remove after OpenSSL path is confirmed
router.get("/openssl-debug", async (req, res) => {
  const candidates = [
    process.env.PQC_OPENSSL_BIN,
    "/root/.nix-profile/bin/openssl",
    "/nix/var/nix/profiles/default/bin/openssl",
    "/usr/bin/openssl",
    "/usr/local/bin/openssl",
  ].filter(Boolean);

  const results = {};

  for (const p of candidates) {
    const exists = fs.existsSync(p);
    let version = null;
    let hasMlKem = false;
    if (exists) {
      try {
        const v = await execFileAsync(p, ["version"], { timeout: 3000 });
        version = v.stdout.trim();
      } catch {}
      try {
        const k = await execFileAsync(p, ["list", "-kem-algorithms"], { timeout: 3000 });
        hasMlKem = /X25519MLKEM768/i.test(k.stdout);
      } catch {}
    }
    results[p] = { exists, version, hasMlKem };
  }

  try {
    const w = await execFileAsync("which", ["openssl"], { timeout: 2000 });
    results._which = w.stdout.trim();
  } catch { results._which = null; }

  res.json(results);
});

module.exports = router;
