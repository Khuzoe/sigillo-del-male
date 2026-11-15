// Discord and frontend requests are entirely mocked; no real messages are sent.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare } from "../workers/main-worker/node_modules/miniflare/dist/src/index.js";
import worker from "../workers/main-worker/src/index.js";
import { D1PollStore } from "../workers/main-worker/src/poll-store.js";
import { getParticipantPollProgress, handleDiscordBotDmNotifications, normalizeDiscordBotPreferences,
  discordBotPreferencesKey } from "../workers/main-worker/src/discord-bot/notifications.js";

let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const match = (actual, expected) => { assert.match(actual, expected); checks++; };
const campaign = "cripta-di-sangue";
const prefix = `campaign:${campaign}:`;
const session = { campaignId: campaign, campaignName: "Cripta", number: 7, isScheduled: false,
  createdAt: "2026-11-13T12:00:00Z", availabilityOptions: [{ id: "a" }, { id: "b" }, { id: 'strange."key' }] };
const complete = { a: "yes", b: "no", 'strange."key': "maybe" };
const alice = { id: "hero", accountId: "alice", discordId: "100001", displayName: "Alice" };
const vote = (selections, extra = {}) => ({ accountId: "alice", selections, ...extra });
const progress = (records, config = session) => getParticipantPollProgress(records, config, alice);
const expected = (answered, total = 3) => ({ total, answered, missing: total - answered, complete: total > 0 && answered === total });

equal(progress({ votes: [] }), expected(0));
equal(progress({ votes: [vote({ a: "yes" })] }), expected(1));
equal(progress({ votes: [vote(complete)] }), expected(3));
equal(progress({ votes: [vote({ a: "no", b: "no", 'strange."key': "no" })] }), expected(3), "No is an answer too");
equal(progress({ votes: [vote({ a: "yes", removed: "yes", b: "invalid", 'strange."key': "" })] }), expected(1));
equal(progress({ votes: [vote(complete), vote({ b: "" })] }), expected(2), "Explicit removal makes a vote partial again");
equal(progress({ votes: [vote({ a: "yes" }), vote({ b: "no", 'strange."key': "maybe" })] }), expected(3), "Merge legacy duplicate rows without clearing absent fields");
equal(progress({ votes: [vote(complete, { accountId: "other" }), vote(complete, { sessionNumber: 8 })] }), expected(0));
for (const identity of [{ playerId: "hero" }, { playerId: "100001" }, { discordId: "100001" }, { characterId: "hero" }]) {
  equal(progress({ votes: [{ ...identity, selections: complete }] }), expected(3), "Legacy voter identity");
}
equal(progress({ votes: [{ playerId: "hero", availability: { a: "yes" }, choices: { b: "no" }, selections: { 'strange."key': "maybe" } }] }), expected(3));
equal(progress([...["a", "b", 'strange."key'].map(optionId => ({ playerId: "hero", optionId, value: "no" })),
  { playerId: "hero", optionId: "a", value: "" }]), expected(2));
equal(progress(null, { ...session, votes: [vote({ a: "yes" })], availabilityVotes: [vote({ b: "maybe" })] }), expected(2));
equal(progress({ votes: [] }, { ...session, availabilityVotes: [vote(complete)] }), expected(0), "Empty canonical storage beats stale embedded votes");
equal(progress({ votes: [vote(complete)] }, { ...session, availabilityOptions: [{ id: "a" }, { id: "new" }] }), expected(1, 2));
equal(progress({ votes: [vote(complete)] }, { ...session, availabilityOptions: [] }), expected(0, 0));
for (const value of [false, "false", 0, "0", true, undefined]) {
  const preferences = normalizeDiscordBotPreferences({ pollRemindersEnabled: value, dmEnabled: false });
  equal(preferences.pollRemindersEnabled, true);
  equal(preferences.dmEnabled, false, "Other reminders can still be disabled");
}

class MemoryKv {
  constructor(entries = []) { this.store = new Map(entries); this.reads = []; this.writes = []; }
  async get(key) { this.reads.push(key); return this.store.get(key) ?? null; }
  async put(key, value) { this.writes.push(key); this.store.set(key, String(value)); }
  async delete(key) { this.store.delete(key); }
  json(key, value) { this.store.set(key, JSON.stringify(value)); }
}
function fixture(config = {}) {
  const kv = new MemoryKv();
  kv.json(`${prefix}session/current`, { ...session, ...config });
  kv.json(`${prefix}session-votes/7`, { votes: [] });
  const people = [{ ...alice, name: "Alice", role: "Barbaro", notificationPreferences: { dmEnabled: false, pollRemindersEnabled: false } }];
  const users = [{ id: "alice", discordId: "100001" }, { id: "dm-user", discordId: "100004", name: "Master" }];
  const files = new Map([["/app/assets/data/users.json", users], ["/app/assets/data/players.json", people]]);
  const env = { SIGILLO_KV: kv, DISCORD_BOT_TOKEN: "fake-test-token", FE_URL: "https://frontend.invalid/app/",
    DISCORD_BOT_NOTIFY_CAMPAIGNS: campaign };
  const requests = [], messages = [], unexpected = [];
  const state = { status: 200 };
  async function fetchMock(input, init = {}) {
    const url = new URL(String(input));
    if (url.origin === "https://frontend.invalid") return files.has(url.pathname)
      ? Response.json(files.get(url.pathname)) : new Response("Missing fixture", { status: 404 });
    const body = JSON.parse(init.body || "{}");
    if (url.origin === "https://discord.com" && url.pathname === "/api/v10/users/@me/channels") {
      equal(init.method, "POST");
      requests.push(body.recipient_id);
      return state.status === 200 ? Response.json({ id: `9${body.recipient_id}` })
        : Response.json({ message: "Fixture failure" }, { status: state.status });
    }
    const channel = url.pathname.match(/^\/api\/v10\/channels\/9(\d+)\/messages$/);
    if (url.origin === "https://discord.com" && channel) {
      equal(init.method, "POST");
      equal(body.allowed_mentions, { parse: [] });
      messages.push({ recipient: channel[1], content: body.content });
      return Response.json({ id: "999999" });
    }
    unexpected.push(String(input));
    throw new Error(`Unexpected network request (blocked): ${input}`);
  }
  return { kv, people, users, files, env, requests, messages, state, unexpected, fetchMock,
    tick: (date = "2026-11-15T12:00:00Z") => handleDiscordBotDmNotifications({ scheduledTime: Date.parse(date) }, env) };
}
async function withFixture(run, config) {
  const f = fixture(config), originalFetch = globalThis.fetch;
  globalThis.fetch = f.fetchMock;
  try { await run(f); equal(f.unexpected, []); }
  finally { globalThis.fetch = originalFetch; }
}

await withFixture(async f => {
  f.people.push({ id: "bob", discordId: "100002", campaignRole: "player" },
    { id: "carol", discordId: "100003", accountId: "carol", role: "Maga" },
    { id: "hidden", discordId: "100005", hidden: true }, { id: "inactive", discordId: "100006", isActive: false },
    { id: "observer", discordId: "100007", campaignRole: "spectator" });
  f.kv.json(discordBotPreferencesKey(campaign, "alice"), { dmEnabled: false, pollRemindersEnabled: false });
  f.kv.json(`${prefix}session-votes/7`, { votes: [vote({ a: "yes" }), vote(complete, { accountId: "carol" }),
    { playerId: "dm", selections: { a: "no", b: "maybe" } }] });
  const savedVotes = await f.kv.get(`${prefix}session-votes/7`);
  await f.tick();
  equal(f.messages.map(m => m.recipient).sort(), ["100001", "100002", "100004"]);
  match(f.messages.find(m => m.recipient === "100001").content, /voto.*parziale: hai risposto a 1 casella su 3\. Mancano ancora 2 risposte/s);
  match(f.messages.find(m => m.recipient === "100004").content, /Manca ancora 1 risposta/);
  match(f.messages.find(m => m.recipient === "100002").content, /non hai ancora votato/);
  for (const message of f.messages) match(message.content, /Sì, No o Forse: https:\/\/frontend.invalid\/app\/pages\/sondaggio.html$/);
  equal(f.kv.reads.some(key => key.includes("/preferences/")), false, "Preferences cannot suppress or break poll reminders");
  await f.tick("2026-11-15T12:15:00Z");
  await f.tick("2026-11-16T12:00:00Z");
  equal(f.messages.length, 3, "No repeats on the same day or before the next two-day interval");
  await f.tick("2026-11-17T12:00:00Z"); equal(f.messages.length, 6);
  f.kv.json(`${prefix}session-votes/7`, { votes: [vote(complete), { playerId: "bob", selections: complete },
    vote(complete, { accountId: "carol" }), { playerId: "dm", selections: complete }] });
  await f.tick("2026-11-19T12:00:00Z"); equal(f.messages.length, 6, "Completion stops reminders");
  equal(f.kv.writes.every(key => key.includes("/sent/poll-unvoted/")), true, "Cron only writes delivery markers");
  equal(JSON.parse(savedVotes).votes[0].selections, { a: "yes" });
}, { disableDiscordNotifications: true, dmAccountId: "dm-user", dmDiscordId: "100004" });

await withFixture(async f => {
  f.kv.json(`${prefix}session/current`, { ...session, availabilityVotes: [vote(complete)] });
  await f.tick(); equal(f.messages.length, 1, "Empty canonical votes override embedded copies");
});
await withFixture(async f => {
  f.kv.store.delete(`${prefix}session-votes/7`);
  f.kv.json(`${prefix}session/current`, { ...session, availabilityVotes: [vote(complete)] });
  await f.tick(); equal(f.messages.length, 0, "Old embedded votes remain readable when no vote document exists");
});
await withFixture(async f => {
  f.env.DISCORD_BOT_NOTIFY_CAMPAIGNS = "mago-folle";
  f.kv.json("campaign:mago-folle:session/current", { ...session, campaignId: "mago-folle" });
  await f.tick(); equal(f.messages.length, 0, "Missing roster cannot fall back to another campaign");
  f.files.set("/app/campaigns/mago-folle/data/players.json", [{ id: "alice-other", accountId: "alice", campaignRole: "player" }]);
  await f.tick(); equal(f.messages.length, 1);
  match(f.messages[0].content, /sondaggio.html\?campaign=mago-folle$/);
});
await withFixture(async f => {
  await f.tick("2026-11-13T12:00:00Z"); equal(f.messages.length, 0, "No reminder on poll creation day");
});
await withFixture(async f => {
  f.kv.json(discordBotPreferencesKey(campaign, "alice"), { dmEnabled: false });
  await f.tick("2026-11-15T09:00:00Z"); equal(f.messages.length, 0, "Other session reminders still honor the DM switch");
  f.kv.json(discordBotPreferencesKey(campaign, "alice"), { dmEnabled: true, sessionDayReminderEnabled: true });
  await f.tick("2026-11-15T09:00:00Z"); equal(f.messages.length, 1);
  match(f.messages[0].content, /oggi c.e. la sessione/);
}, { isScheduled: true, date: "2026-11-15", timeStart: "20:30" });

// Exercise the actual authenticated preferences API, including legacy opt-outs.
await withFixture(async f => {
  const secret = "notification-fixture-only";
  f.env.JWT_SECRET = secret;
  const parts = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ accountId: "alice", discordId: "100001", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")].join(".");
  const token = `${parts}.${createHmac("sha256", secret).update(parts).digest("base64url")}`;
  const key = discordBotPreferencesKey(campaign, "alice");
  f.kv.json(key, { pollRemindersEnabled: false, dmEnabled: false });
  const before = await f.kv.get(key);
  async function call(body, authenticated = true) {
    const response = await worker.fetch(new Request(`https://worker.invalid/api/discord-bot/preferences?campaign=${campaign}`, {
      method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, {});
    return { status: response.status, body: await response.json() };
  }
  const read = await call(); equal(read.status, 200); equal(read.body.preferences.pollRemindersEnabled, true);
  equal(await f.kv.get(key), before, "Reading old preferences does not rewrite them");
  const saved = await call({ pollRemindersEnabled: false, dmEnabled: false, sessionDayReminderEnabled: false });
  equal(saved.status, 200); equal(saved.body.preferences.pollRemindersEnabled, true);
  equal(JSON.parse(await f.kv.get(key)).pollRemindersEnabled, true, "A crafted request cannot disable reminders");
  equal(saved.body.preferences.dmEnabled, false); equal(saved.body.preferences.sessionDayReminderEnabled, false);
  equal((await call(undefined, false)).status, 401);
});

// Real temporary D1, with stale KV votes that must never mask a partial D1 vote.
const runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('fixture')}}",
  compatibilityDate: "2026-05-15", d1Databases: ["POLL_DB"], d1Persist: false });
try {
  const db = await runtime.getD1Database("POLL_DB");
  const schema = await readFile(new URL("../workers/main-worker/migrations/0001_polls.sql", import.meta.url), "utf8");
  await db.batch(schema.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  await withFixture(async f => {
    f.kv.store.clear();
    Object.assign(f.env, { POLL_DB: db, POLL_D1_CAMPAIGNS: campaign });
    const store = new D1PollStore(f.env, campaign);
    await store.saveSession(session, 0);
    await store.saveVote(7, { accountId: "alice", authenticatedDiscordId: "100001", optionId: "a", value: "yes" });
    f.kv.json(`${prefix}session-votes/7`, { votes: [vote(complete)] });
    await f.tick(); equal(f.messages.length, 1); match(f.messages[0].content, /voto.*parziale/s);
    for (const [optionId, value] of [["b", "no"], ['strange."key', "maybe"]]) {
      await store.saveVote(7, { accountId: "alice", authenticatedDiscordId: "100001", optionId, value });
    }
    await f.tick("2026-11-17T12:00:00Z"); equal(f.messages.length, 1, "Completing the actual D1 poll stops reminders");
    await store.saveVote(7, { accountId: "alice", authenticatedDiscordId: "100001", optionId: "b", value: "" });
    await f.tick("2026-11-19T12:00:00Z"); equal(f.messages.length, 2);
    match(f.messages[1].content, /Manca ancora 1 risposta/);
  });
} finally { await runtime.dispose(); }
console.log(`Discord poll reminders: ${checks} checks passed (mock Discord, temporary D1).`);
