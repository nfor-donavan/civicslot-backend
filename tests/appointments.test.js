const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");

describe("Booking rules, capacity, time handling and status workflow", () => {
  let h, T, tSuper, tAdmin, c1, c2, c3, t1, t2, t3, svc, otherSvc, day1, day2;

  before(async () => {
    h = await H.setup("appointments");
    T = require("../utils/time");
    const superadmin = await H.makeUser({ role: "superadmin" });
    const admin = await H.makeUser({ role: "admin", region: "Centre" });
    [tSuper, tAdmin] = await Promise.all([H.loginAs(h, superadmin), H.loginAs(h, admin)]);
    [c1, c2, c3] = await Promise.all([1, 2, 3].map(() => H.makeUser({ role: "citizen" })));
    [t1, t2, t3] = await Promise.all([c1, c2, c3].map((c) => H.loginAs(h, c, { portal: false })));
    svc = await H.makeService("Centre", { capacityPerSlot: 2 });
    otherSvc = await H.makeService("Centre", { capacityPerSlot: 5 });
    day1 = T.addDays(T.todayString(), 1);
    day2 = T.addDays(T.todayString(), 2);
  });
  after(() => h.teardown());

  const book = (token, serviceId, date, time, extra = {}) =>
    h.call("POST", "/api/appointments", { token, body: { serviceId: String(serviceId), date, time, ...extra } });

  describe("time handling", () => {
    it("uses the platform timezone (Africa/Douala, UTC+1), not the server's", async () => {
      const { getAvailableSlots } = require("../utils/slots");
      const s = await H.makeService("Centre", { openTime: "08:00", closeTime: "18:00", durationMinutes: 30 });
      // 14:30 UTC is 15:30 in Cameroon.
      const now = new Date("2026-10-22T14:30:00Z");
      const slots = await getAvailableSlots(s, "2026-10-22", now);
      const past = (t) => slots.find((x) => x.time === t).past;
      assert.equal(past("15:00"), true, "15:00 Cameroon time is already past at 15:30");
      assert.equal(past("15:30"), false);
      assert.equal(past("16:00"), false);
      // Other dates are never "past" by the clock.
      assert.equal((await getAvailableSlots(s, "2026-10-23", now)).some((x) => x.past), false);
    });

    it("date validation rejects impossible dates", () => {
      assert.equal(T.isValidDateString("2026-02-30"), false);
      assert.equal(T.isValidDateString("2026-13-01"), false);
      assert.equal(T.isValidDateString("2026-10-22"), true);
      assert.equal(T.isValidDateString("22/10/2026"), false);
    });
  });

  describe("booking validation", () => {
    it("rejects past dates, far-future dates, bad formats and non-existent slots", async () => {
      assert.equal((await book(t1, svc._id, T.addDays(T.todayString(), -1), "10:00")).status, 400);
      assert.equal((await book(t1, svc._id, T.addDays(T.todayString(), 91), "10:00")).status, 400);
      assert.equal((await book(t1, svc._id, "not-a-date", "10:00")).status, 400);
      assert.equal((await book(t1, svc._id, day1, "25:99")).status, 400);
      assert.equal((await book(t1, svc._id, day1, "10:15")).status, 400, "10:15 is not on the 30-minute grid");
      assert.equal((await book(t1, "bad-id", day1, "10:00")).status, 400);
      assert.equal((await book(t1, "64b7f0f0f0f0f0f0f0f0f0f0", day1, "10:00")).status, 404);
    });

    it("rejects a slot that has already passed today (when one exists at test time)", async (ctx) => {
      const clock = T.nowParts();
      if (clock.minutes < 31) return ctx.skip("no past slot exists yet at this hour in Cameroon");
      const pastTime = T.minutesToTime(Math.floor((clock.minutes - 30) / 30) * 30);
      const r = await book(t1, svc._id, clock.date, pastTime);
      assert.equal(r.status, 400);
      assert.match(r.body.message, /already passed/);
    });

    it("rejects a closed weekday", async () => {
      const weekdayOnly = await H.makeService("Centre", { workingDays: [1, 2, 3, 4, 5] });
      let d = day1;
      while (T.weekdayOf(d) !== 0) d = T.addDays(d, 1); // next Sunday
      const r = await book(t1, weekdayOnly._id, d, "10:00");
      assert.equal(r.status, 400);
      assert.match(r.body.message, /closed/);
    });
  });

  describe("capacity", () => {
    it("fills a slot up to its capacity, then refuses; cancelling frees a place", async () => {
      const a = await book(t1, svc._id, day1, "09:00");
      const b = await book(t2, svc._id, day1, "09:00");
      assert.equal(a.status, 201);
      assert.equal(b.status, 201);
      assert.equal(a.body.appointment.status, "pending");
      assert.match(a.body.appointment.reference, /^CS-[A-Z0-9]{8}$/);

      const full = await book(t3, svc._id, day1, "09:00");
      assert.equal(full.status, 409);

      const slots = await h.call("GET", `/api/services/${svc._id}/slots?date=${day1}`);
      const s9 = slots.body.slots.find((s) => s.time === "09:00");
      assert.deepEqual([s9.booked, s9.remaining, s9.full], [2, 0, true]);

      assert.equal((await h.call("PATCH", `/api/appointments/${a.body.appointment._id}/cancel`, { token: t1 })).status, 200);
      assert.equal((await book(t3, svc._id, day1, "09:00")).status, 201);
    });

    it("blocks the same citizen from double-booking a service on one day", async () => {
      assert.equal((await book(t1, otherSvc._id, day2, "11:00")).status, 201);
      assert.equal((await book(t1, otherSvc._id, day2, "12:00")).status, 409);
    });

    it("a citizen can only cancel their own appointment", async () => {
      const mine = await book(t2, otherSvc._id, T.addDays(day1, 3), "08:00");
      assert.equal((await h.call("PATCH", `/api/appointments/${mine.body.appointment._id}/cancel`, { token: t3 })).status, 404);
    });
  });

  describe("status workflow (administrators)", () => {
    let appt;
    before(async () => {
      appt = (await book(t1, svc._id, T.addDays(day1, 5), "10:00")).body.appointment;
    });
    const set = (status, extra = {}, token = tAdmin) => h.call("PATCH", `/api/appointments/${appt._id}/status`, { token, body: { status, ...extra } });

    it("rejects unknown statuses and impossible transitions", async () => {
      assert.equal((await set("banana")).status, 400);
      assert.equal((await set("completed")).status, 409, "pending cannot jump to completed");
      assert.equal((await set("no_show")).status, 409);
    });

    it("pending -> confirmed -> completed, then the record is final", async () => {
      const c = await set("confirmed");
      assert.equal(c.status, 200);
      assert.equal(c.body.appointment.status, "confirmed");
      assert.equal((await set("pending")).status, 409, "cannot go back to pending");
      const d = await set("completed");
      assert.equal(d.status, 200);
      assert.equal((await set("cancelled")).status, 409, "completed is final");
      assert.equal((await set("confirmed", {}, tSuper)).status, 409, "final even for a superadmin");
    });

    it("declining stores the reason and records who did it", async () => {
      const a2 = (await book(t2, svc._id, T.addDays(day1, 6), "10:00")).body.appointment;
      const r = await h.call("PATCH", `/api/appointments/${a2._id}/status`, { token: tAdmin, body: { status: "cancelled", reason: "Office closed for maintenance" } });
      assert.equal(r.status, 200);
      assert.equal(r.body.appointment.adminNote, "Office closed for maintenance");
      const log = await h.call("GET", "/api/admin/audit?action=appointment.status_changed", { token: tSuper });
      const entry = log.body.entries.find((e) => e.details.reference === a2.reference);
      assert.deepEqual([entry.details.from, entry.details.to], ["pending", "cancelled"]);
      assert.equal(entry.actorRole, "admin");
    });

    it("no-show is reachable only from confirmed", async () => {
      const a3 = (await book(t3, svc._id, T.addDays(day1, 7), "10:00")).body.appointment;
      const url = `/api/appointments/${a3._id}/status`;
      assert.equal((await h.call("PATCH", url, { token: tAdmin, body: { status: "no_show" } })).status, 409);
      await h.call("PATCH", url, { token: tAdmin, body: { status: "confirmed" } });
      assert.equal((await h.call("PATCH", url, { token: tAdmin, body: { status: "no_show" } })).status, 200);
    });
  });

  describe("administrator list: filters, search and pagination", () => {
    it("paginates and reports totals", async () => {
      const p1 = await h.call("GET", "/api/appointments?limit=2&page=1", { token: tAdmin });
      const p2 = await h.call("GET", "/api/appointments?limit=2&page=2", { token: tAdmin });
      assert.equal(p1.body.appointments.length, 2);
      assert.ok(p1.body.total >= 5 && p1.body.pages >= 3);
      assert.notEqual(p1.body.appointments[0]._id, p2.body.appointments[0]._id);
      assert.equal((await h.call("GET", "/api/appointments?limit=9999", { token: tAdmin })).body.limit, 100, "limit is capped");
    });

    it("filters by status and date range, and validates them", async () => {
      const c = await h.call("GET", "/api/appointments?status=completed", { token: tAdmin });
      assert.ok(c.body.total >= 1 && c.body.appointments.every((a) => a.status === "completed"));
      const range = await h.call("GET", `/api/appointments?dateFrom=${day1}&dateTo=${day1}`, { token: tAdmin });
      assert.ok(range.body.appointments.every((a) => a.date === day1));
      assert.equal((await h.call("GET", "/api/appointments?status=banana", { token: tAdmin })).status, 400);
      assert.equal((await h.call("GET", "/api/appointments?dateFrom=garbage", { token: tAdmin })).status, 400);
    });

    it("searches by reference and by citizen name, and treats the input as text, not a pattern", async () => {
      const any = (await h.call("GET", "/api/appointments?limit=1", { token: tAdmin })).body.appointments[0];
      const byRef = await h.call("GET", `/api/appointments?q=${any.reference}`, { token: tAdmin });
      assert.ok(byRef.body.appointments.some((a) => a.reference === any.reference));
      const byName = await h.call("GET", `/api/appointments?q=${encodeURIComponent(any.user.fullName)}`, { token: tAdmin });
      assert.ok(byName.body.total >= 1);
      const regex = await h.call("GET", `/api/appointments?q=${encodeURIComponent(".*")}`, { token: tAdmin });
      assert.equal(regex.status, 200);
      assert.equal(regex.body.total, 0, "'.*' is matched literally, not as a regular expression");
    });
  });

  describe("service lifecycle", () => {
    it("a service that has appointments cannot be deleted (it can be deactivated)", async () => {
      const r = await h.call("DELETE", `/api/services/${svc._id}`, { token: tAdmin });
      assert.equal(r.status, 409);
      assert.match(r.body.message, /Deactivate/);
      assert.equal((await h.call("PUT", `/api/services/${svc._id}`, { token: tAdmin, body: { active: false } })).status, 200);
      assert.equal((await book(t3, svc._id, T.addDays(day1, 9), "10:00")).status, 404, "inactive services cannot be booked");
    });
  });
});
