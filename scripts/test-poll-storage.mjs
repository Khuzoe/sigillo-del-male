// Real local D1/SQLite and Worker routes; no production bindings or network.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "../workers/main-worker/node_modules/esbuild/lib/main.js";
import { Miniflare } from "../workers/main-worker/node_modules/miniflare/dist/src/index.js";
import { D1PollStore, pollD1Enabled } from "../workers/main-worker/src/poll-store.js";
import worker from "../workers/main-worker/src/index.js";

const secret = "poll-local-fixture-only";
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../workers/main-worker/src/index.js", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022" });
const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15",
  kvNamespaces: ["SIGILLO_KV"], kvPersist: false, d1Databases: ["POLL_DB"], d1Persist: false,
  bindings: { JWT_SECRET: secret, GLOBAL_ADMIN_ACCOUNT_IDS: "admin", POLL_D1_CAMPAIGNS: "test,other,cripta-di-sangue,broken,empty",
    POLL_WRITES_PAUSED_CAMPAIGNS: "paused",
    CAMPAIGN_EDITOR_ACCOUNT_IDS: "test:dm;other:dm;empty:dm", DISCORD_BOT_NOTIFY_CAMPAIGNS: "test", DISCORD_BOT_TOKEN: "" } });
let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
function jwt(accountId, discordId = "") {
  const parts = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ accountId, discordId, username: accountId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")].join(".");
  return `${parts}.${createHmac("sha256", secret).update(parts).digest("base64url")}`;
}
async function call(path, { body, account = "admin", discordId = "", token = jwt(account, discordId) } = {}) {
  const response = await runtime.dispatchFetch(`https://local.test${path}`, { method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", Origin: "https://khuzoe.github.io" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const session = (campaignId, number = 7) => ({ campaignId, number, dmAccountId: "dm", dmDiscordId: "",
  pollManagerAccountIds: ["manager"], isScheduled: false, pollTitle: "Prossima sessione",
  createdAt: "2026-10-01T12:00:00Z", availabilityOptions: [{ id: "a", label: "Lun", time: "20:30 - 23:30" },
    { id: "b", label: "Mar", time: "20:30 - 23:30" }, { id: 'strange."key', label: "Mer", time: "20:30 - 23:30" }] });
const vote = (optionId, value, extra = {}) => ({ campaignId: "test", sessionNumber: 7, accountId: "alice", optionId, value, ...extra });

try {
  const db = await runtime.getD1Database("POLL_DB"), kv = await runtime.getKVNamespace("SIGILLO_KV");
  const schema = await readFile(new URL("../workers/main-worker/migrations/0001_polls.sql", import.meta.url), "utf8");
  await db.batch(schema.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  // Applying the migration twice is safe and never removes data.
  await db.batch(schema.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  const originalVotes = { sessionNumber: 7, campaignId: "test", customMetadata: "preserved", votes: [
    { playerId: "alice", accountId: "alice", discordId: "100001", name: "Alice", selections: { a: "yes", b: "maybe", removed: "no" }, extra: "keep" },
    { playerId: "bob", accountId: "bob", discordId: "100002", name: "Bob", selections: { a: "no" } },
    { playerId: "old-hero", discordId: "100003", name: "Carol", selections: { a: "maybe" } }
  ] };
  const originals = new Map([
    ["campaign:test:session/current", JSON.stringify(session("test"))],
    ["campaign:test:session/7", JSON.stringify(session("test"))],
    ["campaign:test:session-votes/7", JSON.stringify(originalVotes)],
    ["campaign:other:session/current", JSON.stringify(session("other"))],
    ["campaign:other:session/7", JSON.stringify(session("other"))],
    ["campaign:other:session-votes/7", JSON.stringify({ sessionNumber: 7, campaignId: "other", votes: [] })],
    ["session/current", JSON.stringify(session("cripta-di-sangue", 11))],
    ["session-votes/11", JSON.stringify({ sessionNumber: 11, votes: [] })],
    ["campaign:broken:session/7", "{invalid"],
    ["campaign:legacy:session/current", JSON.stringify(session("legacy"))],
    ["campaign:legacy:session/7", JSON.stringify(session("legacy"))]
  ]);
  for (const [key, value] of originals) await kv.put(key, value);
  await kv.put("campaign:paused:session/current", JSON.stringify(session("paused")));
  equal((await call("/api/session", { body: { ...session("paused"), expectedRevision: 0 } })).status, 503);
  equal((await call("/api/session-votes", { account: "alice", body: vote("a", "yes", { campaignId: "paused" }) })).body.code, "POLL_WRITES_PAUSED");
  equal((await call("/api/session/current?campaign=paused")).body.number, 7, "Maintenance freezes writes while polls remain readable");

  const imported = await Promise.all(Array.from({ length: 4 }, () => call("/api/session/current?campaign=test")));
  for (const result of imported) { equal(result.status, 200); equal(result.body.revision, 1); }
  equal((await call("/api/session-votes?campaign=test&session=7")).body, originalVotes, "All selections, identities and extra fields survive import");
  equal((await db.prepare("SELECT COUNT(*) AS n FROM poll_votes WHERE campaign_id = 'test'").first()).n, 3, "Concurrent imports do not duplicate voters");
  const backup = await db.prepare("SELECT session_raw, votes_raw FROM poll_imports WHERE campaign_id = 'test' AND import_key = 'session:7'").first();
  equal(backup.votes_raw, originals.get("campaign:test:session-votes/7"), "Raw backup is byte-for-byte original");

  // Simultaneous users and simultaneous choices of one user do not replace
  // one another's selections. The vote API response shape remains unchanged.
  const saves = await Promise.all([
    call("/api/session-votes", { account: "alice", body: vote("a", "no") }),
    call("/api/session-votes", { account: "alice", body: vote("b", "yes") }),
    call("/api/session-votes", { account: "bob", body: vote("a", "yes", { accountId: "bob" }) }),
    call("/api/session-votes", { account: "new-player", body: vote("b", "maybe", { accountId: "new-player" }) })
  ]);
  for (const result of saves) { equal(result.status, 200); equal(result.body.saved, true); ok(Array.isArray(result.body.data.votes)); }
  const votes = (await call("/api/session-votes?campaign=test&session=7")).body;
  equal(votes.votes.find(v => v.accountId === "alice").selections, { a: "no", b: "yes", removed: "no" });
  equal(votes.votes.find(v => v.accountId === "alice").extra, "keep");
  equal(votes.votes.find(v => v.accountId === "bob").selections.a, "yes");
  equal(votes.customMetadata, "preserved");
  const firstVotes = await Promise.all(["a", "b"].map(optionId => call("/api/session-votes", {
    account: "first-time", body: vote(optionId, "yes", { accountId: "first-time" })
  })));
  for (const result of firstVotes) equal(result.status, 200);
  const firstTimeVotes = (await call("/api/session-votes?campaign=test&session=7")).body.votes.filter(v => v.accountId === "first-time");
  equal(firstTimeVotes.length, 1, "Concurrent first votes have a stable participant key");
  equal(firstTimeVotes[0].selections, { a: "yes", b: "yes" });
  equal((await call("/api/session-votes", { account: "alice", body: vote("a", "") })).status, 200);
  equal((await call("/api/session-votes?campaign=test&session=7")).body.votes.find(v => v.accountId === "alice").selections.a, "", "Cleared choices never return from KV");
  equal((await call("/api/session-votes", { account: "alice", body: vote('strange."key', "yes") })).status, 200, "Option ids are JSON data, not interpolated paths");
  equal((await call("/api/session-votes", { account: "carol", discordId: "100003", body: vote("b", "yes", { accountId: "carol" }) })).status, 200);
  equal((await call("/api/session-votes?campaign=test&session=7")).body.votes.find(v => v.accountId === "carol").selections, { a: "maybe", b: "yes" }, "Authenticated Discord identity adopts a legacy vote without losing choices");

  equal((await call("/api/session-votes", { account: "bob", body: vote("a", "yes") })).status, 403);
  equal((await call("/api/session-votes", { token: "", body: vote("a", "yes") })).status, 401);
  equal((await call("/api/session-votes", { account: "alice", body: vote("missing", "yes") })).status, 400);
  equal((await call("/api/session-votes", { account: "alice", body: vote("a", "invalid") })).status, 400);
  equal((await call("/api/session-votes", { account: "attacker", body: vote("a", "no", { accountId: "attacker", discordId: "100002" }) })).status, 200);
  equal((await call("/api/session-votes?campaign=test&session=7")).body.votes.find(v => v.accountId === "bob").selections.a, "yes", "Claimed Discord id cannot overwrite another player");

  const edits = await Promise.all(["First", "Second"].map(pollTitle => call("/api/session", { account: "dm", body: { ...session("test"), pollTitle, expectedRevision: 1 } })));
  equal(edits.map(result => result.status).sort(), [200, 409], "Exactly one concurrent configuration edit succeeds");
  equal((await call("/api/session/current?campaign=test")).body.revision, 2);
  equal((await call("/api/session", { account: "alice", body: { ...session("test"), dmAccountId: "alice", expectedRevision: 2 } })).status, 403, "Draft roles cannot grant editing rights");
  equal((await call("/api/session", { account: "manager", body: { ...session("test"), expectedRevision: 2 } })).status, 200, "Existing poll manager retains editing rights");
  equal((await call("/api/session", { account: "dm", body: session("test") })).status, 409, "Old clients cannot overwrite a D1 poll without a revision");
  const beforeNext = (await call("/api/session-votes?campaign=test&session=7")).body;
  equal((await call("/api/session", { account: "dm", body: { ...session("test", 8), expectedRevision: 0 } })).status, 200);
  equal((await call("/api/session/current?campaign=test")).body.number, 8);
  equal((await call("/api/session-votes?campaign=test&session=7")).body, beforeNext, "Creating a new poll preserves previous votes");
  equal((await call("/api/session-votes?campaign=test&session=8")).body.votes, []);
  equal((await call("/api/session", { account: "dm", body: { ...session("test", 7), expectedRevision: 1 } })).status, 409);
  equal((await call("/api/session/current?campaign=test")).body.number, 8, "Stale edit cannot move the current-session pointer");

  equal((await call("/api/session-votes?campaign=other&session=7")).body.votes, []);
  equal((await call("/api/session/current?campaign=empty")).status, 404, "Other campaigns never import original campaign's unscoped keys");
  equal((await call("/api/session/current?campaign=cripta-di-sangue")).body.number, 11, "Original current-only legacy poll is recovered");
  equal((await call("/api/session?campaign=broken&number=7")).status, 500);
  equal((await db.prepare("SELECT COUNT(*) AS n FROM poll_imports WHERE campaign_id = 'broken'").first()).n, 0, "Invalid data produces no partial migration");
  const absent = (await call("/api/session-votes?campaign=empty&session=99")); equal(absent.status, 404);
  equal((await db.prepare("SELECT COUNT(*) AS n FROM poll_imports WHERE campaign_id = 'empty' AND import_key = 'session:99'").first()).n, 0);

  // SQL validates the option again at write time, closing the window between
  // the HTTP route's validation and a manager removing the choice.
  const storage = new D1PollStore({ POLL_DB: db, SIGILLO_KV: kv }, "test");
  const current = await storage.getSession(8);
  await storage.saveSession({ ...session("test", 8), availabilityOptions: [] }, current.revision);
  await assert.rejects(storage.saveVote(8, { accountId: "alice", authenticatedDiscordId: "", optionId: "a", value: "yes" }), error => error.code === "POLL_OPTION_CONFLICT"); checks++;

  equal((await call("/api/polls/storage/export?campaign=test", { account: "alice" })).status, 403);
  const exported = await call("/api/polls/storage/export?campaign=test");
  equal(exported.status, 200); equal(exported.headers.get("Cache-Control"), "private, no-store");
  ok(exported.body.kvDocuments.some(entry => entry.key === "campaign:test:session-votes/7" && JSON.parse(entry.value).votes.find(v => v.accountId === "bob").selections.a === "yes"));
  ok(exported.body.originals.some(entry => entry.votes_raw === backup.votes_raw));
  const restored = new Map(originals);
  for (const entry of exported.body.kvDocuments) restored.set(entry.key, entry.value);
  const restoredEnv = { JWT_SECRET: secret, SIGILLO_KV: { get: async key => restored.get(key) ?? null }, POLL_D1_CAMPAIGNS: "" };
  const restoredResponse = await worker.fetch(new Request("https://local.test/api/session-votes?campaign=test&session=7"), restoredEnv, {});
  equal(restoredResponse.status, 200);
  equal((await restoredResponse.json()).votes.find(v => v.accountId === "alice").selections.a, "", "Rollback export preserves choices made after activation");
  for (const [key, value] of originals) equal(await kv.get(key), value, "Existing KV values are unchanged");

  // Disabled campaigns retain the existing KV APIs.
  equal((await call("/api/session/current?campaign=legacy")).body.number, 7);
  equal((await call("/api/session-votes", { account: "alice", body: vote("a", "yes", { campaignId: "legacy" }) })).status, 200);
  equal(JSON.parse(await kv.get("campaign:legacy:session-votes/7")).votes[0].selections.a, "yes");

  const restarted = new D1PollStore({ POLL_DB: db, SIGILLO_KV: { get() { throw new Error("KV must not be consulted after import"); } } }, "test");
  equal((await restarted.getVotes(7)).votes.find(v => v.accountId === "alice").selections.a, "");
  equal((await restarted.getCurrentSession()).number, 8);
  const botSource = await readFile(new URL("../workers/main-worker/src/discord-bot/notifications.js", import.meta.url), "utf8");
  const bot = { D1PollStore, pollD1Enabled, console, Intl, URL };
  vm.runInNewContext(botSource.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "")
    + "\nglobalThis.readers = {loadCurrentSession, loadSessionVotes};", bot);
  const d1Env = { POLL_DB: db, SIGILLO_KV: kv, POLL_D1_CAMPAIGNS: "test" };
  equal((await bot.readers.loadCurrentSession(d1Env, "test")).number, 8, "Discord reads the current D1 session, not the old KV pointer");
  equal((await bot.readers.loadSessionVotes(d1Env, "test", "7")).votes.find(v => v.accountId === "alice").selections.a, "");
  const brokenEnv = { POLL_D1_CAMPAIGNS: "test", SIGILLO_KV: { get() { assert.fail("No fallback to KV if binding is missing"); } } };
  const unavailable = await worker.fetch(new Request("https://local.test/api/session/current?campaign=test"), brokenEnv, {});
  equal(unavailable.status, 503);
  equal((await unavailable.json()).code, "POLL_STORAGE_UNAVAILABLE");

  const failStore = new D1PollStore({ POLL_DB: { prepare() { throw new Error("Database offline"); } }, SIGILLO_KV: {
    get() { assert.fail("D1 error must not trigger legacy fallback"); }, put() { assert.fail("Never write to KV on D1 error"); }
  } }, "test");
  await assert.rejects(failStore.saveVote(7, { accountId: "alice", authenticatedDiscordId: "", optionId: "a", value: "no" }), /Database offline/); checks++;
  console.log(`Poll D1 storage: ${checks} checks passed on real local SQLite (import, concurrency, permissions, revision conflicts, export and KV preservation).`);
} finally { await runtime.dispose(); }
