"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
    const source = fs.readFileSync(path.join(__dirname, "../workers/main-worker/src/calendar-v2.js"), "utf8");
    const api = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    const store = new Map();
    const env = {
        SIGILLO_KV: {
            get: async (key) => store.get(key) ?? null,
            put: async (key, value) => { store.set(key, value); }
        }
    };
    const services = {
        getOptionalAuthenticatedUser(request) {
            const token = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
            if (!token) return null;
            return token === "dm"
                ? { accountId: "dm", role: "dm", campaignId: "test-campaign" }
                : { accountId: token, campaignId: "test-campaign" };
        },
        async requireUser(request, _env, cors) {
            return this.getOptionalAuthenticatedUser(request) || new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
        },
        async isAuthenticatedCampaignContentEditor(user) {
            return user?.role === "dm";
        },
        getAuthenticatedAccountId(user) {
            return String(user?.accountId || "");
        }
    };
    const campaign = "test-campaign";
    const legacyKey = `campaign:${campaign}:data:calendar:override`;
    store.set(legacyKey, JSON.stringify({
        version: 4,
        data: [
            { type: "config", name: "Test", weekdays: ["A", "B"], months: [{ name: "Uno", days: 5 }] },
            { type: "state", currentDate: "1-1-1" },
            { type: "note", id: "shared", date: "1-1-1", title: "Condivisa", visibility: "shared", ownerAccountId: "p1" },
            { type: "note", id: "private", date: "1-1-1", title: "Privata", visibility: "private", ownerAccountId: "p1" }
        ]
    }));

    const anonymous = await api.handleCalendarGet(new Request("https://test/api/calendar"), campaign, env, {}, services);
    const anonymousJson = await anonymous.json();
    assert.equal(anonymousJson.calendar.events.length, 0, "un anonimo non riceve note legacy");

    const playerRequest = new Request("https://test/api/calendar", { headers: { Authorization: "Bearer p1" } });
    const player = await api.handleCalendarGet(playerRequest, campaign, env, {}, services);
    const playerJson = await player.json();
    assert.deepEqual(playerJson.calendar.events.map((event) => event.id).sort(), ["private", "shared"]);

    const dmRequest = new Request("https://test/api/calendar/config", {
        method: "POST",
        headers: { Authorization: "Bearer dm", "Content-Type": "application/json" },
        body: JSON.stringify({
            expectedVersion: 4,
            definition: {
                ...playerJson.calendar.definition,
                timeSystem: { hoursPerDay: 30, minutesPerHour: 20, quickSteps: [{ unit: "minute", amount: 15 }] }
            },
            clock: { ...playerJson.calendar.clock, time: { hour: 29, minute: 10 } }
        })
    });
    const configured = await api.handleCalendarConfigPost(dmRequest, campaign, env, {}, services);
    assert.equal(configured.status, 200);
    const configuredJson = await configured.json();
    assert.equal(configuredJson.calendar.definition.timeSystem.hoursPerDay, 30);

    const stepRequest = new Request("https://test/api/calendar/clock", {
        method: "POST",
        headers: { Authorization: "Bearer dm", "Content-Type": "application/json" },
        body: JSON.stringify({
            expectedVersion: configuredJson.version,
            expectedRevision: configuredJson.calendar.clock.revision,
            delta: { unit: "minute", amount: 15 }
        })
    });
    const stepped = await api.handleCalendarClockPost(stepRequest, campaign, env, {}, services);
    assert.equal(stepped.status, 200);
    const steppedJson = await stepped.json();
    assert.deepEqual(steppedJson.calendar.clock.time, { hour: 0, minute: 5 });
    assert.equal(steppedJson.calendar.clock.date.day, 2);

    console.log("Calendar worker: privacy, migrazione e tempo superati.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
