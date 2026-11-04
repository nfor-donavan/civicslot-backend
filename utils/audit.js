const AuditLog = require("../models/AuditLog");

// Best-effort: an audit write failure is logged but never breaks the request.
async function record(req, { action, entityType = null, entityId = null, region = null, details = null, actor = undefined, actorName = undefined }) {
  try {
    const a = actor === undefined ? req.user : actor;
    await AuditLog.create({
      actor: a ? a._id : null,
      actorName: actorName !== undefined ? actorName : a ? a.fullName : "",
      actorRole: a ? a.role : "",
      actorRegion: a ? a.region || null : null,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      region,
      details,
      ip: req.ip || "",
      userAgent: (req.get && req.get("user-agent") ? req.get("user-agent") : "").slice(0, 200),
    });
  } catch (err) {
    console.error("audit write failed:", err.message);
  }
}

module.exports = { record };
