const app = require("./app");
const { env } = require("./config/env");

app.listen(env.port, () => {
  console.log(`pqc-readiness-tracker listening on port ${env.port}`);
});
