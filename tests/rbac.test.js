const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const H = require("./helpers");
const manifest = require("../scripts/route-manifest");

const ID = "64b7f0f0f0f0f0f0f0f0f0f0";
const withId = (p) => p.replace(":id", ID);

describe("RBAC and regional isolation", () => {
  let h, superadmin, adminC, adminL, citizen, tSuper, tC, tL, tCit, svcC, svcL, apptC, apptL, addDays, todayString;

  before(async () => {
    h = await H.setup("rbac");
    ({ addDays, todayString } = require("../utils/time"));
    superadmin = await H.makeUser({ role: "superadmin" });
    adminC = await H.makeUser({ role: "admin", region: "Centre" });
    adminL = await H.makeUser({ role: "admin", region: "Littoral" });
    citizen = await H.makeUser({ role: "citizen" });
    [tSuper, tC, tL] = await Promise.all([superadmin, adminC, adminL].map((u) => H.loginAs(h, u)));
    tCit = await H.loginAs(h, citizen, { portal: false });
    svcC = await H.makeService("Centre");
    svcL = await H.makeService("Littoral");
    const date = addDays(todayString(), 1);
    apptC = (await h.call("POST", "/api/appointments", { token: tCit, body: { serviceId: String(svcC._id), date, time: "10:00" } })).body.appointment;
    apptL = (await h.call("POST", "/api/appointments", { token: tCit, body: { serviceId: String(svcL._id), date, time: "10:00" } })).body.appointment;
    assert.ok(apptC && apptL, "fixture bookings must succeed");
  });
  after(() => h.teardown());

  describe("deny-by-default route sweep", () => {
    it("the route manifest lists exactly the routes the app implements", () => {
      const actual = H.listRoutes(h.app).map((r) => `${r.method} ${r.path}`).sort();
      const declared = manifest.map((r) => `${r.method} ${r.path}`).sort();
      assert.deepEqual(actual, declared);
    });

    it("every non-public route rejects anonymous callers with 401", async () => {
      for (const r of manifest.filter((m) => m.access !== "public")) {
        const res = await h.call(r.method, withId(r.path), { body: r.method === "GET" ? undefined : {} });
        assert.equal(res.status, 401, `${r.method} ${r.path} should be 401 without a token, got ${res.status}`);
      }
    });

    it("admin and superadmin routes reject a citizen with 403", async () => {
      for (const r of manifest.filter((m) => m.access === "admin" || m.access === "superadmin")) {
        const res = await h.call(r.method, withId(r.path), { token: tCit, body: r.method === "GET" ? undefined : {} });
        assert.equal(res.status, 403, `${r.method} ${r.path} should be 403 for a citizen, got ${res.status}`);
      }
    });

    it("superadmin-only routes reject a regional administrator with 403", async () => {
      for (const r of manifest.filter((m) => m.access === "superadmin")) {
        const res = await h.call(r.method, withId(r.path), { token: tC, body: r.method === "GET" ? undefined : {} });
        assert.equal(res.status, 403, `${r.method} ${r.path} should be 403 for a regional admin, got ${res.status}`);
      }
    });

    it("public routes work without a token", async () => {
      assert.equal((await h.call("GET", "/api/health")).status, 200);
      assert.equal((await h.call("GET", "/api/services")).status, 200);
      assert.equal((await h.call("GET", "/api/candidates")).status, 200);
    });
  });

  describe("a regional administrator only reaches their own region", () => {
    it("appointment list contains only their region", async () => {
      const r = await h.call("GET", "/api/appointments", { token: tC });
      assert.equal(r.status, 200);
      assert.equal(r.body.total, 1);
      assert.ok(r.body.appointments.every((a) => a.service.region === "Centre"));
    });

    it("asking for another region is refused (403) and logged", async () => {
      const r = await h.call("GET", "/api/appointments?region=Littoral", { token: tC });
      assert.equal(r.status, 403);
    });

    it("filtering by another region's service returns 404, not data", async () => {
      const r = await h.call("GET", `/api/appointments?serviceId=${svcL._id}`, { token: tC });
      assert.equal(r.status, 404);
    });

    it("cannot change the status of another region's appointment (404) and nothing changes", async () => {
      const r = await h.call("PATCH", `/api/appointments/${apptL._id}/status`, { token: tC, body: { status: "confirmed" } });
      assert.equal(r.status, 404);
      const check = await h.call("GET", `/api/appointments?serviceId=${svcL._id}`, { token: tL });
      assert.equal(check.body.appointments[0].status, "pending");
    });

    it("cannot edit or delete another region's service (404)", async () => {
      assert.equal((await h.call("PUT", `/api/services/${svcL._id}`, { token: tC, body: { name: "Hacked" } })).status, 404);
      assert.equal((await h.call("DELETE", `/api/services/${svcL._id}`, { token: tC })).status, 404);
      const still = await h.call("GET", `/api/services/${svcL._id}`);
      assert.notEqual(still.body.service.name, "Hacked");
    });

    it("cannot create a service in another region (403); region defaults to their own", async () => {
      const body = { name: "New", office: "Somewhere", durationMinutes: 30, capacityPerSlot: 2 };
      assert.equal((await h.call("POST", "/api/services", { token: tC, body: { ...body, region: "Littoral" } })).status, 403);
      const ok = await h.call("POST", "/api/services", { token: tC, body });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.service.region, "Centre");
    });

    it("cannot move their own service to another region (403)", async () => {
      const r = await h.call("PUT", `/api/services/${svcC._id}`, { token: tC, body: { region: "Littoral" } });
      assert.equal(r.status, 403);
    });

    it("statistics are limited to their region; requesting another is 403", async () => {
      const r = await h.call("GET", "/api/admin/stats", { token: tC });
      assert.equal(r.status, 200);
      assert.equal(r.body.scope.region, "Centre");
      assert.equal(r.body.totals.total, 1);
      assert.equal(r.body.byRegion, undefined, "regional admins get no cross-region breakdown");
      assert.equal(r.body.platform, undefined);
      assert.equal((await h.call("GET", "/api/admin/stats?region=Littoral", { token: tC })).status, 403);
    });

    it("service management list (all=true) is confined to their region", async () => {
      const r = await h.call("GET", "/api/services?all=true&region=Littoral", { token: tC });
      assert.equal(r.status, 200);
      assert.ok(r.body.services.length > 0 && r.body.services.every((s) => s.region === "Centre"));
    });

    it("a forged token claiming superadmin does not elevate the role (role comes from the database)", async () => {
      const forged = jwt.sign({ id: String(adminC._id), role: "superadmin" }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });
      assert.equal((await h.call("GET", "/api/admin/audit", { token: forged })).status, 403);
      assert.equal((await h.call("GET", "/api/auth/admins", { token: forged })).status, 403);
    });

    it("a token signed with the wrong secret or with alg=none is rejected", async () => {
      const wrong = jwt.sign({ id: String(adminC._id), role: "admin" }, "not-the-secret", { algorithm: "HS256" });
      assert.equal((await h.call("GET", "/api/appointments", { token: wrong })).status, 401);
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ id: String(adminC._id), role: "superadmin" })).toString("base64url")}.`;
      assert.equal((await h.call("GET", "/api/admin/audit", { token: none })).status, 401);
    });
  });

  describe("superadmin has platform-wide reach", () => {
    it("sees both regions and can narrow with ?region=", async () => {
      const all = await h.call("GET", "/api/appointments", { token: tSuper });
      assert.equal(all.body.total, 2);
      const one = await h.call("GET", "/api/appointments?region=Littoral", { token: tSuper });
      assert.equal(one.body.total, 1);
      assert.equal(one.body.appointments[0].service.region, "Littoral");
    });

    it("can act on any region's appointment", async () => {
      const r = await h.call("PATCH", `/api/appointments/${apptL._id}/status`, { token: tSuper, body: { status: "confirmed" } });
      assert.equal(r.status, 200);
    });
  });

  describe("region assignment changes take effect immediately", () => {
    it("moving an admin to another region changes what the existing token can see", async () => {
      const before = await h.call("GET", "/api/appointments", { token: tC });
      assert.ok(before.body.appointments.every((a) => a.service.region === "Centre"));
      const mv = await h.call("PATCH", `/api/auth/admins/${adminC._id}`, { token: tSuper, body: { region: "Littoral" } });
      assert.equal(mv.status, 200);
      const after = await h.call("GET", "/api/appointments", { token: tC });
      assert.ok(after.body.appointments.length > 0 && after.body.appointments.every((a) => a.service.region === "Littoral"));
      await h.call("PATCH", `/api/auth/admins/${adminC._id}`, { token: tSuper, body: { region: "Centre" } });
    });
  });

  describe("malformed and hostile input", () => {
    it("NoSQL operator injection is rejected with 400", async () => {
      assert.equal((await h.call("GET", "/api/appointments?status[$ne]=x", { token: tC })).status, 400);
      assert.equal((await h.call("GET", "/api/appointments?serviceId[$ne]=x", { token: tC })).status, 400);
      assert.equal((await h.call("GET", "/api/appointments?region[$ne]=Centre", { token: tC })).status, 400);
      assert.equal((await h.call("POST", "/api/auth/login", { body: { email: { $gt: "" }, password: { $gt: "" } } })).status, 400);
      assert.equal((await h.call("POST", "/api/auth/admin-login", { body: { email: "a@b.cm", "password.x": "y" } })).status, 400);
    });

    it("invalid identifiers return 400, never a server error", async () => {
      assert.equal((await h.call("PATCH", "/api/appointments/not-an-id/status", { token: tC, body: { status: "confirmed" } })).status, 400);
      assert.equal((await h.call("PUT", "/api/services/xyz", { token: tC, body: {} })).status, 400);
      assert.equal((await h.call("GET", "/api/services/xyz")).status, 400);
    });
  });

  describe("blocked attempts are recorded", () => {
    it("the audit trail contains the cross-region attempts, readable only by a superadmin", async () => {
      const r = await h.call("GET", "/api/admin/audit?category=security", { token: tSuper });
      assert.equal(r.status, 200);
      assert.ok(r.body.entries.length >= 5, `expected several security events, got ${r.body.entries.length}`);
      assert.ok(r.body.entries.every((e) => e.action.startsWith("security.")));
      assert.ok(r.body.entries.some((e) => e.actorName === adminC.fullName && e.actorRole === "admin"));
      assert.equal((await h.call("GET", "/api/admin/audit", { token: tL })).status, 403);
    });
  });
});
