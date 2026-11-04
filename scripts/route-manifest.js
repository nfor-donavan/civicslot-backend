// Single source of truth for API access rules. Used by:
//  - tests/rbac.test.js  (fails if a route exists that is not listed here, or vice versa,
//                         and checks every non-public route really enforces its access level)
//  - scripts/generate-docs.js  (produces docs/generated/API_REFERENCE.md)
//
// access: public | auth (any signed-in user) | admin (regional admin or superadmin) | superadmin
// scoped: true when a regional admin is confined to their assigned region by the handler
module.exports = [
  { method: "GET", path: "/api/health", access: "public", summary: "Service and database status" },

  { method: "POST", path: "/api/auth/register", access: "public", summary: "Citizen self-registration (role is always citizen)" },
  { method: "POST", path: "/api/auth/login", access: "public", summary: "Mobile app login (all roles; session JWT_EXPIRES_IN)" },
  { method: "POST", path: "/api/auth/admin-login", access: "public", summary: "Web portal login (administrators only; session JWT_ADMIN_EXPIRES_IN)" },
  { method: "GET", path: "/api/auth/me", access: "auth", summary: "Current user profile" },
  { method: "PATCH", path: "/api/auth/me", access: "auth", summary: "Update own phone; citizens may also update home region" },
  { method: "POST", path: "/api/auth/change-password", access: "auth", summary: "Change own password (invalidates older tokens)" },
  { method: "POST", path: "/api/auth/create-admin", access: "superadmin", summary: "Create a regional administrator account" },
  { method: "GET", path: "/api/auth/admins", access: "superadmin", summary: "List regional administrators" },
  { method: "PATCH", path: "/api/auth/admins/:id", access: "superadmin", summary: "Edit name/phone/region, suspend or reactivate, reset password" },
  { method: "DELETE", path: "/api/auth/admins/:id", access: "superadmin", summary: "Remove a regional administrator" },

  { method: "GET", path: "/api/services", access: "public", scoped: true, summary: "Service catalogue (active only); admins may pass all=true, regional admins confined to their region" },
  { method: "GET", path: "/api/services/:id", access: "public", summary: "One service" },
  { method: "GET", path: "/api/services/:id/slots", access: "public", summary: "Availability for a date (capacity, full, past)" },
  { method: "POST", path: "/api/services", access: "admin", scoped: true, summary: "Create a service (regional admin: own region only)" },
  { method: "PUT", path: "/api/services/:id", access: "admin", scoped: true, summary: "Edit a service" },
  { method: "DELETE", path: "/api/services/:id", access: "admin", scoped: true, summary: "Delete a service that has no appointments" },

  { method: "POST", path: "/api/appointments", access: "auth", summary: "Book an appointment (starts as pending)" },
  { method: "GET", path: "/api/appointments/mine", access: "auth", summary: "Own appointments" },
  { method: "PATCH", path: "/api/appointments/:id/cancel", access: "auth", summary: "Cancel own appointment" },
  { method: "GET", path: "/api/appointments", access: "admin", scoped: true, summary: "List/filter/search/paginate appointments" },
  { method: "PATCH", path: "/api/appointments/:id/status", access: "admin", scoped: true, summary: "Confirm, decline, complete, mark no-show (state machine enforced)" },

  { method: "GET", path: "/api/candidates", access: "public", summary: "Civic Info candidate profiles (informational only)" },
  { method: "POST", path: "/api/candidates", access: "superadmin", summary: "Create a candidate profile" },
  { method: "PUT", path: "/api/candidates/:id", access: "superadmin", summary: "Edit a candidate profile" },
  { method: "DELETE", path: "/api/candidates/:id", access: "superadmin", summary: "Delete a candidate profile" },

  { method: "GET", path: "/api/admin/stats", access: "admin", scoped: true, summary: "Booking statistics (regional admin: own region; superadmin: platform or ?region=)" },
  { method: "GET", path: "/api/admin/audit", access: "superadmin", summary: "Read-only audit trail with filters and pagination" },
];
