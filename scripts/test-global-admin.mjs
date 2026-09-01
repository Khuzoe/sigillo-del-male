import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../workers/main-worker/src/index.js";

class MemoryKv {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
  async delete(key) {
    this.store.delete(key);
  }
}

const env = {
  JWT_SECRET: "global-admin-test-secret",
  SIGILLO_KV: new MemoryKv(),
  GLOBAL_ADMIN_ACCOUNT_IDS: "admin",
  GLOBAL_ADMIN_DEVICE_CODE: "ADMIN-TEST-CODE-VERY-STRONG-2026",
  NOTES_ADMIN_ACCOUNT_IDS: "notes-only",
  DEVICE_LOGIN_CODES_SECRET: [
    "PLAYER-TEST-CODE||player|Player",
    "NOTES-TEST-CODE||notes-only|Notes Admin",
  ].join(";"),
};

async function login(code, campaign = "cripta-di-sangue", origin = "") {
  const response = await worker.fetch(new Request(`https://worker.test/auth/device/login?campaign=${campaign}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ code, campaignId: campaign }),
  }), env, {});
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error || `Login ${code} fallito`);
  if (origin) assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  return payload;
}

async function campaignAccess(token, campaign) {
  const response = await worker.fetch(new Request(`https://worker.test/api/campaign/access?campaign=${campaign}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), env, {});
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error || `Accesso ${campaign} fallito`);
  return payload;
}

async function corsPreflight(origin) {
  return worker.fetch(new Request("https://worker.test/auth/device/login?campaign=mago-folle", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  }), env, {});
}

for (const origin of [
  "http://79.19.118.218:2050",
  "http://93.44.120.17:30000",
  "https://desktop-5bh5mve.tail197377.ts.net",
  "https://foundry.example.test",
]) {
  const response = await corsPreflight(origin);
  assert.equal(response.status, 200, `Preflight CORS rifiutato per ${origin}`);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.has("Access-Control-Allow-Credentials"), false);
}

for (const origin of ["null", "file:///foundry", "ftp://foundry.example.test"]) {
  const response = await corsPreflight(origin);
  assert.equal(response.status, 403, `Origin non HTTP(S) accettata: ${origin}`);
  assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
}

const admin = await login("ADMIN-TEST-CODE-VERY-STRONG-2026", "cripta-di-sangue", "http://79.19.118.218:2050");
assert.equal(admin.user.accountId, "admin");
for (const campaign of ["cripta-di-sangue", "mago-folle", "oltre-il-velo", "campagna-futura"]) {
  const access = await campaignAccess(admin.token, campaign);
  assert.equal(access.permissions.isEditor, true, `ADMIN deve essere editor in ${campaign}`);
  assert.equal(access.permissions.canManageCampaign, true, `ADMIN deve gestire ${campaign}`);
  assert.equal(access.permissions.isGlobalAdmin, true, `ADMIN deve essere riconosciuto globalmente in ${campaign}`);
}

const player = await login("PLAYER-TEST-CODE");
const playerAccess = await campaignAccess(player.token, "campagna-futura");
assert.equal(playerAccess.permissions.isEditor, false);
assert.equal(playerAccess.permissions.canManageCampaign, false);
assert.equal(playerAccess.permissions.isGlobalAdmin, false);

const notesAdmin = await login("NOTES-TEST-CODE");
const notesAccess = await campaignAccess(notesAdmin.token, "campagna-futura");
assert.equal(notesAccess.permissions.isEditor, false, "un amministratore delle note non deve diventare DM globale");
assert.equal(notesAccess.permissions.isGlobalAdmin, false);

const workerSource = await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
assert.match(workerSource, /async function isAuthenticatedCampaignContentEditor[\s\S]*?isAuthenticatedGlobalAdmin\(user, env\)/);
assert.match(workerSource, /async function isAuthenticatedCampaignEditor[\s\S]*?isAuthenticatedGlobalAdmin\(user, env\)/);
assert.match(workerSource, /async function isMissionEditor[\s\S]*?isAuthenticatedGlobalAdmin\(user, env\)/);
assert.match(workerSource, /const canManagePoll = isAuthenticatedGlobalAdmin\(user, env\)/);

assert.match(workerSource, /const globalAdminCode = normalizeDeviceCode\(env\.GLOBAL_ADMIN_DEVICE_CODE/);

const [nextSessionSource, notesSource, itemsSource, usersSource, wranglerSource] = await Promise.all([
  readFile(new URL("../assets/js/shared/next-session.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/js/pages/appunti.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/js/pages/oggetti.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/data/users.json", import.meta.url), "utf8"),
  readFile(new URL("../workers/main-worker/wrangler.jsonc", import.meta.url), "utf8"),
]);
assert.match(nextSessionSource, /async canManageCampaign\(\)/);
assert.match(nextSessionSource, /canManageCampaign\s*\|\| canManagePoll/);
assert.match(notesSource, /state\.isDm = Boolean\(canManageCampaign\)/);
assert.match(itemsSource, /CriptaDiscordAuth\.isCurrentUserDm/);
assert.equal(JSON.parse(usersSource).some((account) => account.id === "admin" && account.name === "ADMIN"), true);
assert.match(wranglerSource, /"GLOBAL_ADMIN_ACCOUNT_IDS":\s*"admin"/);
assert.match(wranglerSource, /"GLOBAL_ADMIN_DEVICE_CODE"/);

console.log("Global ADMIN permissions passed across every campaign and frontend gate.");
