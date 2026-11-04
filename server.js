const mongoose = require("mongoose");
const { getConfig, assertStartupConfig } = require("./config");
const { createApp } = require("./app");

async function main() {
  const cfg = getConfig();
  assertStartupConfig(cfg).forEach((w) => console.warn(`WARNING: ${w}`));

  await mongoose.connect(cfg.mongoUri);
  console.log("MongoDB connected");

  const server = createApp().listen(cfg.port, () => console.log(`CivicSlot API running on port ${cfg.port}`));

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
