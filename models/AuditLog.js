const mongoose = require("mongoose");

// Append-only record of administrative and security-relevant events.
// Written by utils/audit.js; there is no API to edit or delete entries.
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, default: "" }, // denormalised; attempted e-mail for failed logins
    actorRole: { type: String, default: "" },
    actorRegion: { type: String, default: null },
    action: { type: String, required: true, index: true }, // e.g. appointment.status_changed
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    region: { type: String, default: null, index: true }, // region the event relates to
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
