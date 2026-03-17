const express = require("express");

const healthRoutes = require("./routes/healthRoutes");
const domainRoutes = require("./routes/domainRoutes");
const scanRoutes = require("./routes/scanRoutes");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();

app.use(express.json());

app.use("/health", healthRoutes);
app.use("/domains", domainRoutes);
app.use("/", scanRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
