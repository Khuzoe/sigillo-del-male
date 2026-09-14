import assert from "node:assert/strict";
import worker from "../workers/main-worker/src/index.js";

// Fake codes only. No live network requests, secrets, or campaign writes.
const discordId = "123456789012345678";
const extraCode = "ALLE-TEST-CODE-NOT-A-REAL-SECRET";
const primary = "OLD-TEST-CODE||old-player|Old Player";
const extra = `${extraCode}|${discordId}|alle|Alle`;
const defaults = {
  JWT_SECRET: "device-login-test-jwt-secret",
  GLOBAL_ADMIN_ACCOUNT_IDS: "admin",
  GLOBAL_ADMIN_DEVICE_CODE: "GLOBAL-ADMIN-TEST-CODE-VERY-LONG",
  SIGILLO_KV: {
    async get() { return null; },
    async put() { assert.fail("Login must not write campaign data"); },
    async delete() { assert.fail("Login must not delete campaign data"); },
  },
};

async function login(code, configuration, expectedStatus = 200) {
  const response = await worker.fetch(new Request("https://worker.test/auth/device/login?campaign=mago-folle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, campaignId: "mago-folle" }),
  }), { ...defaults, ...configuration }, {});
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, payload.error || "Unexpected login status");
  return payload;
}

const configuration = Object.freeze({ DEVICE_LOGIN_CODES_SECRET: primary, DEVICE_LOGIN_CODES_EXTRA_SECRET: extra });
assert.equal((await login("OLD-TEST-CODE", configuration)).user.accountId, "old-player");
const alle = await login(extraCode, configuration);
assert.equal(alle.user.accountId, "alle");
assert.equal(alle.user.discordId, discordId);
assert.equal(alle.user.global_name, "Alle");
assert.equal((await login(" alle test code not a real secret ", configuration)).user.accountId, "alle");
assert.equal(configuration.DEVICE_LOGIN_CODES_SECRET, primary);
assert.equal(configuration.DEVICE_LOGIN_CODES_EXTRA_SECRET, extra);

// Optional extra registry; preserve the original secret-vs-legacy precedence.
assert.equal((await login(extraCode, { DEVICE_LOGIN_CODES_EXTRA_SECRET: extra })).user.accountId, "alle");
assert.equal((await login("OLD-TEST-CODE", { DEVICE_LOGIN_CODES: primary, DEVICE_LOGIN_CODES_EXTRA_SECRET: extra })).user.accountId, "old-player");
assert.equal((await login("OLD-TEST-CODE", { DEVICE_LOGIN_CODES_SECRET: primary })).user.accountId, "old-player");
await login("FALLBACK-TEST-CODE", {
  ...configuration, DEVICE_LOGIN_CODES: "FALLBACK-TEST-CODE||fallback|Fallback",
}, 401);
await login("UNKNOWN-TEST-CODE", configuration, 401);
await login("---", configuration, 401);

const multipleExtra = `\r\n ${extra} ;\nSECOND-TEST-CODE||second|Second\n`;
assert.equal((await login(extraCode, { ...configuration, DEVICE_LOGIN_CODES_EXTRA_SECRET: multipleExtra })).user.accountId, "alle");
assert.equal((await login("SECOND-TEST-CODE", { ...configuration, DEVICE_LOGIN_CODES_EXTRA_SECRET: multipleExtra })).user.accountId, "second");
assert.equal((await login("OLD-TEST-CODE", {
  ...configuration, DEVICE_LOGIN_CODES_EXTRA_SECRET: "INVALID|bad-discord-id|bad|Bad",
})).user.accountId, "old-player");
await login("INVALID", { DEVICE_LOGIN_CODES_EXTRA_SECRET: "INVALID|bad-discord-id|bad|Bad" }, 401);

// Additions cannot shadow a primary code or the global ADMIN code.
assert.equal((await login("OLD-TEST-CODE", {
  ...configuration, DEVICE_LOGIN_CODES_EXTRA_SECRET: "OLD-TEST-CODE||different|Different",
})).user.accountId, "old-player");
assert.equal((await login(defaults.GLOBAL_ADMIN_DEVICE_CODE, {
  ...configuration, DEVICE_LOGIN_CODES_EXTRA_SECRET: `${defaults.GLOBAL_ADMIN_DEVICE_CODE}||different|Different`,
})).user.accountId, "admin");

for (const campaign of ["mago-folle", "cripta-di-sangue", "oltre-il-velo"]) {
  const response = await worker.fetch(new Request(`https://worker.test/api/campaign/access?campaign=${campaign}`, {
    headers: { Authorization: `Bearer ${alle.token}` },
  }), { ...defaults, ...configuration }, {});
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.permissions.isEditor, false, "A new player code must not grant DM permissions");
  assert.equal(payload.permissions.isGlobalAdmin, false);
}

// Exercise the actual Discord callback, with both external requests mocked.
async function discordLogin(registry) {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests += 1;
    if (url === "https://discord.com/api/oauth2/token") return Response.json({ access_token: "fake-discord-token" });
    if (url === "https://discord.com/api/users/@me") return Response.json({ id: discordId, username: "test-discord-user" });
    assert.fail("Unexpected network request during the test");
  };
  try {
    const response = await worker.fetch(new Request("https://worker.test/auth/discord/callback?code=test-code&state=test-state&campaign=mago-folle", {
      headers: { Cookie: "oauth_state=test-state" },
    }), {
      ...defaults, ...registry,
      DISCORD_CLIENT_ID: "test-client", DISCORD_CLIENT_SECRET: "test-secret",
      DISCORD_REDIRECT_URI: "https://worker.test/auth/discord/callback", FE_URL: "https://site.test/",
    }, {});
    assert.equal(response.status, 302);
    assert.equal(requests, 2);
    const token = new URLSearchParams(new URL(response.headers.get("Location")).hash.slice(1)).get("token");
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

assert.equal((await discordLogin(configuration)).accountId, "alle");
assert.equal((await discordLogin({
  DEVICE_LOGIN_CODES_SECRET: `PRIMARY-DISCORD-TEST|${discordId}|original|Original`,
  DEVICE_LOGIN_CODES_EXTRA_SECRET: extra,
})).accountId, "original", "Extra entries must preserve existing Discord-to-account associations");

console.log("Device login additions passed: legacy codes, precedence, Discord mapping, invalid codes, and player-only permissions.");
