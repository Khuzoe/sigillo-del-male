// Exercise the real page and API service with a small DOM and simulated time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import engine from "../assets/js/shared/calendar-engine.js";

const serviceSource = await readFile(new URL("../assets/js/shared/calendar-service.js", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../assets/js/pages/calendar.js", import.meta.url), "utf8");
function fixture() {
  let now = 0, offline = false, init, interval, cleared = false, latency = 0;
  const reads = [], writes = [], legacyReads = [], listeners = {};
  const node = () => ({ dataset: {}, isConnected: true, innerHTML: "", listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, querySelector() { return null; } });
  const root = node(), modal = node();
  const document = { hidden: false, body: { classList: { add() {}, remove() {} } },
    getElementById: id => ({ "calendar-root": root, "calendar-modal-root": modal })[id],
    addEventListener: (name, fn) => { listeners[name] = fn; } };
  const definition = engine.normalizeDefinition({ name: "Test", months: [{ id: "a", name: "Alba", days: 3 }] });
  const remote = { ok: true, version: 1, capabilities: { coordinatedWrites: true }, permissions: { canEdit: true, canCreateNote: true }, calendar: { definition,
    clock: { revision: 1, date: { year: 1, monthId: "a", day: 1 }, time: { hour: 0, minute: 0, second: 3 } }, events: [] } };
  const window = { CriptaCalendarEngine: engine, matchMedia: () => ({ matches: false }), CriptaApp: {
    onPageReady: (_name, fn) => { init = fn; }, auth: { getToken: () => "local-fixture" }, utils: { escapeHtml: value => String(value).replaceAll("<", "&lt;") },
    api: {
      get: async () => { reads.push(now); now += latency; if (offline) throw new Error("Offline"); return structuredClone(remote); },
      post: async (path, body) => {
        writes.push({ path, body });
        remote.calendar.clock = { ...engine.shiftClock(definition, remote.calendar.clock, body.delta.amount, body.delta.unit), revision: remote.calendar.clock.revision + 1 };
        remote.version++; return structuredClone(remote);
      }, clearCache() {}
    },
    data: { globalJson: async () => { legacyReads.push(now); return []; } }
  } };
  const context = vm.createContext({ window, document, crypto, Date: class extends Date { static now() { return now; } }, console: { warn() {}, error: (...args) => { throw new Error(args.map(String).join(" ")); } },
    setInterval: (fn, delay) => { assert.equal(delay, 60000); interval = fn; cleared = false; return 1; }, clearInterval: () => { cleared = true; }, requestAnimationFrame: fn => fn(), setTimeout() {}, confirm: () => true });
  vm.runInContext(serviceSource, context); vm.runInContext(pageSource, context);
  const click = (node, dataset) => node.listeners.click({ preventDefault() {}, target: { closest: () => ({ dataset }) } });
  return { init: () => init(), root, modal, remote, reads, writes, legacyReads, document,
    offline: value => { offline = value; },
    latency: value => { latency = value; },
    poll: async time => { now = time; await interval(); },
    visibility: async (hidden, time) => { now = time; document.hidden = hidden; listeners.visibilitychange(); for (let i = 0; i < 8; i++) await Promise.resolve(); },
    click: dataset => click(root, dataset), close: () => click(modal, { modalAction: "close" }),
    get cleared() { return cleared; }
  };
}

test("website polls at most once a minute and stops when hidden or detached", async () => {
  const f = fixture(); await f.init();
  await f.poll(15000); await f.poll(59000); assert.deepEqual(f.reads, [0]);
  await f.poll(60000); assert.deepEqual(f.reads, [0, 60000]);
  await f.visibility(true, 120000); await f.poll(180000); assert.equal(f.reads.length, 2);
  await f.visibility(false, 180001); assert.equal(f.reads.length, 3);
  await f.visibility(false, 180002); await f.poll(180003); assert.equal(f.reads.length, 3);
  f.root.isConnected = false; await f.poll(300000); assert.ok(f.cleared); assert.equal(f.reads.length, 3);
});

test("background outages back off without making extra legacy requests", async () => {
  const f = fixture(); await f.init(); f.offline(true);
  for (let time = 60000; time <= 780000; time += 60000) await f.poll(time);
  assert.deepEqual(f.reads, [0, 60000, 120000, 240000, 480000, 780000]);
  assert.equal(f.legacyReads.length, 0);
  f.offline(false); await f.poll(1080000); assert.equal(f.reads.at(-1), 1080000);
});

test("network latency does not turn minute polling into two-minute polling", async () => {
  const f = fixture(); await f.init(); f.latency(200);
  f.remote.version++;
  await f.poll(60000); await f.poll(120000); await f.poll(180000);
  assert.deepEqual(f.reads, [0, 60000, 120000, 180000]);
});

test("initial offline fallback remains available but is not repeatedly reloaded", async () => {
  const f = fixture(); f.offline(true); await f.init();
  assert.equal(f.legacyReads.length, 1);
  await f.poll(60000); await f.poll(120000); assert.equal(f.legacyReads.length, 1);
});

test("a clock command saves immediately and postpones the next background read", async () => {
  const f = fixture(); await f.init(); await f.poll(59000);
  await f.click({ action: "step-time", amount: "1", unit: "hour" });
  assert.equal(f.writes.length, 1); assert.equal(f.remote.calendar.clock.time.second, 3);
  assert.equal(f.writes[0].body.expectedVersion, undefined, "coordinated writes keep their record revision");
  assert.equal(f.writes[0].body.expectedRevision, 1);
  await f.poll(60000); assert.equal(f.reads.length, 1);
  await f.poll(119000); assert.equal(f.reads.length, 2);
});

test("an open editor blocks background reloads and preserves its draft", async () => {
  const f = fixture(); await f.init(); await f.click({ action: "new-event" });
  const draft = f.modal.innerHTML;
  f.remote.version++;
  await f.poll(60000); await f.visibility(false, 120000);
  assert.equal(f.reads.length, 1); assert.equal(f.modal.innerHTML, draft);
  await f.close(); await f.poll(120000); assert.equal(f.reads.length, 2);
});
