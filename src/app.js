const express = require("express");
const cors = require("cors");

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

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    /\.vercel\.app$/,
    /\.railway\.app$/,
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: '10mb' }));

app.use("/health", healthRoutes);
app.use("/auth", authRoutes);
app.use("/public", publicRoutes);
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
