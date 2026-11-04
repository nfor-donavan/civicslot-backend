const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");

describe("Platform security controls", () => {
  let h;
  before(async () => {
    h = await H.setup("security", { RATE_LIMIT_AUTH_MAX: "6" });
  });
  after(() => h.teardown());

  describe("CORS", () => {
    it("allows the configured portal origin and returns the allow header", async () => {
      const r = await h.call("GET", "/api/health", { headers: { Origin: "http://portal.test" } });
      assert.equal(r.headers.get("access-control-allow-origin"), "http://portal.test");
    });
    it("does not grant other browser origins access", async () => {
      const r = await h.call("GET", "/api/health", { headers: { Origin: "https://evil.example" } });
      assert.equal(r.headers.get("access-control-allow-origin"), null);
    });
    it("answers preflight for the allowed origin with the methods and headers the portal needs", async () => {
      const r = await h.call("OPTIONS", "/api/appointments", {
        headers: { Origin: "http://portal.test", "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,content-type" },
      });
      assert.ok([200, 204].includes(r.status));
      assert.match(r.headers.get("access-control-allow-methods"), /PATCH/);
      assert.match(r.headers.get("access-control-allow-headers").toLowerCase(), /authorization/);
    });
    it("requests without an Origin (the mobile app) are unaffected", async () => {
      assert.equal((await h.call("GET", "/api/health")).status, 200);
    });
  });

  describe("headers and error handling", () => {
    it("sets hardening headers and does not advertise the framework", async () => {
      const r = await h.call("GET", "/api/health");
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
      assert.equal(r.headers.get("x-powered-by"), null);
      assert.ok(r.headers.get("strict-transport-security"));
    });
    it("health endpoint exposes no secrets or connection details", async () => {
      const r = await h.call("GET", "/api/health");
      assert.deepEqual(Object.keys(r.body).sort(), ["database", "service", "status", "version"]);
      assert.ok(!r.text.includes("mongodb"));
    });
    it("unknown routes return JSON 404", async () => {
      const r = await h.call("GET", "/api/does-not-exist");
      assert.equal(r.status, 404);
      assert.equal(r.body.message, "Route not found");
    });
    it("malformed JSON is a 400 and oversized bodies are a 413, without stack traces", async () => {
      const bad = await fetch(`${h.base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
      assert.equal(bad.status, 400);
      assert.ok(!(await bad.text()).includes("at "));
      const big = await h.call("POST", "/api/auth/login", { body: { email: "a@b.cm", password: "x".repeat(200_000) } });
      assert.equal(big.status, 413);
    });
    it("unexpected server errors never leak internal details", async () => {
      const Service = require("../models/Service");
      const original = Service.find;
      Service.find = () => {
        throw new Error("secret internal detail at /srv/app/db.js");
      };
      try {
        const r = await h.call("GET", "/api/services");
        assert.equal(r.status, 500);
        assert.equal(r.body.message, "Server error");
        assert.ok(!r.text.includes("secret internal detail"));
      } finally {
        Service.find = original;
      }
    });
  });

  describe("abuse protection", () => {
    it("rate-limits repeated authentication attempts from one client", async () => {
      let last;
      for (let i = 0; i < 8; i++) last = await h.call("POST", "/api/auth/login", { body: { email: "nobody@test.cm", password: "wrong-password1" } });
      assert.equal(last.status, 429);
      assert.match(last.body.message, /Too many requests/);
    });
  });

  describe("startup configuration", () => {
    const { assertStartupConfig, getConfig } = require("../config");
    it("refuses to start without a database URI or JWT secret", () => {
      assert.throws(() => assertStartupConfig(getConfig({ MONGO_URI: "mongodb://x" })), /JWT_SECRET/);
      assert.throws(() => assertStartupConfig(getConfig({ JWT_SECRET: "x".repeat(40) })), /MONGO_URI/);
    });
    it("warns about a short secret and an empty production CORS list", () => {
      const w = assertStartupConfig(getConfig({ MONGO_URI: "mongodb://x", JWT_SECRET: "short", NODE_ENV: "production" }));
      assert.equal(w.length, 2);
      assert.deepEqual(assertStartupConfig(getConfig({ MONGO_URI: "mongodb://x", JWT_SECRET: "x".repeat(40), NODE_ENV: "production", CORS_ORIGINS: "https://p.example/" })), []);
    });
    it("normalises CORS origins (trailing slashes, whitespace)", () => {
      assert.deepEqual(getConfig({ CORS_ORIGINS: " https://a.example/ , https://b.example " }).corsOrigins, ["https://a.example", "https://b.example"]);
    });
  });
});
