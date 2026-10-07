import test from "node:test";
import assert from "node:assert/strict";
import { CalendarStoreBase } from "../workers/main-worker/src/calendar-store.js";
import * as api from "../workers/main-worker/src/calendar-v2.js";
import engine from "../assets/js/shared/calendar-engine.js";

const handlers = { "/api/calendar": api.handleCalendarGet, "/api/calendar/clock": api.handleCalendarClockPost, "/api/calendar/events/upsert": api.handleCalendarEventUpsert, "/api/calendar/config": api.handleCalendarConfigPost };
const services = {
  getOptionalAuthenticatedUser(request) {
    const accountId = request.headers.get("Authorization")?.replace("Bearer ", "");
    return accountId ? { accountId, campaignId: "test" } : null;
  },
  async requireUser(request) { return this.getOptionalAuthenticatedUser(request) || Response.json({ error: "Unauthorized" }, { status: 401 }); },
  async isAuthenticatedCampaignContentEditor(user) { return user?.accountId === "dm"; },
  getAuthenticatedAccountId(user) { return user.accountId; }
};
function fixture() {
  const records = new Map(), legacy = new Map();
  const reads = [], scans = [];
  let failCommit = false;
  const storage = {
    get: async key => structuredClone(records.get(key)), put: async (key, val) => records.set(key, structuredClone(val)),
    list: async ({ prefix }) => { scans.push(prefix); return new Map([...records].filter(([key]) => key.startsWith(prefix))); },
    delete: async keys => (Array.isArray(keys) ? keys : [keys]).forEach(key => records.delete(key)),
    transaction: async fn => {
      const before = new Map(records);
      try { await fn(storage); if (failCommit) { failCommit = false; throw new Error("simulated commit failure"); } }
      catch (error) { records.clear(); before.forEach((v, k) => records.set(k, v)); throw error; }
    }
  };
  const definition = engine.normalizeDefinition({ months: [{ id: "a", name: "Alba", days: 3 }, { id: "b", name: "Bruma", days: 2 }], timeSystem: { hoursPerDay: 40, minutesPerHour: 60 } });
  const key = "campaign:test:calendar:v2";
  legacy.set(key, JSON.stringify({ version: 4, definition, clock: { revision: 4, date: { year: 1, monthId: "b", day: 2 }, time: { hour: 39, minute: 59, second: 57 } }, events: [] }));
  const env = { SIGILLO_KV: { get: async name => { reads.push(name); return legacy.get(name) || null; }, put: async () => { throw new Error("Never write legacy KV"); } } };
  class Store extends CalendarStoreBase {
    context(request) { return { campaignId: "test", corsHeaders: {}, services, handler: handlers[new URL(request.url).pathname], readHandler: api.handleCalendarGet }; }
  }
  let store = new Store({ storage }, env);
  const call = (path = "", body, account = "dm") => store.fetch(new Request(`https://test/api/calendar${path ? `/${path}` : ""}`, { method: body ? "POST" : "GET", headers: account ? { Authorization: `Bearer ${account}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { call, get store() { return store; }, records, legacy, key, reads, scans, restart: () => { store = new Store({ storage }, env); }, failCommit: () => { failCommit = true; } };
}

test("concurrent clock writes serialize: one stale revision fails", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.call("clock", { expectedRevision: 4, delta: { unit: "second", amount: 6 }, operationId: "operation-1" }), f.call("clock", { expectedRevision: 4, delta: { unit: "hour", amount: 1 }, operationId: "operation-2" })]);
  assert.equal(a.status, 200); assert.equal(b.status, 409);
  const data = await a.json(); assert.equal(data.capabilities.coordinatedWrites, true);
  assert.deepEqual(data.calendar.clock.time, { hour: 0, minute: 0, second: 3 }); assert.equal(data.calendar.clock.date.year, 2);
  assert.equal(JSON.parse(f.legacy.get(f.key)).clock.revision, 4, "legacy data left untouched");
});
test("an idempotent retry uses the fresh filtered view and cannot duplicate a clock step", async () => {
  const f = fixture(), body = { expectedRevision: 4, operationId: "same-operation", delta: { unit: "second", amount: 6 } };
  await f.call("clock", body);
  const retried = await (await f.call("clock", body)).json();
  assert.equal(retried.replayed, true); assert.equal(retried.calendar.clock.revision, 5);
  assert.equal((await f.call("clock", body, "player")).status, 409);
  assert.equal((await f.call("clock", { ...body, delta: { unit: "day", amount: 1 } })).status, 409);
});
test("different event creations do not overwrite each other while the clock changes", async () => {
  const f = fixture();
  const event = id => ({ id, title: id, kind: "note", visibility: "owner", allDay: true, start: { date: { year: 1, monthId: "a", day: 1 } } });
  const responses = await Promise.all([f.call("events/upsert", { event: event("one"), expectedRevision: 0 }, "player"), f.call("events/upsert", { event: event("two"), expectedRevision: 0 }, "other"), f.call("clock", { expectedRevision: 4, delta: { unit: "second", amount: 6 } })]);
  assert.deepEqual(responses.map(r => r.status), [201, 201, 200]);
  assert.equal((await (await f.call()).json()).calendar.events.length, 2);
  assert.deepEqual((await (await f.call("", undefined, "player")).json()).calendar.events.map(e => e.id), ["one"]);
  assert.equal((await (await f.call("", undefined, "")).json()).calendar.events.length, 0);
});
test("document and retry receipt roll back together after a failed commit", async () => {
  const f = fixture(), body = { expectedRevision: 4, operationId: "failed-operation", delta: { unit: "second", amount: 6 } };
  f.failCommit(); await assert.rejects(f.call("clock", body), /commit failure/);
  assert.equal(f.records.has(f.key), false);
  assert.equal(f.records.has("operation:failed-operation"), false);
  assert.equal(f.records.has("receipt-index"), false);
  assert.equal((await (await f.call()).json()).calendar.clock.revision, 4, "failed write must not leak through memory cache");
  assert.equal((await f.call("clock", body)).status, 200);
  assert.equal((await (await f.call()).json()).calendar.clock.revision, 5);
});
test("invalid seconds and unauthorized clock writes cannot change the calendar", async () => {
  const f = fixture();
  assert.equal((await f.call("clock", { expectedRevision: 4, delta: { unit: "second", amount: 6 } }, "player")).status, 403);
  assert.equal((await f.call("clock", { expectedRevision: 4, delta: { unit: "second", amount: 0.5 } })).status, 400);
  assert.equal((await f.call("clock", { expectedRevision: 4, clock: { date: { year: 1, monthId: "a", day: 1 }, time: { hour: 0, minute: 0, second: 60 } } })).status, 400);
  assert.equal(f.records.has(f.key), false);
  assert.equal((await (await f.call()).json()).calendar.clock.revision, 4);
});
test("website time math preserves seconds across a 40-hour day", () => {
  const definition = engine.normalizeDefinition({ months: [{ name: "A", days: 1 }], timeSystem: { hoursPerDay: 40, minutesPerHour: 60 } });
  const clock = { date: { year: 1, monthId: definition.months[0].id, day: 1 }, time: { hour: 39, minute: 59, second: 57 } };
  const result = engine.shiftClock(definition, clock, 6, "second");
  assert.deepEqual(result.time, { hour: 0, minute: 0, second: 3 }); assert.equal(result.date.year, 2);
});

test("event drafts cannot cross definition changes or end before their start second", async () => {
  const f = fixture();
  const event = { id: "stale", title: "Draft", kind: "note", allDay: false, start: { date: { year: 1, monthId: "a", day: 1 }, time: { hour: 0, minute: 0, second: 10 } } };
  assert.equal((await f.call("events/upsert", { event, expectedRevision: 0, expectedDefinitionRevision: 99 })).status, 409);
  assert.equal((await f.call("events/upsert", { event: { ...event, end: { ...event.start, time: { hour: 0, minute: 0, second: 5 } } }, expectedRevision: 0 })).status, 400);
  assert.equal(f.records.has(f.key), false);
  assert.equal((await (await f.call()).json()).calendar.events.length, 0);
});

test("calendar imports use KV only once, including after object eviction", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) await f.call();
  f.restart(); await f.call();
  assert.deepEqual(f.reads, [f.key]);
  assert.equal(f.records.has("calendar-import"), true);
  await f.call("clock", { expectedRevision: 4, delta: { unit: "second", amount: 6 } });
  f.restart();
  assert.equal((await (await f.call()).json()).calendar.clock.revision, 5);
  assert.deepEqual(f.reads, [f.key]);
});

test("legacy and absent calendars are also imported once without editing old KV", async () => {
  for (const exists of [true, false]) {
    const f = fixture(); f.legacy.clear();
    const legacyKey = "campaign:test:data:calendar:override";
    const value = JSON.stringify({ data: [{ type: "config", name: "Old", months: [{ name: "A", days: 3 }] }, { type: "state", currentDate: "1-1-1" }] });
    if (exists) f.legacy.set(legacyKey, value);
    const first = await (await f.call()).json();
    f.restart(); await f.call(); await f.call();
    assert.equal(first.source, exists ? "legacy" : "default");
    assert.deepEqual(f.reads, [f.key, legacyKey]);
    assert.equal(f.legacy.get(legacyKey), exists ? value : undefined);
  }
});

test("receipt retention is bounded and does not scan 512 rows on every write", async () => {
  const f = fixture();
  const bodies = [];
  for (let i = 0; i < 514; i++) {
    const body = { expectedRevision: 4 + i, delta: { unit: "second", amount: 1 }, operationId: `retention-${i}` };
    bodies.push(body);
    assert.equal((await f.call("clock", body)).status, 200);
    if (i === 256) f.restart();
  }
  assert.equal(f.scans.length, 1, "ledger scans only once during initialization");
  assert.equal([...f.records.keys()].filter(k => k.startsWith("operation:")).length, 512);
  assert.equal(f.records.has("operation:retention-0"), false);
  assert.equal(f.records.has("operation:retention-2"), true);
  assert.equal((await (await f.call("clock", bodies[513])).json()).replayed, true);
  assert.equal((await f.call("clock", bodies[0])).status, 409, "expired receipt still cannot replay a stale clock write");
  const before = f.records.get("receipt-index");
  f.failCommit();
  await assert.rejects(f.call("clock", { expectedRevision: 518, delta: { unit: "second", amount: 1 }, operationId: "retention-failed" }), /commit failure/);
  assert.deepEqual(f.records.get("receipt-index"), before);
  assert.equal(f.records.has("operation:retention-2"), true, "failed eviction is rolled back");
});

test("old receipt ledgers migrate once and cached data never bypasses current permissions", async () => {
  const f = fixture();
  for (let i = 0; i < 512; i++) f.records.set(`operation:old-${i}`, { digest: "old", at: i });
  await f.call("clock", { expectedRevision: 4, delta: { unit: "second", amount: 1 }, operationId: "new-operation" });
  assert.equal(f.records.has("operation:old-0"), false);
  assert.equal(f.records.has("operation:old-1"), true);
  assert.equal(f.scans.length, 1);
  const event = { id: "secret", title: "Secret", kind: "note", visibility: "owner", allDay: true, start: { date: { year: 1, monthId: "a", day: 1 } } };
  await f.call("events/upsert", { event, expectedRevision: 0 }, "player");
  assert.equal((await (await f.call()).json()).calendar.events.length, 1);
  assert.equal((await (await f.call("", undefined, "stranger")).json()).calendar.events.length, 0);
  assert.equal((await (await f.call("", undefined, "player")).json()).calendar.events.length, 1);
  assert.equal((await f.call("clock", { expectedRevision: 5, delta: { unit: "second", amount: 1 } }, "stranger")).status, 403);
});

test("permission revocation is checked again even with a warm document cache", async () => {
  const f = fixture();
  const event = { id: "private", title: "Private", kind: "note", visibility: "owner", allDay: true, start: { date: { year: 1, monthId: "a", day: 1 } } };
  await f.call("events/upsert", { event, expectedRevision: 0 }, "player");
  let canEdit = true;
  const context = f.store.context.bind(f.store);
  f.store.context = request => ({ ...context(request), services: { ...services, async isAuthenticatedCampaignContentEditor(_user, env) {
    await env.SIGILLO_KV.get("permission-fixture"); return canEdit;
  } } });
  assert.equal((await (await f.call()).json()).calendar.events.length, 1);
  canEdit = false;
  const after = await (await f.call()).json();
  assert.equal(after.calendar.events.length, 0); assert.equal(after.permissions.canEdit, false);
  assert.equal(f.reads.filter(key => key === "permission-fixture").length, 2);
});
