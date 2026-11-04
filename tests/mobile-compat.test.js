// Replays the exact request shapes used by the existing Expo mobile app
// (see mobile/screens/*.js) to prove the backend changes did not break it.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");

describe("Mobile app backward compatibility", () => {
  let h, T, citizenToken, regionalToken, superToken, svc, appt;

  before(async () => {
    h = await H.setup("mobilecompat");
    T = require("../utils/time");
    await H.makeUser({ role: "superadmin", email: "admin@civicslot.cm" });
    await H.makeUser({ role: "admin", region: "Centre", email: "centre.admin@civicslot.cm" });
    svc = await H.makeService("Centre", { name: "National ID Card (CNI)", capacityPerSlot: 4 });
    await H.makeService("Littoral", { name: "National ID Card (CNI)" });
  });
  after(() => h.teardown());

  it("citizen: register -> login -> region filter -> slots -> book -> list -> cancel", async () => {
    const reg = await h.call("POST", "/api/auth/register", { body: { fullName: "Nfor Test", email: "nfor@test.cm", phone: "", password: "secret1", region: null } });
    assert.equal(reg.status, 201);
    assert.ok(reg.body.token && reg.body.user.id && reg.body.user.fullName && reg.body.user.email && reg.body.user.role === "citizen" && "region" in reg.body.user);

    const login = await h.call("POST", "/api/auth/login", { body: { email: "nfor@test.cm", password: "secret1" } });
    assert.equal(login.status, 200);
    citizenToken = login.body.token;

    const services = await h.call("GET", "/api/services?region=Centre", { token: citizenToken });
    assert.ok(Array.isArray(services.body.services) && services.body.services.every((s) => s.region === "Centre"));
    assert.ok(["name", "office", "region", "icon", "_id"].every((k) => k in services.body.services[0]));

    const date = T.addDays(T.todayString(), 2);
    const slots = await h.call("GET", `/api/services/${svc._id}/slots?date=${date}`, { token: citizenToken });
    assert.equal(slots.body.closed, false);
    assert.ok(["time", "remaining", "full", "past"].every((k) => k in slots.body.slots[0]));

    const booked = await h.call("POST", "/api/appointments", { token: citizenToken, body: { serviceId: String(svc._id), date, time: "10:00" } });
    assert.equal(booked.status, 201);
    appt = booked.body.appointment;
    assert.ok(appt.reference && appt.service.name && appt.status === "pending");

    const mine = await h.call("GET", "/api/appointments/mine", { token: citizenToken });
    assert.equal(mine.body.appointments.length, 1);
    assert.equal(mine.body.appointments[0].service.name, "National ID Card (CNI)");

    const me = await h.call("PATCH", "/api/auth/me", { token: citizenToken, body: { region: "Littoral" } });
    assert.equal(me.body.user.region, "Littoral");
  });

  it("regional admin: the lists and actions used by the mobile admin screens", async () => {
    const login = await h.call("POST", "/api/auth/login", { body: { email: "centre.admin@civicslot.cm", password: H.PASSWORD } });
    regionalToken = login.body.token;
    assert.equal(login.body.user.role, "admin");

    const all = await h.call("GET", "/api/appointments", { token: regionalToken });
    assert.ok(Array.isArray(all.body.appointments) && all.body.appointments.length === 1, "no params -> plain list in `appointments`");
    assert.equal(all.body.appointments[0].user.fullName, "Nfor Test");
    assert.equal((await h.call("GET", "/api/appointments?status=pending", { token: regionalToken })).body.appointments.length, 1);

    const confirm = await h.call("PATCH", `/api/appointments/${appt._id}/status`, { token: regionalToken, body: { status: "confirmed" } });
    assert.equal(confirm.status, 200);
    assert.equal((await h.call("PATCH", `/api/appointments/${appt._id}/status`, { token: regionalToken, body: { status: "completed" } })).status, 200);

    const mgmt = await h.call("GET", "/api/services?all=true", { token: regionalToken });
    assert.ok(mgmt.body.services.length >= 1 && mgmt.body.services.every((s) => s.region === "Centre"));

    const newSvc = await h.call("POST", "/api/services", {
      token: regionalToken,
      body: { name: "Mobile Made", office: "Somewhere", description: "", durationMinutes: 30, capacityPerSlot: 3, openTime: "08:00", closeTime: "15:30", region: "Centre" },
    });
    assert.equal(newSvc.status, 201);
    assert.equal((await h.call("PUT", `/api/services/${newSvc.body.service._id}`, { token: regionalToken, body: { active: false } })).status, 200);
  });

  it("superadmin: candidates and administrator management as used by the mobile screens", async () => {
    superToken = (await h.call("POST", "/api/auth/login", { body: { email: "admin@civicslot.cm", password: H.PASSWORD } })).body.token;

    const cand = await h.call("POST", "/api/candidates", {
      token: superToken,
      body: { fullName: "Jane Doe", position: "president", region: null, party: "Independent", bio: "Bio", photoUrl: "", sourceUrl: "" },
    });
    assert.equal(cand.status, 201);
    const list = await h.call("GET", "/api/candidates?all=true", { token: superToken });
    assert.ok(list.body.candidates.some((c) => c.fullName === "Jane Doe"));
    assert.equal((await h.call("GET", "/api/candidates?position=president")).body.candidates.length, 1);
    assert.equal((await h.call("DELETE", `/api/candidates/${cand.body.candidate._id}`, { token: superToken })).status, 200);

    const created = await h.call("POST", "/api/auth/create-admin", { token: superToken, body: { fullName: "New Admin", email: "new.admin@civicslot.cm", phone: "", password: "Admin1234", region: "Ouest" } });
    assert.equal(created.status, 201);
    const admins = await h.call("GET", "/api/auth/admins", { token: superToken });
    const row = admins.body.admins.find((a) => a.email === "new.admin@civicslot.cm");
    assert.ok(row && row.id && row.fullName && row.region === "Ouest", "list items expose id / fullName / email / region");
    assert.equal((await h.call("DELETE", `/api/auth/admins/${row.id}`, { token: superToken })).status, 200);
  });

  it("known, intentional behaviour changes (documented): 8+ character admin passwords", async () => {
    const r = await h.call("POST", "/api/auth/create-admin", { token: superToken, body: { fullName: "Short Pw", email: "short@civicslot.cm", password: "abc123", region: "Sud" } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /at least|between 8/i);
  });
});
