const express = require("express");
const mongoose = require("mongoose");
const { getConfig } = require("./config");
const { securityHeaders, corsMiddleware, rejectOperatorKeys, globalLimiter } = require("./middleware/security");
const createAuthRouter = require("./routes/authRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const candidateRoutes = require("./routes/candidateRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pkg = require("./package.json");

// Builds the Express app without opening a database connection or a port, so
// the same code is used by server.js and by the automated tests.
function createApp() {
  const cfg = getConfig();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);
  app.use(securityHeaders());
  app.use(corsMiddleware(cfg));
  app.use(globalLimiter(cfg));
  app.use(express.json({ limit: "100kb" }));
  app.use(rejectOperatorKeys);

  if (process.env.NODE_ENV !== "test") {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        // path only - query strings may contain personal data
        console.log(`${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - start}ms`);
      });
      next();
    });
  }

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "CivicSlot API",
      version: pkg.version,
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    });
  });

  app.use("/api/auth", createAuthRouter());
  app.use("/api/services", serviceRoutes);
  app.use("/api/appointments", appointmentRoutes);
  app.use("/api/candidates", candidateRoutes);
  app.use("/api/admin", adminRoutes);

  app.use((req, res) => res.status(404).json({ message: "Route not found" }));

  // Central error handler: internal details are logged, never returned.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.expose ? err.message : null;
    if (err.type === "entity.parse.failed") [status, message] = [400, "Malformed JSON body"];
    else if (err.type === "entity.too.large") [status, message] = [413, "Request body is too large"];
    else if (err.name === "ValidationError") [status, message] = [400, Object.values(err.errors)[0]?.message || "Validation failed"];
    else if (err.name === "CastError") [status, message] = [400, "Invalid identifier"];
    else if (err.code === 11000) [status, message] = [409, "A record with these details already exists"];

    if (status >= 500) {
      console.error(err);
      message = "Server error";
    }
    res.status(status).json({ message: message || "Request failed" });
  });

  return app;
}

module.exports = { createApp };
