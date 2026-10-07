// Offline integration test: starts a disposable local Workers runtime. Never
// connects to Cloudflare or reads production credentials/bindings.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Miniflare } from "../workers/main-worker/node_modules/miniflare/dist/src/index.js";
const secret = "calendar-local-fixture-only";
function jwt(accountId) {
  const parts = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ accountId, campaignId: "test", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")].join(".");
  return `${parts}.${createHmac("sha256", secret).update(parts).digest("base64url")}`;
}
const runtime = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL("../output/khuzoe-calendar-worker-check/index.js", import.meta.url)), compatibilityDate: "2026-05-15", kvNamespaces: ["SIGILLO_KV"], kvPersist: false,
  durableObjects: { CALENDAR_STORE: { className: "CalendarStore", useSQLite: true } }, durableObjectsPersist: false, bindings: { JWT_SECRET: secret, GLOBAL_ADMIN_ACCOUNT_IDS: "admin" } });
try {
  const call = (path = "", body, account = "admin") => runtime.dispatchFetch(`https://local.test/api/calendar${path ? `/${path}` : ""}?campaign=test`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${jwt(account)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const initialResponse = await call();
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.permissions.canEdit, true);
  assert.equal(initial.capabilities.idempotency, true);
  const configuredResponse = await call("config", { expectedVersion: initial.version, definition: { ...initial.calendar.definition, timeSystem: { ...initial.calendar.definition.timeSystem, hoursPerDay: 40 } }, clock: { ...initial.calendar.clock, time: { hour: 39, minute: 59, second: 57 } } });
  assert.equal(configuredResponse.status, 200);
  const configured = await configuredResponse.json();
  const body = { operationId: "runtime-clock-round", expectedRevision: configured.calendar.clock.revision, delta: { unit: "second", amount: 6 } };
  const [first, second] = await Promise.all([call("clock", body), call("clock", { ...body, operationId: "runtime-clock-other" })]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const replay = await (await call("clock", body)).json();
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.calendar.clock.time, { hour: 0, minute: 0, second: 3 });
  const note = { id: "runtime-private-note", kind: "note", visibility: "owner", title: "Private", allDay: true, start: { date: replay.calendar.clock.date }, description: "x".repeat(12000) };
  assert.equal((await call("events/upsert", { event: note, expectedRevision: 0 }, "player")).status, 201);
  assert.equal((await (await call("", undefined, "other")).json()).calendar.events.length, 0);
  // A calendar exceeding the old DO KV 128KiB limit must work on SQLite.
  for (let i = 0; i < 12; i++) assert.equal((await call("events/upsert", { event: { ...note, id: `large-${i}` }, expectedRevision: 0 })).status, 201);
  assert.equal((await (await call()).json()).calendar.events.length, 13);
  console.log("Local Workers runtime: SQLite transactions, concurrent writes, retry, privacy and >128KiB calendars passed.");
} finally { await runtime.dispose(); }
