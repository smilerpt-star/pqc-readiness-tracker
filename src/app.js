const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const healthRoutes = require("./routes/healthRoutes");
const authRoutes = require("./routes/authRoutes");
const domainRoutes = require("./routes/domainRoutes");
const testTypeRoutes = require("./routes/testTypeRoutes");
const domainTestRoutes = require("./routes/domainTestRoutes");
const runRoutes = require("./routes/runRoutes");
const publicRoutes = require("./routes/publicRoutes");
const statsRoutes = require("./routes/statsRoutes");
const indexRoutes = require("./routes/indexRoutes");
const configRoutes = require("./routes/configRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

// Running behind Railway's proxy — required so req.ip is the real client IP
// (used by rate limiting), not the proxy's.
app.set("trust proxy", 1);

// Security headers.
app.use(helmet());

// Explicit allow-list of origins that may call the API from a browser.
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://pqctracker.com",
  "https://www.pqctracker.com",
  "https://pqc-tracker-production.up.railway.app",
];
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: '10mb' }));

// General API rate limit, plus a stricter one for the unauthenticated public
// scanner (each call spawns an openssl process).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
const publicLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests", message: "Rate limit exceeded — please try again later." },
});
app.use(apiLimiter);

app.use("/health", healthRoutes);
app.use("/auth", authRoutes);
app.use("/public", publicLimiter, publicRoutes);
app.use("/domains", domainRoutes);
app.use("/test-types", testTypeRoutes);
app.use("/domain-tests", domainTestRoutes);
app.use("/runs", runRoutes);
app.use("/stats", statsRoutes);
app.use("/indexes", indexRoutes);
app.use("/config", configRoutes);

const schedulerService = require("./services/schedulerService");
app.post("/scheduler/run-now", require("./middleware/auth").requireAuth, async (req, res, next) => {
  try {
    const result = await schedulerService.runAll("manual");
    res.json({ data: result });
  } catch (e) { next(e); }
});
app.get("/scheduler/status", async (req, res) => {
  res.json({
    data: {
      running: schedulerService.isRunning(),
      last_run: schedulerService.getLastRunStats(),
    }
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
