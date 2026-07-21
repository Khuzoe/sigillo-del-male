"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
    const source = fs.readFileSync(path.join(__dirname, "../workers/main-worker/src/economy-v1.js"), "utf8");
    const workerIndexSource = fs.readFileSync(path.join(__dirname, "../workers/main-worker/src/index.js"), "utf8");
    const economyPageSource = fs.readFileSync(path.join(__dirname, "../assets/js/pages/economy.js"), "utf8");
    const economyServiceSource = fs.readFileSync(path.join(__dirname, "../assets/js/shared/economy-service.js"), "utf8");
    const managedActorPageSource = fs.readFileSync(path.join(__dirname, "../assets/js/pages/managed-actor.js"), "utf8");
    const managedActorStyleSource = fs.readFileSync(path.join(__dirname, "../assets/css/pages/managed-actor-modern.css"), "utf8");
    const managedActorSyncSource = fs.readFileSync(path.join(__dirname, "../module/scripts/services/managed-actor-sync.js"), "utf8");
    const api = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    const store = new Map();
    const invalidations = [];
    const env = {
        INVENTORY_SYNC_SECRET: "foundry-secret",
        SIGILLO_KV: {
            get: async (key) => store.get(key) ?? null,
            put: async (key, value) => { store.set(key, value); }
        }
    };
    const services = {
        getOptionalAuthenticatedUser(request) {
            const token = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
            if (!token) return null;
            return token === "dm" ? { accountId: "dm", role: "dm" } : { accountId: token, role: "player" };
        },
        async requireUser(request) {
            return this.getOptionalAuthenticatedUser(request) || new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        },
        async isAuthenticatedCampaignContentEditor(user) {
            return user?.role === "dm";
        },
        getAuthenticatedAccountId(user) {
            return String(user?.accountId || "");
        },
        isFoundrySyncSecretAuthorized(request) {
            return request.headers.get("X-Inventory-Sync-Secret") === env.INVENTORY_SYNC_SECRET;
        },
        scheduleFoundryLiveInvalidation(_ctx, _env, payload) {
            invalidations.push(payload);
        }
    };
    const campaign = "test-campaign";

    const initial = await api.handleEconomyGet(new Request("https://test/api/economy"), campaign, env, {}, services);
    const initialJson = await initial.json();
    assert.equal(initial.status, 200);
    assert.equal(initialJson.version, 0);
    assert.equal(initialJson.registry.groups[0].currencies.length, 5);
    assert.equal(initialJson.permissions.canEdit, false);

    const playerSave = await api.handleEconomyPost(new Request("https://test/api/economy", {
        method: "POST",
        headers: { Authorization: "Bearer player", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 0, registry: initialJson.registry })
    }), campaign, env, {}, services, {});
    assert.equal(playerSave.status, 403);

    const customRegistry = structuredClone(initialJson.registry);
    customRegistry.groups.push({
        id: "zara-coins",
        name: "Monete di Zara",
        conversionMode: "none",
        baseCurrencyId: "pezza",
        order: 200,
        currencies: [{
            id: "pezza",
            name: "Moneta di pezza",
            symbol: "pezza",
            factor: 1,
            precision: 0,
            order: 10,
            icon: "media/campaigns/test-campaign/economy/currencies/pezza.webp",
            active: true,
            storage: { kind: "flag", path: "flags.khuzoe-merchant.wallet.pezza" }
        }]
    });
    const dmSave = await api.handleEconomyPost(new Request("https://test/api/economy", {
        method: "POST",
        headers: { Authorization: "Bearer dm", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 0, worldId: "test-world", registry: customRegistry })
    }), campaign, env, {}, services, {});
    assert.equal(dmSave.status, 200);
    const dmJson = await dmSave.json();
    assert.equal(dmJson.version, 1);
    assert.equal(dmJson.registry.groups.flatMap(group => group.currencies).find(currency => currency.id === "pezza")?.active, true);
    assert.equal(dmJson.registry.groups.flatMap(group => group.currencies).find(currency => currency.id === "pezza")?.icon, "media/campaigns/test-campaign/economy/currencies/pezza.webp");
    const economySandbox = { window: {}, structuredClone };
    vm.runInNewContext(economyServiceSource, economySandbox);
    const visualCost = economySandbox.window.CriptaEconomyService.costComponents({
        cost: { components: [{ currencyId: "pezza", amount: 3 }] }
    }, dmJson.registry);
    assert.equal(visualCost[0].formattedAmount, "3");
    assert.equal(visualCost[0].label, "pezza");
    assert.equal(visualCost[0].icon, "media/campaigns/test-campaign/economy/currencies/pezza.webp");
    assert.match(workerIndexSource, /"economy\/currencies"/, "la cartella R2 delle icone valuta e consentita");
    assert.match(workerIndexSource, /\["managed-actors", "economy"\]\.includes\(folder\)/, "la sottocartella delle icone e leggibile dal percorso media pubblico");
    assert.match(economyPageSource, /for \(const group of Array\.isArray\(S\.draft\?\.groups\)/, "l'upload aggiorna la valuta originale nel registro");
    assert.match(economyServiceSource, /costComponents/, "il servizio espone i componenti con metadati visuali");
    assert.match(managedActorPageSource, /managed-merchant-currency-icon/, "il negozio mostra l'icona della valuta");
    assert.match(managedActorStyleSource, /\.managed-merchant-currency-icon/, "l'icona del prezzo ha uno stile dedicato");
    assert.match(managedActorSyncSource, /cost:\s*normalizeManagedMerchantCost\(entry, price\)/, "Foundry conserva il costo personalizzato del mercante");
    assert.match(managedActorSyncSource, /MANAGED_MERCHANT_SCHEMA_VERSION\s*=\s*6/, "i mercanti esistenti vengono risincronizzati");
    assert.match(managedActorSyncSource, /function getManagedMerchantCampaignItemId/, "il modulo ricava il collegamento canonico senza alterare lo snapshot del mercante");
    assert.match(managedActorSyncSource, /snapshotFlags\.campaignItemId[\s\S]*snapshotFlags\.wikiItemId[\s\S]*liveId/, "l'identita canonica proviene solo da flag o UUID espliciti");
    assert.match(workerIndexSource, /campaignItemId \? \{ campaignItemId \} : \{\}/, "il Worker conserva il collegamento canonico opzionale");
    assert.match(managedActorPageSource, /managed-merchant-catalog-link/, "il negozio espone la scheda canonica senza duplicare immagini");
    assert.deepEqual(invalidations[0].collections, ["economy"]);

    const withoutCustom = structuredClone(dmJson.registry);
    withoutCustom.groups = withoutCustom.groups.filter(group => group.id !== "zara-coins");
    withoutCustom.groups[0].currencies[0].storage = { kind: "flag", path: "flags.khuzoe-merchant.wallet.pp" };
    const foundrySave = await api.handleEconomyPost(new Request("https://test/api/economy", {
        method: "POST",
        headers: { "X-Inventory-Sync-Secret": "foundry-secret", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, worldId: "test-world", registry: withoutCustom })
    }), campaign, env, {}, services, {});
    assert.equal(foundrySave.status, 200);
    const foundryJson = await foundrySave.json();
    const allCurrencies = foundryJson.registry.groups.flatMap(group => group.currencies);
    assert.equal(allCurrencies.find(currency => currency.id === "pezza")?.active, false, "una valuta omessa viene archiviata");
    assert.equal(allCurrencies.find(currency => currency.id === "pp")?.storage?.path, "system.currency.pp", "il percorso di una valuta esistente resta immutabile");

    const conflict = await api.handleEconomyPost(new Request("https://test/api/economy", {
        method: "POST",
        headers: { Authorization: "Bearer dm", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, registry: foundryJson.registry })
    }), campaign, env, {}, services, {});
    assert.equal(conflict.status, 409);

    console.log("Economy worker: permessi, versioni, archiviazione e storage superati.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
