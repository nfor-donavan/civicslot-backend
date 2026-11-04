const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");

describe("Authentication and account protection", () => {
  let h, superadmin, tSuper;
  before(async () => {
    h = await H.setup("auth");
    superadmin = await H.makeUser({ role: "superadmin" });
    tSuper = await H.loginAs(h, superadmin);
  });
  after(() => h.teardown());

  it("registration always creates a citizen, whatever role the client sends", async () => {
    const r = await h.call("POST", "/api/auth/register", {
      body: { fullName: "Eve Hacker", email: "eve@test.cm", password: "secret1", role: "superadmin", active: false },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.role, "citizen");
    assert.equal((await h.call("GET", "/api/admin/audit", { token: r.body.token })).status, 403);
  });

  it("rejects duplicate e-mail (409), bad e-mail and short password (400)", async () => {
    await h.call("POST", "/api/auth/register", { body: { fullName: "Dup One", email: "dup@test.cm", password: "secret1" } });
    assert.equal((await h.call("POST", "/api/auth/register", { body: { fullName: "Dup Two", email: "DUP@test.cm", password: "secret1" } })).status, 409);
    assert.equal((await h.call("POST", "/api/auth/register", { body: { fullName: "Bad Mail", email: "nope", password: "secret1" } })).status, 400);
    assert.equal((await h.call("POST", "/api/auth/register", { body: { fullName: "Short Pw", email: "s@test.cm", password: "123" } })).status, 400);
  });

  it("login does not reveal whether an account exists", async () => {
    const unknown = await h.call("POST", "/api/auth/login", { body: { email: "ghost@test.cm", password: "whatever1" } });
    const wrongPw = await h.call("POST", "/api/auth/login", { body: { email: superadmin.email, password: "wrong-password1" } });
    assert.equal(unknown.status, 401);
    assert.equal(wrongPw.status, 401);
    assert.equal(unknown.body.message, wrongPw.body.message);
  });

  it("portal login: citizens are refused (403), administrators get an 8-hour token", async () => {
    const citizen = await H.makeUser({ role: "citizen" });
    const r = await h.call("POST", "/api/auth/admin-login", { body: { email: citizen.email, password: H.PASSWORD } });
    assert.equal(r.status, 403);
    assert.equal(r.body.token, undefined);

    const ok = await h.call("POST", "/api/auth/admin-login", { body: { email: superadmin.email, password: H.PASSWORD } });
    assert.equal(ok.status, 200);
    const t = H.decode(ok.body.token);
    assert.equal(t.exp - t.iat, 8 * 3600);
    // The mobile login keeps the long session.
    const mobile = await h.call("POST", "/api/auth/login", { body: { email: superadmin.email, password: H.PASSWORD } });
    const m = H.decode(mobile.body.token);
    assert.equal(m.exp - m.iat, 7 * 24 * 3600);
  });

  it("locks an administrator account after repeated failures, even for the right password", async () => {
    const admin = await H.makeUser({ role: "admin", region: "Centre" });
    for (let i = 0; i < 5; i++) {
      const r = await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: "wrong-password1" } });
      assert.equal(r.status, 401);
    }
    const locked = await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: H.PASSWORD } });
    assert.equal(locked.status, 429);
    const audit = await h.call("GET", "/api/admin/audit?category=auth", { token: tSuper });
    const mine = audit.body.entries.filter((e) => e.actorName === admin.fullName).map((e) => e.action);
    assert.ok(mine.includes("auth.login_failed") && mine.includes("auth.account_locked"));
  });

  it("a suspended administrator is rejected at login and their existing token stops working", async () => {
    const admin = await H.makeUser({ role: "admin", region: "Centre" });
    const token = await H.loginAs(h, admin);
    assert.equal((await h.call("GET", "/api/appointments", { token })).status, 200);

    const s = await h.call("PATCH", `/api/auth/admins/${admin._id}`, { token: tSuper, body: { active: false } });
    assert.equal(s.status, 200);
    assert.equal((await h.call("GET", "/api/appointments", { token })).status, 401);
    const login = await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: H.PASSWORD } });
    assert.equal(login.status, 403);
    const wrong = await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: "wrong-password1" } });
    assert.equal(wrong.status, 401, "suspension is only revealed after correct credentials");

    // Reactivating does not resurrect the old token.
    await h.call("PATCH", `/api/auth/admins/${admin._id}`, { token: tSuper, body: { active: true } });
    assert.equal((await h.call("GET", "/api/appointments", { token })).status, 401);
    assert.equal((await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: H.PASSWORD } })).status, 200);
  });

  it("a regional admin cannot change their own region through /auth/me (privilege-escalation regression)", async () => {
    const admin = await H.makeUser({ role: "admin", region: "Centre" });
    const token = await H.loginAs(h, admin);
    const r = await h.call("PATCH", "/api/auth/me", { token, body: { region: "Littoral" } });
    assert.equal(r.status, 403);
    assert.equal((await h.call("GET", "/api/auth/me", { token })).body.user.region, "Centre");
    // Phone is still editable; citizens may still set their home region (mobile app).
    assert.equal((await h.call("PATCH", "/api/auth/me", { token, body: { phone: "+237611111111" } })).status, 200);
    const citizen = await H.makeUser({ role: "citizen" });
    const tc = await H.loginAs(h, citizen, { portal: false });
    const c = await h.call("PATCH", "/api/auth/me", { token: tc, body: { region: "Ouest" } });
    assert.equal(c.status, 200);
    assert.equal(c.body.user.region, "Ouest");
  });

  it("changing a password enforces strength, checks the current one, and ends older sessions", async () => {
    const admin = await H.makeUser({ role: "admin", region: "Sud" });
    const old = await H.loginAs(h, admin);
    assert.equal((await h.call("POST", "/api/auth/change-password", { token: old, body: { currentPassword: "nope-nope1", newPassword: "NewPassw0rd" } })).status, 400);
    assert.equal((await h.call("POST", "/api/auth/change-password", { token: old, body: { currentPassword: H.PASSWORD, newPassword: "short1" } })).status, 400);
    assert.equal((await h.call("POST", "/api/auth/change-password", { token: old, body: { currentPassword: H.PASSWORD, newPassword: "onlyletters" } })).status, 400);

    const ok = await h.call("POST", "/api/auth/change-password", { token: old, body: { currentPassword: H.PASSWORD, newPassword: "NewPassw0rd" } });
    assert.equal(ok.status, 200);
    assert.equal((await h.call("GET", "/api/auth/me", { token: old })).status, 401, "old token must be dead");
    assert.equal((await h.call("GET", "/api/auth/me", { token: ok.body.token })).status, 200, "new token works");
    assert.equal((await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: "NewPassw0rd" } })).status, 200);
  });

  it("a password reset by a superadmin ends the administrator's existing sessions", async () => {
    const admin = await H.makeUser({ role: "admin", region: "Est" });
    const old = await H.loginAs(h, admin);
    assert.equal((await h.call("PATCH", `/api/auth/admins/${admin._id}`, { token: tSuper, body: { password: "weak" } })).status, 400);
    const r = await h.call("PATCH", `/api/auth/admins/${admin._id}`, { token: tSuper, body: { password: "Reset1234" } });
    assert.equal(r.status, 200);
    assert.equal((await h.call("GET", "/api/auth/me", { token: old })).status, 401);
    assert.equal((await h.call("POST", "/api/auth/admin-login", { body: { email: admin.email, password: "Reset1234" } })).status, 200);
  });

  it("a deleted administrator's token stops working immediately", async () => {
    const admin = await H.makeUser({ role: "admin", region: "Nord" });
    const token = await H.loginAs(h, admin);
    assert.equal((await h.call("DELETE", `/api/auth/admins/${admin._id}`, { token: tSuper })).status, 200);
    assert.equal((await h.call("GET", "/api/auth/me", { token })).status, 401);
  });

  it("administrator management validates input and cannot target other roles", async () => {
    const good = { fullName: "Marie Ekwalla", email: "marie@test.cm", password: "Strong123", region: "Ouest" };
    assert.equal((await h.call("POST", "/api/auth/create-admin", { token: tSuper, body: { ...good, password: "short" } })).status, 400);
    assert.equal((await h.call("POST", "/api/auth/create-admin", { token: tSuper, body: { ...good, region: "Atlantis" } })).status, 400);
    assert.equal((await h.call("POST", "/api/auth/create-admin", { token: tSuper, body: { ...good, region: undefined } })).status, 400);
    const created = await h.call("POST", "/api/auth/create-admin", { token: tSuper, body: good });
    assert.equal(created.status, 201);
    assert.equal(created.body.admin.role, "admin");
    assert.equal(created.body.admin.password, undefined);
    assert.equal((await h.call("POST", "/api/auth/create-admin", { token: tSuper, body: good })).status, 409);
    assert.equal((await h.call("PATCH", `/api/auth/admins/${created.body.admin.id}`, { token: tSuper, body: {} })).status, 400);
    // A superadmin / citizen id is "not found" through the admin-management routes.
    assert.equal((await h.call("PATCH", `/api/auth/admins/${superadmin._id}`, { token: tSuper, body: { active: false } })).status, 404);
    assert.equal((await h.call("DELETE", `/api/auth/admins/${superadmin._id}`, { token: tSuper })).status, 404);
  });

  it("administrator changes are written to the audit trail without secrets", async () => {
    const r = await h.call("GET", "/api/admin/audit?category=admin", { token: tSuper });
    assert.ok(r.body.entries.some((e) => e.action === "admin.created"));
    assert.ok(r.body.entries.some((e) => e.action === "admin.updated" && e.details.passwordReset === true));
    assert.ok(!JSON.stringify(r.body).includes("Reset1234") && !JSON.stringify(r.body).includes("Strong123"));
  });
});
