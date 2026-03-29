const tls = require("tls");
const dns = require("dns").promises;
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const TLS_TIMEOUT_MS = 8000;
const OPENSSL_TIMEOUT_MS = 10000;

// PQC hybrid groups to offer in ClientHello — in preference order.
// Note: X448MLKEM1024 is rejected by OpenSSL 3.6 s_client -groups flag.
const PQC_GROUPS = "X25519MLKEM768:SecP256r1MLKEM768:SecP384r1MLKEM1024:X25519:P-256:P-384";

// Known PQC/hybrid key exchange group names (IETF draft + NIST)
const PQC_KEM_GROUPS = new Set([
  "X25519MLKEM768",
  "SecP256r1MLKEM768",
  "SecP384r1MLKEM1024",
  "X25519Kyber768Draft00",
  "X25519Kyber512Draft00",
]);

// ─── OpenSSL Detection ───────────────────────────────────────────────────────

let _pqcOpensslBin = undefined; // undefined = not yet probed, null = not found

async function resolveOpensslPath() {
  // Try to find openssl in PATH
  try {
    const { stdout } = await execFileAsync("which", ["openssl"], { timeout: 2000 });
    const bin = stdout.trim();
    if (bin) return bin;
  } catch {
    // which not available or openssl not in PATH
  }
  return null;
}

async function findPqcOpenssl() {
  if (_pqcOpensslBin !== undefined) return _pqcOpensslBin;

  const pathBin = await resolveOpensslPath();

  const candidates = [
    process.env.PQC_OPENSSL_BIN,               // explicit override
    "/opt/homebrew/opt/openssl@3/bin/openssl", // Apple Silicon Homebrew
    "/usr/local/opt/openssl@3/bin/openssl",    // Intel Homebrew
    "/root/.nix-profile/bin/openssl",          // Nix profile (Railway/Linux)
    "/nix/var/nix/profiles/default/bin/openssl", // Nix system profile
    pathBin,                                   // system PATH fallback
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      const { stdout } = await execFileAsync(bin, ["list", "-kem-algorithms"], { timeout: 3000 });
      if (/X25519MLKEM768/i.test(stdout)) {
        _pqcOpensslBin = bin;
        return bin;
      }
    } catch {
      // not available at this path
    }
  }

  _pqcOpensslBin = null;
  return null;
}

// ─── PQC Key Exchange Probe ───────────────────────────────────────────────────

function parseKeyExchangeOutput(output) {
  const groupMatch = output.match(/Negotiated TLS1\.3 group:\s*(\S+)/i);
  const negotiatedGroup = groupMatch?.[1] || null;

  const protoMatch = output.match(/Protocol\s*:\s*(TLSv[\d.]+)/i);
  const protocol = protoMatch?.[1] || null;

  // Classical ephemeral key info — "Peer Temp Key" (TLS 1.3 -brief) or "Server Temp Key" (TLS 1.2)
  const tempKeyMatch = output.match(/(?:Peer|Server) Temp Key:\s*([^\n]+)/i);
  const serverTempKey = tempKeyMatch?.[1]?.trim() || null;

  const isPqcKem = negotiatedGroup ? PQC_KEM_GROUPS.has(negotiatedGroup) : false;

  return { negotiatedGroup, protocol, serverTempKey, isPqcKem, available: true };
}

// Stream openssl s_client output and kill the process as soon as the TLS
// handshake summary is complete — avoids waiting for the server's TLS
// close_notify which can stall for 5-10 s on keep-alive servers.
async function probeKeyExchange(opensslBin, domain) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;

    const child = spawn(opensslBin, [
      "s_client",
      "-connect", `${domain}:443`,
      "-servername", domain,
      "-groups", PQC_GROUPS,
      "-brief",
    ]);

    // Close stdin immediately so s_client doesn't block on input
    child.stdin.end();

    function finish() {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
    }

    function tryParse() {
      // The -brief handshake summary ends with a "Verify" line.
      // Kill the process as soon as we have it — no need to wait for TLS shutdown.
      if (/Verif(?:y return code|ication error)/i.test(output)) {
        finish();
      }
    }

    child.stdout.on("data", (d) => { output += d.toString(); tryParse(); });
    child.stderr.on("data", (d) => { output += d.toString(); tryParse(); });

    // Hard timeout — covers unreachable hosts and very slow servers
    const timer = setTimeout(finish, OPENSSL_TIMEOUT_MS);

    child.on("close", () => {
      clearTimeout(timer);
      if (!settled) settled = true;
      try {
        resolve(parseKeyExchangeOutput(output));
      } catch {
        resolve({ negotiatedGroup: null, protocol: null, serverTempKey: null, isPqcKem: false, available: false });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) settled = true;
      resolve({ negotiatedGroup: null, protocol: null, serverTempKey: null, isPqcKem: false, available: false, error: err.message });
    });
  });
}

// ─── Certificate Info (via Node.js TLS) ──────────────────────────────────────

async function getCertInfo(domain) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: domain,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
    });

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, TLS_TIMEOUT_MS);

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      try {
        const cert = socket.getPeerCertificate(false);
        const protocol = socket.getProtocol();
        socket.destroy();
        resolve({ cert, protocol });
      } catch {
        socket.destroy();
        resolve(null);
      }
    });

    socket.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function getDnsInfo(domain) {
  let hasTLSA = false;
  try {
    const records = await dns.resolve(`_443._tcp.${domain}`, "TLSA");
    hasTLSA = records.length > 0;
  } catch {
    hasTLSA = false;
  }
  return { hasTLSA };
}

function parseDaysUntilExpiry(validTo) {
  if (!validTo) return null;
  const date = new Date(validTo);
  if (isNaN(date.getTime())) return null;
  return Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── PQC-focused Scoring ─────────────────────────────────────────────────────
//
// Scoring philosophy: this is a PQC readiness tool, not a general TLS scanner.
// The primary threat model is "Harvest Now, Decrypt Later" (HNDL) —
// adversaries recording encrypted traffic today to decrypt with quantum
// computers tomorrow. Key exchange is the critical layer.
//
// Score breakdown (0–97, DANE bonus can push to 100):
//   Key Exchange   0–60  — the only layer that protects past sessions
//   TLS Protocol   0–20  — TLS 1.3 is a prerequisite for PQC KEM
//   Certificate    0–12  — authentication risk (less urgent than HNDL, informational)
//                          EC curves are not differentiated (all equally quantum-vulnerable)
//   DANE bonus     0–5   — certificate pinning independent of classical CA infrastructure

function computeScore(kemInfo, certData, dnsInfo) {
  let score = 0;
  const findings = [];

  // ── Key Exchange (0–60) ────────────────────────────────────────────────────
  if (!kemInfo.available) {
    // Can't detect — treat as unknown, don't penalise
    findings.push({
      level: "info",
      message: "PQC key exchange detection unavailable — install OpenSSL 3.2+ with ML-KEM support",
    });
  } else if (kemInfo.isPqcKem) {
    score += 60;
    findings.push({
      level: "good",
      message: `Post-quantum key exchange active: ${kemInfo.negotiatedGroup} — sessions protected against Harvest Now, Decrypt Later`,
    });
  } else if (kemInfo.negotiatedGroup) {
    // TLS 1.3 with classical key exchange
    score += 15;
    findings.push({
      level: "warn",
      message: `Classical key exchange only (${kemInfo.negotiatedGroup}) — sessions can be harvested today and decrypted when quantum computers arrive`,
    });
    findings.push({
      level: "info",
      message: "Server supports TLS 1.3 but has not yet enabled a PQC or hybrid key exchange group",
    });
  } else if (kemInfo.serverTempKey) {
    // Classical ephemeral key exchange (TLS 1.3 or TLS 1.2)
    // OpenSSL -brief reports "ECDH, prime256v1" for P-256 and "X25519, 253 bits" for X25519
    const isECDH = /ECDH|X25519|X448/i.test(kemInfo.serverTempKey);
    const isDHE = /\bDHE?\b/i.test(kemInfo.serverTempKey);
    if (isECDH) score += 10;
    else if (isDHE) score += 8;
    const tlsVer = kemInfo.protocol || certData?.protocol;
    findings.push({
      level: "warn",
      message: tlsVer === "TLSv1.3"
        ? `Classical key exchange (${kemInfo.serverTempKey.trim()}) — TLS 1.3 ready but PQC KEM not yet deployed`
        : `Classical key exchange via TLS 1.2 (${kemInfo.serverTempKey.trim()}) — upgrade to TLS 1.3 before PQC is possible`,
    });
  } else {
    findings.push({
      level: "warn",
      message: "Could not determine key exchange method",
    });
  }

  // ── TLS Protocol (0–20) ────────────────────────────────────────────────────
  const protocol = kemInfo.protocol || certData?.protocol;
  if (protocol === "TLSv1.3") {
    score += 20;
  } else if (protocol === "TLSv1.2") {
    score += 5;
    findings.push({
      level: "warn",
      message: "TLS 1.3 not negotiated — required for post-quantum key exchange support",
    });
  } else if (protocol) {
    findings.push({
      level: "critical",
      message: `Deprecated protocol: ${protocol} — upgrade to TLS 1.3 immediately`,
    });
  }

  // ── Certificate (0–20, informational) ─────────────────────────────────────
  // Note: in a hybrid deployment RSA/ECDSA certs alongside PQC key exchange
  // is current best practice (NIST SP 800-208 guidance). Classical certs are
  // NOT an immediate PQC failure — only the key exchange exposes past sessions.
  const cert = certData?.cert;
  if (cert && cert.subject) {
    const isEC = !!cert.asn1Curve;
    const bits = cert.bits || 0;

    if (isEC) {
      {
        score += 12;
        findings.push({ level: "info", message: `Certificate: ECDSA ${cert.asn1Curve} — classical, acceptable during PQC transition` });
      }
    } else if (bits >= 4096) {
      score += 8;
      findings.push({ level: "info", message: `Certificate: RSA-${bits} — quantum-vulnerable long-term; consider ECDSA during next renewal` });
    } else if (bits >= 2048) {
      score += 5;
      findings.push({ level: "info", message: `Certificate: RSA-${bits} — quantum-vulnerable; plan migration to ECDSA for post-quantum certificate readiness` });
    } else if (bits > 0) {
      findings.push({ level: "critical", message: `Certificate: RSA-${bits} — weak key, replace immediately` });
    }

    const daysLeft = parseDaysUntilExpiry(cert.valid_to);
    if (daysLeft !== null && daysLeft <= 30 && daysLeft > 0) {
      findings.push({ level: "warn", message: `Certificate expires in ${daysLeft} days` });
    } else if (daysLeft !== null && daysLeft <= 0) {
      findings.push({ level: "critical", message: "Certificate has expired" });
    }
  }

  // ── DANE/TLSA (bonus context, 0–5) ────────────────────────────────────────
  if (dnsInfo.hasTLSA) {
    score += 5;
    findings.push({ level: "good", message: "DANE/TLSA record found — certificate binding enforced at DNS layer" });
  }

  score = Math.min(100, Math.max(0, score));

  // Status thresholds aligned with NIST PQC migration phases
  let status;
  if (kemInfo.isPqcKem) {
    status = "readying";  // PQC KEM active — actively transitioning
  } else if (protocol === "TLSv1.3") {
    status = "partial";   // TLS 1.3 ready, awaiting PQC KEM rollout
  } else {
    status = "legacy";    // needs TLS 1.3 before PQC can happen
  }

  return { score, status, findings };
}

function buildNextActions(kemInfo, certData, dnsInfo) {
  const actions = [];
  const protocol = kemInfo.protocol || certData?.protocol;
  const cert = certData?.cert;

  if (!kemInfo.isPqcKem) {
    if (kemInfo.available) {
      actions.push(
        "Enable a PQC-hybrid key exchange group on your TLS terminator " +
        "(e.g., X25519MLKEM768 — already supported by Cloudflare, Nginx ≥ 1.27, OpenSSL ≥ 3.2)"
      );
    } else {
      actions.push("Test PQC key exchange support using a PQC-capable client (Chrome, Firefox, or openssl s_client with ML-KEM groups)");
    }
  }

  if (protocol !== "TLSv1.3") {
    actions.push("Enable TLS 1.3 on your server or load balancer — it is a prerequisite for all PQC cipher suites");
  }

  if (cert && !cert.asn1Curve && cert.bits) {
    actions.push(
      "Plan certificate migration to ECDSA (P-256/P-384) at your next renewal — " +
      "ML-DSA (Dilithium) certificates are the long-term PQC target but not yet broadly supported"
    );
  }

  if (!dnsInfo.hasTLSA) {
    actions.push("Consider DANE/TLSA records to pin certificates at the DNS layer, reducing reliance on classical CA infrastructure");
  }

  if (kemInfo.isPqcKem && (!cert || cert.asn1Curve)) {
    actions.push(
      "Monitor NIST PQC certificate standards (ML-DSA/Dilithium) — " +
      "when browser and CA ecosystem support matures, adopt PQC certificates to complete the transition"
    );
  }

  return actions;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function scanDomain(domain) {
  const opensslBin = await findPqcOpenssl();

  const [kemInfo, certData, dnsInfo] = await Promise.all([
    opensslBin
      ? probeKeyExchange(opensslBin, domain)
      : Promise.resolve({ negotiatedGroup: null, protocol: null, serverTempKey: null, isPqcKem: false, available: false }),
    getCertInfo(domain),
    getDnsInfo(domain),
  ]);

  const { score, status, findings } = computeScore(kemInfo, certData, dnsInfo);
  const cert = certData?.cert;
  const protocol = kemInfo.protocol || certData?.protocol;

  return {
    status,
    score,
    summary: {
      scan_version: "tls-pqc-v2",
      scan_mode: "live",
      scanned_target: domain,
      pqc_detection_available: opensslBin !== null,
      transport: {
        tls_version: protocol,
        key_exchange_group: kemInfo.negotiatedGroup || kemInfo.serverTempKey || null,
        pqc_kem_active: kemInfo.isPqcKem,
        forward_secrecy: kemInfo.isPqcKem ||
          !!(kemInfo.negotiatedGroup || (kemInfo.serverTempKey && /ECDH|X25519|X448|DHE/i.test(kemInfo.serverTempKey))),
      },
      certificate: cert && cert.subject ? {
        algorithm: cert.asn1Curve ? "EC" : "RSA",
        curve: cert.asn1Curve || null,
        bits: cert.bits || null,
        subject_cn: cert.subject?.CN || null,
        issuer_o: cert.issuer?.O || null,
        valid_to: cert.valid_to || null,
        days_until_expiry: parseDaysUntilExpiry(cert.valid_to),
      } : null,
      dns: {
        dane_tlsa: dnsInfo.hasTLSA,
      },
      pqc_outlook: {
        exposure_level: kemInfo.isPqcKem ? "lower" : protocol === "TLSv1.3" ? "medium" : "higher",
        findings,
        next_actions: buildNextActions(kemInfo, certData, dnsInfo),
      },
    },
    raw: {
      runner_key: "tls_scan",
      openssl_bin: opensslBin,
      negotiated_group: kemInfo.negotiatedGroup,
      server_temp_key: kemInfo.serverTempKey,
      protocol,
    },
  };
}

async function run(context) {
  const domain = context.domainTest.domain.domain;
  return scanDomain(domain);
}

module.exports = { run, scanDomain };
