const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");

describe("Statistics, service management, candidates and audit", () => {
  let h, T, tSuper, tC, tL, c1, c2, c3, svcA, svcB, svcL, day;

  before(async () => {
    h = await H.setup("adminfeatures");
    T = require("../utils/time");
    const superadmin = await H.makeUser({ role: "superadmin" });
    const adminC = await H.makeUser({ role: "admin", region: "Centre" });
    const adminL = await H.makeUser({ role: "admin", region: "Littoral" });
    [tSuper, tC, tL] = await Promise.all([superadmin, adminC, adminL].map((u) => H.loginAs(h, u)));
    const citizens = await Promise.all([1, 2, 3].map(() => H.makeUser({ role: "citizen" })));
    [c1, c2, c3] = await Promise.all(citizens.map((c) => H.loginAs(h, c, { portal: false })));
    svcA = await H.makeService("Centre", { capacityPerSlot: 5 });
    svcB = await H.makeService("Centre", { capacityPerSlot: 5 });
    svcL = await H.makeService("Littoral", { capacityPerSlot: 5 });
    day = T.addDays(T.todayString(), 1);

    const book = async (tok, svc, d, time) => (await h.call("POST", "/api/appointments", { token: tok, body: { serviceId: String(svc._id), date: d, time } })).body.appointment;
    const set = (a, status, tok = tC) => h.call("PATCH", `/api/appointments/${a._id}/status`, { token: tok, body: { status } });

    // Centre: 4 bookings -> 1 pending, 1 completed, 1 cancelled, 1 no-show
    const a1 = await book(c1, svcA, day, "09:00");
    const a2 = await book(c2, svcA, day, "09:00");
    const a3 = await book(c3, svcA, day, "09:00");
    const b1 = await book(c1, svcB, day, "10:00");
    await set(a1, "confirmed");
    await set(a1, "completed");
    await set(a2, "cancelled");
    await set(b1, "confirmed");
    await set(b1, "no_show");
    void a3; // stays pending
    // Littoral: 2 pending
    await book(c1, svcL, day, "09:00");
    await book(c2, svcL, day, "09:00");
  });
  after(() => h.teardown());

  describe("statistics", () => {
    it("regional admin: exact counts and rates for their region only", async () => {
      const r = await h.call("GET", "/api/admin/stats", { token: tC });
      assert.equal(r.status, 200);
      assert.deepEqual(
        { total: r.body.totals.total, pending: r.body.totals.pending, completed: r.body.totals.completed, cancelled: r.body.totals.cancelled, no_show: r.body.totals.no_show, confirmed: r.body.totals.confirmed },
        { total: 4, pending: 1, completed: 1, cancelled: 1, no_show: 1, confirmed: 0 }
      );
      assert.equal(r.body.rates.attendancePercent, 50);
      assert.equal(r.body.rates.noShowPercent, 50);
      assert.equal(r.body.rates.cancellationPercent, 25);
      assert.equal(r.body.byService.length, 2);
      assert.equal(r.body.byService.reduce((n, s) => n + s.total, 0), 4);
      const dayRow = r.body.daily.find((d) => d.date === day);
      assert.equal(dayRow.total, 4);
      assert.equal(r.body.upcoming7, 3, "cancelled bookings are not counted as upcoming");
      assert.equal(r.body.daily.length, 21);
    });

    it("the other region sees different numbers", async () => {
      const r = await h.call("GET", "/api/admin/stats", { token: tL });
      assert.equal(r.body.totals.total, 2);
      assert.equal(r.body.totals.pending, 2);
      assert.equal(r.body.rates.attendancePercent, null, "no completed/no-show yet");
    });

    it("superadmin: platform totals, per-region breakdown, platform counters, optional region filter", async () => {
      const r = await h.call("GET", "/api/admin/stats", { token: tSuper });
      assert.equal(r.body.totals.total, 6);
      const by = Object.fromEntries(r.body.byRegion.map((x) => [x.region, x]));
      assert.equal(by.Centre.total, 4);
      assert.equal(by.Centre.admins, 1);
      assert.equal(by.Littoral.total, 2);
      assert.equal(by.Sud.total, 0);
      assert.equal(by.Sud.admins, 0, "uncovered regions are visible");
      assert.equal(r.body.byRegion.length, 10);
      assert.deepEqual([r.body.platform.citizens, r.body.platform.regionalAdmins, r.body.platform.services], [3, 2, 3]);
      const one = await h.call("GET", "/api/admin/stats?region=Littoral", { token: tSuper });
      assert.equal(one.body.totals.total, 2);
      assert.equal(one.body.byRegion, undefined);
      assert.equal((await h.call("GET", "/api/admin/stats?region=Atlantis", { token: tSuper })).status, 400);
    });

    it("clamps the reporting window", async () => {
      assert.equal((await h.call("GET", "/api/admin/stats?days=1", { token: tC })).body.window.days, 7);
      assert.equal((await h.call("GET", "/api/admin/stats?days=500", { token: tC })).body.window.days, 60);
    });
  });

  describe("service management", () => {
    const good = { name: "Marriage Certificate", office: "Council Hall", durationMinutes: 30, capacityPerSlot: 3, openTime: "08:00", closeTime: "15:00" };

    it("validates every field", async () => {
      const bad = async (patch) => (await h.call("POST", "/api/services", { token: tC, body: { ...good, ...patch } })).status;
      assert.equal(await bad({ name: "" }), 400);
      assert.equal(await bad({ durationMinutes: 2 }), 400);
      assert.equal(await bad({ capacityPerSlot: 0 }), 400);
      assert.equal(await bad({ openTime: "8am" }), 400);
      assert.equal(await bad({ openTime: "16:00", closeTime: "09:00" }), 400);
      assert.equal(await bad({ workingDays: [9] }), 400);
      assert.equal(await bad({ category: "weapons" }), 400);
      assert.equal(await bad({ name: 42 }), 400);
    });

    it("ignores fields clients must not set (no mass assignment)", async () => {
      const r = await h.call("POST", "/api/services", { token: tC, body: { ...good, createdAt: "2000-01-01T00:00:00Z", _id: "64b7f0f0f0f0f0f0f0f0f0f1" } });
      assert.equal(r.status, 201);
      assert.notEqual(r.body.service._id, "64b7f0f0f0f0f0f0f0f0f0f1");
      assert.ok(new Date(r.body.service.createdAt).getFullYear() >= 2026);
    });

    it("edits, deactivates and deletes an unused service; records each change", async () => {
      const created = (await h.call("POST", "/api/services", { token: tC, body: good })).body.service;
      const upd = await h.call("PUT", `/api/services/${created._id}`, { token: tC, body: { capacityPerSlot: 6, active: false } });
      assert.equal(upd.body.service.capacityPerSlot, 6);
      assert.equal(upd.body.service.active, false);
      assert.equal((await h.call("PUT", `/api/services/${created._id}`, { token: tC, body: {} })).status, 400);
      assert.equal((await h.call("DELETE", `/api/services/${created._id}`, { token: tC })).status, 200);
      const log = await h.call("GET", "/api/admin/audit?category=service", { token: tSuper });
      const actions = log.body.entries.map((e) => e.action);
      assert.ok(["service.created", "service.updated", "service.deleted"].every((a) => actions.includes(a)));
    });

    it("a superadmin must pick a region and may move a service between regions", async () => {
      assert.equal((await h.call("POST", "/api/services", { token: tSuper, body: good })).status, 400);
      const s = await h.call("POST", "/api/services", { token: tSuper, body: { ...good, region: "Ouest" } });
      assert.equal(s.status, 201);
      const mv = await h.call("PUT", `/api/services/${s.body.service._id}`, { token: tSuper, body: { region: "Sud" } });
      assert.equal(mv.body.service.region, "Sud");
    });

    it("inactive services are hidden from the public catalogue", async () => {
      const s = (await h.call("POST", "/api/services", { token: tC, body: { ...good, name: "Hidden One", active: false } })).body.service;
      const pub = await h.call("GET", "/api/services");
      assert.ok(!pub.body.services.some((x) => x._id === s._id));
      const anonAll = await h.call("GET", "/api/services?all=true");
      assert.ok(!anonAll.body.services.some((x) => x._id === s._id), "anonymous all=true is ignored");
      const adminAll = await h.call("GET", "/api/services?all=true", { token: tC });
      assert.ok(adminAll.body.services.some((x) => x._id === s._id));
    });
  });

  describe("candidate profiles (Civic Info)", () => {
    const pres = { fullName: "Candidate One", position: "president", party: "Independent", bio: "Public biography", photoUrl: "", sourceUrl: "https://example.org/profile" };

    it("superadmin creates, edits, hides and deletes; president is always national", async () => {
      const c = await h.call("POST", "/api/candidates", { token: tSuper, body: { ...pres, region: "Centre" } });
      assert.equal(c.status, 201);
      assert.equal(c.body.candidate.region, null);
      const id = c.body.candidate._id;
      assert.equal((await h.call("PUT", `/api/candidates/${id}`, { token: tSuper, body: { active: false } })).status, 200);
      const pub = await h.call("GET", "/api/candidates");
      assert.ok(!pub.body.candidates.some((x) => x._id === id), "inactive profiles are not public");
      assert.ok((await h.call("GET", "/api/candidates?all=true", { token: tSuper })).body.candidates.some((x) => x._id === id));
      assert.ok(!(await h.call("GET", "/api/candidates?all=true", { token: tC })).body.candidates.some((x) => x._id === id), "all=true is superadmin-only");
      assert.equal((await h.call("DELETE", `/api/candidates/${id}`, { token: tSuper })).status, 200);
    });

    it("senators need a region; links must be http(s)", async () => {
      assert.equal((await h.call("POST", "/api/candidates", { token: tSuper, body: { ...pres, position: "senator" } })).status, 400);
      assert.equal((await h.call("POST", "/api/candidates", { token: tSuper, body: { ...pres, position: "senator", region: "Ouest" } })).status, 201);
      assert.equal((await h.call("POST", "/api/candidates", { token: tSuper, body: { ...pres, sourceUrl: "javascript:alert(1)" } })).status, 400);
      assert.equal((await h.call("POST", "/api/candidates", { token: tSuper, body: { ...pres, photoUrl: "data:text/html;base64,AAAA" } })).status, 400);
      assert.equal((await h.call("POST", "/api/candidates", { token: tSuper, body: { ...pres, position: "king" } })).status, 400);
    });

    it("regional administrators cannot change candidates", async () => {
      assert.equal((await h.call("POST", "/api/candidates", { token: tC, body: pres })).status, 403);
    });
  });

  describe("audit trail", () => {
    it("filters, paginates and rejects bad parameters", async () => {
      const all = await h.call("GET", "/api/admin/audit?limit=3&page=1", { token: tSuper });
      assert.equal(all.status, 200);
      assert.equal(all.body.entries.length, 3);
      assert.ok(all.body.total > 3 && all.body.pages > 1);
      assert.ok(all.body.entries[0].createdAt >= all.body.entries[1].createdAt, "newest first");
      const region = await h.call("GET", "/api/admin/audit?region=Littoral", { token: tSuper });
      assert.ok(region.body.entries.every((e) => e.region === "Littoral"));
      assert.equal((await h.call("GET", "/api/admin/audit?category=nope", { token: tSuper })).status, 400);
      assert.equal((await h.call("GET", "/api/admin/audit?region=Atlantis", { token: tSuper })).status, 400);
      assert.equal((await h.call("GET", "/api/admin/audit?from=bad", { token: tSuper })).status, 400);
      assert.equal((await h.call("GET", "/api/admin/audit?action=drop%20table", { token: tSuper })).status, 400);
    });

    it("is append-only: there is no route that edits or deletes entries", async () => {
      for (const m of ["PUT", "PATCH", "DELETE", "POST"]) {
        const r = await h.call(m, "/api/admin/audit", { token: tSuper, body: {} });
        assert.equal(r.status, 404, `${m} /api/admin/audit must not exist`);
      }
    });
  });
});
