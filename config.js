// Central, validated configuration. Values are read from process.env on every
// call so tests can override them before building an app instance.
require("dotenv").config();

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getConfig(env = process.env) {
  const trustRaw = env.TRUST_PROXY;
  return {
    nodeEnv: env.NODE_ENV || "development",
    isProduction: env.NODE_ENV === "production",
    port: int(env.PORT, 5000),
    mongoUri: env.MONGO_URI,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || "7d",
    jwtAdminExpiresIn: env.JWT_ADMIN_EXPIRES_IN || "8h",
    corsOrigins: (env.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    timezone: env.APP_TIMEZONE || "Africa/Douala",
    trustProxy: trustRaw === undefined ? 1 : trustRaw === "false" ? false : int(trustRaw, 1),
    rateLimitAuthMax: int(env.RATE_LIMIT_AUTH_MAX, 60),
    rateLimitGlobalMax: int(env.RATE_LIMIT_GLOBAL_MAX, 1500),
    maxFailedLogins: int(env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(env.LOCKOUT_MINUTES, 15),
  };
}

// Fails fast on missing critical settings; warns about weak ones.
function assertStartupConfig(cfg = getConfig()) {
  const missing = [];
  if (!cfg.mongoUri) missing.push("MONGO_URI");
  if (!cfg.jwtSecret) missing.push("JWT_SECRET");
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const warnings = [];
  if (cfg.jwtSecret.length < 32) {
    warnings.push("JWT_SECRET is shorter than 32 characters - use a long random value.");
  }
  if (cfg.isProduction && cfg.corsOrigins.length === 0) {
    warnings.push("CORS_ORIGINS is empty - browser origins (the web portal) will be blocked.");
  }
  return warnings;
}

module.exports = { getConfig, assertStartupConfig };
