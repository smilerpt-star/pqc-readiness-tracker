const express = require("express");
const cors = require("cors");

const healthRoutes = require("./routes/healthRoutes");
const domainRoutes = require("./routes/domainRoutes");
const testTypeRoutes = require("./routes/testTypeRoutes");
const domainTestRoutes = require("./routes/domainTestRoutes");
const runRoutes = require("./routes/runRoutes");
const publicRoutes = require("./routes/publicRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    /\.vercel\.app$/,
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

app.use("/health", healthRoutes);
app.use("/public", publicRoutes);
app.use("/domains", domainRoutes);
app.use("/test-types", testTypeRoutes);
app.use("/domain-tests", domainTestRoutes);
app.use("/runs", runRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
