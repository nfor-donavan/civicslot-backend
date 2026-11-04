const { HttpError } = require("./errors");
const { record } = require("./audit");
const { isRegion } = require("./regions");

// Region a caller is confined to; null = unrestricted (superadmin).
const callerRegion = (user) => (user.role === "admin" ? user.region : null);

// For list/aggregate endpoints with an optional ?region= filter.
//  - regional admin: always their own region; asking for another one is refused and logged
//  - superadmin: any valid region, or null for "all regions"
async function resolveRegionFilter(req, requested) {
  if (requested !== undefined && requested !== "" && typeof requested !== "string") {
    throw new HttpError(400, "Region is not valid");
  }
  if (req.user.role === "admin") {
    if (requested && requested !== req.user.region) {
      await record(req, {
        action: "security.cross_region_attempt",
        region: isRegion(requested) ? requested : null,
        details: { method: req.method, route: req.baseUrl + req.path, attemptedRegion: String(requested).slice(0, 30) },
      });
      throw new HttpError(403, "You can only access data for your assigned region");
    }
    return req.user.region;
  }
  if (requested) {
    if (!isRegion(requested)) throw new HttpError(400, "Region is not valid");
    return requested;
  }
  return null;
}

// A regional admin referenced a record that belongs to another region.
// Answered as "not found" (no existence oracle) and written to the audit log.
async function denyCrossRegion(req, { entityType, entityId, region }) {
  await record(req, {
    action: "security.cross_region_attempt",
    entityType,
    entityId,
    region: region || null,
    details: { method: req.method, route: req.baseUrl + req.route.path },
  });
  throw new HttpError(404, `${entityType === "service" ? "Service" : "Appointment"} not found`);
}

module.exports = { callerRegion, resolveRegionFilter, denyCrossRegion };
