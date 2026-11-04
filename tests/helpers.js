// Test harness: real Express app + real MongoDB-compatible database.
// Safety: tests only ever use TEST_MONGO_URI (never MONGO_URI), each suite gets
// its own throw-away database, and remote Atlas hosts are refused.
process.env.NODE_ENV = "test";
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const BASE = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const PASSWORD = "Passw0rd!x";

function uriFor(suite) {
  const u = new URL(BASE);
  if (/mongodb\.net$/i.test(u.hostname) && process.env.TEST_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to run tests against a remote Atlas cluster. Point TEST_MONGO_URI at a local database.");
  }
  u.pathname = `/civicslot_test_${suite}`;
  return u.toString();
}

function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: (prefix + layer.route.path).replace(/(.)\/$/, "$1") });
      } else if (layer.name === "router" && layer.handle.stack) {
        const mount = layer.regexp.source.replace("^\\", "").replace("\\/?(?=\\/|$)", "").replace(/\\\//g, "/");
        walk(layer.handle.stack, prefix + (mount ? `/${mount.replace(/^\//, "")}` : ""));
      }
    }
  };
  walk(app._router.stack, "");
  return out;
}

async function setup(suite, env = {}) {
  Object.assign(
    process.env,
    {
      NODE_ENV: "test",
      JWT_SECRET: "test-secret-test-secret-test-secret-123456",
      JWT_EXPIRES_IN: "7d",
      JWT_ADMIN_EXPIRES_IN: "8h",
      CORS_ORIGINS: "http://portal.test",
      APP_TIMEZONE: "Africa/Douala",
      RATE_LIMIT_AUTH_MAX: "1000",
      RATE_LIMIT_GLOBAL_MAX: "100000",
      MAX_FAILED_LOGINS: "5",
      LOCKOUT_MINUTES: "15",
    },
    env
  );
  await mongoose.connect(uriFor(suite));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  const { createApp } = require("../app");
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token, body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: json, headers: res.headers, text };
  }

  return {
    app,
    call,
    base,
    async teardown() {
      await new Promise((r) => server.close(r));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

const User = () => require("../models/User");
const Service = () => require("../models/Service");

let counter = 0;
async function makeUser({ role = "citizen", region = null, name, email, password = PASSWORD, active = true } = {}) {
  counter += 1;
  return User().create({
    fullName: name || `Test ${role} ${counter}`,
    email: email || `${role}${counter}-${Date.now()}@test.cm`,
    phone: `+2376000${String(counter).padStart(5, "0")}`,
    password,
    role,
    region,
    active,
  });
}

async function makeService(region, overrides = {}) {
  return Service().create({
    name: `Service ${region} ${++counter}`,
    office: `Office ${region}`,
    region,
    openTime: "00:00",
    closeTime: "23:30",
    durationMinutes: 30,
    capacityPerSlot: 2,
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    ...overrides,
  });
}

async function loginAs(h, user, { portal = true, password = PASSWORD } = {}) {
  const r = await h.call("POST", portal ? "/api/auth/admin-login" : "/api/auth/login", { body: { email: user.email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${user.email}: ${r.status} ${r.text}`);
  return r.body.token;
}

const decode = (token) => jwt.decode(token);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { setup, makeUser, makeService, loginAs, listRoutes, decode, sleep, PASSWORD };
