const app = require("./app");
const { env } = require("./config/env");
const { start: startScheduler } = require("./services/schedulerService");

app.listen(env.port, () => {
  console.log(`pqc-readiness-tracker listening on port ${env.port}`);
  startScheduler();
});
