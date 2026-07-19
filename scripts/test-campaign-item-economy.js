"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
    const source = fs.readFileSync(path.join(__dirname, "../workers/main-worker/src/campaign-items.js"), "utf8");
    const api = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    const store = new Map();
    const env = {
        INVENTORY_SYNC_SECRET: "secret",
        SIGILLO_KV: {
            get: async (key) => store.get(key) ?? null,
            put: async (key, value) => { store.set(key, value); }
        }
    };
    const campaign = "test-campaign";
    const key = `campaign:${campaign}:data:items:override`;
    const snapshot = (amount) => ({
        campaignItemId: "zara-needle",
        appliedSiteRevision: 0,
        document: {
            itemId: "ITEM1",
            uuid: "Item.ITEM1",
            document: {
                name: "Ago di Zara",
                type: "equipment",
                img: "icons/svg/item-bag.svg",
                system: { price: { value: 99, denomination: "gp" }, identified: true },
                effects: [],
                flags: { "khuzoe-merchant": { cost: { components: [{ currencyId: "pezza", amount }] } } }
            }
        }
    });
    const request = (entry, seedData = undefined) => new Request("https://test/api/campaign-items/foundry-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Inventory-Sync-Secret": "secret" },
        body: JSON.stringify({ campaignId: campaign, worldId: "test-world", items: [entry], ...(seedData ? { seedData } : {}) })
    });

    const created = await api.handleCampaignItemFoundrySync(request(snapshot(2), [{ id: "seed", name: "Seed" }]), campaign, env, {});
    assert.equal(created.status, 200);
    let document = JSON.parse(store.get(key));
    let item = document.data.find((entry) => entry.id === "zara-needle");
    assert.deepEqual(item.cost, { components: [{ currencyId: "pezza", amount: 2 }] });
    assert.equal(item.valueGold, undefined, "una valuta personalizzata non viene convertita implicitamente in oro");
    assert.equal(item.foundry.document.flags["khuzoe-merchant"].cost.components[0].amount, 2);

    const updated = await api.handleCampaignItemFoundrySync(request(snapshot(3)), campaign, env, {});
    assert.equal(updated.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.cost.components[0].amount, 3, "il prezzo che seguiva Foundry continua a seguirlo");

    item.cost = { components: [{ currencyId: "pezza", amount: 77 }] };
    await env.SIGILLO_KV.put(key, JSON.stringify(document));
    const curated = await api.handleCampaignItemFoundrySync(request(snapshot(4)), campaign, env, {});
    assert.equal(curated.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.cost.components[0].amount, 77, "un prezzo curato separatamente sul sito non viene sovrascritto");

    console.log("Campaign items: prezzi personalizzati e protezione dati superati.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
