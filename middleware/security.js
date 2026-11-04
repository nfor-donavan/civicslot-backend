const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { HttpError } = require("../utils/errors");

// Security headers. This API serves JSON only; CORP is relaxed so the browser
// portal (a different origin) can read responses allowed by the CORS policy.
const securityHeaders = () => helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } });

// CORS allow-list. Native mobile requests carry no Origin header and are not
// affected. In production an empty list blocks every browser origin.
function corsMiddleware(cfg) {
  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (cfg.corsOrigins.length === 0) return cb(null, !cfg.isProduction);
      return cb(null, cfg.corsOrigins.includes(origin.replace(/\/+$/, "")));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  });
}

// Rejects NoSQL operator injection ({"$gt": ""}, ?status[$ne]=x) and dotted keys.
function containsOperatorKeys(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => containsOperatorKeys(v, depth + 1));
  return Object.keys(value).some((k) => k.startsWith("$") || k.includes(".") || containsOperatorKeys(value[k], depth + 1));
}

function rejectOperatorKeys(req, res, next) {
  if (containsOperatorKeys(req.body) || containsOperatorKeys(req.query) || containsOperatorKeys(req.params)) {
    return next(new HttpError(400, "Request contains invalid characters"));
  }
  next();
}

function limiter(max, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ message: "Too many requests, please try again later." }),
  });
}

module.exports = {
  securityHeaders,
  corsMiddleware,
  rejectOperatorKeys,
  globalLimiter: (cfg) => limiter(cfg.rateLimitGlobalMax),
  authLimiter: (cfg) => limiter(cfg.rateLimitAuthMax),
};
