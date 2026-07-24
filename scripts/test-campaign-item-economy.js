"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
    const source = fs.readFileSync(path.join(__dirname, "../workers/main-worker/src/campaign-items.js"), "utf8");
    const api = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    const legacyCatalog = [{
        id: "legacy-ring",
        name: "Anello antico",
        type: "Anello",
        sync: { managed: true, pendingFoundry: false, siteRevision: 4 }
    }];
    const untouchedLegacy = api.normalizeCampaignItemsForSiteSave(legacyCatalog, legacyCatalog.map((entry) => ({ ...entry })));
    assert.equal(untouchedLegacy[0].classification, undefined, "un salvataggio non migra in massa gli oggetti legacy");
    assert.equal(untouchedLegacy[0].sync.pendingFoundry, false, "un oggetto legacy invariato non viene rimandato a Foundry");
    const classifiedLegacy = api.normalizeCampaignItemsForSiteSave(legacyCatalog, [{
        ...legacyCatalog[0],
        classification: { version: 1, family: "equipment", subtype: "ring" }
    }]);
    assert.deepEqual(classifiedLegacy[0].classification, { version: 1, family: "equipment", subtype: "ring" });
    assert.equal(classifiedLegacy[0].sync.pendingFoundry, true, "la classificazione modificata viene sincronizzata esplicitamente");
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
    const catalogDescription = (summary) => `<div class="cripta-catalog-description">
        <section class="cripta-catalog-summary"><p>${summary}</p></section>
        <div class="cripta-catalog-properties">
            <section class="cripta-catalog-property"><h3><span>Luce di Pezza</span><small class="cripta-catalog-property-charges">3</small></h3><p>Emette luce intensa.</p></section>
            <section class="cripta-catalog-property cripta-catalog-property--genial"><h3><span>Intuizione</span></h3><p>Una proprietà geniale.</p></section>
            <section class="cripta-catalog-property cripta-catalog-property--negative"><h3><span>Contraccolpo</span></h3><p>Un effetto negativo.</p></section>
        </div>
        <aside class="cripta-catalog-notes"><h4>Note della campagna</h4><p>Creata da Zara.</p></aside>
    </div>`;
    const snapshot = (amount, summary = "Un ago sottile e luminoso.", folderPath = "Oggetti della campagna / Reliquie di Zara", requiresAttunement = true) => ({
        campaignItemId: "zara-needle",
        appliedSiteRevision: 0,
        document: {
            itemId: "ITEM1",
            uuid: "Item.ITEM1",
            folderPath,
            document: {
                name: "Ago di Zara",
                type: "equipment",
                img: "icons/svg/item-bag.svg",
                system: {
                    type: { value: "ring", baseItem: "" },
                    price: { value: 99, denomination: "gp" },
                    identified: true,
                    rarity: "rare",
                    attunement: requiresAttunement ? "required" : "",
                    weight: { value: 0.5, units: "lb" },
                    description: { value: catalogDescription(summary) },
                    unidentified: { name: "Ago misterioso", description: "<p>Un ago dalla provenienza ignota.</p>" }
                },
                effects: [],
                flags: { "khuzoe-merchant": { cost: { components: [{ currencyId: "pezza", amount }] } }, "cripta-wiki-sync": { categoryId: "reliquie-zara", categoryName: "Reliquie di Zara" } }
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
    assert.equal(item.summary, "Un ago sottile e luminoso.");
    assert.deepEqual(item.properties, [
        { name: "Luce di Pezza", charges: "3", description: "Emette luce intensa." },
        { name: "Intuizione", charges: "", description: "Una proprietà geniale.", genial: true },
        { name: "Contraccolpo", charges: "", description: "Un effetto negativo.", negative: true }
    ]);
    assert.equal(item.notes, "Creata da Zara.");
    assert.equal(item.unidentifiedName, "Ago misterioso");
    assert.equal(item.unidentifiedDescription, "Un ago dalla provenienza ignota.");
    assert.equal(item.rarity, "Raro");
    assert.equal(item.attunement, true);
    assert.equal(item.weight, 0.5);
    assert.equal(item.categoryId, "reliquie-zara");
    assert.equal(item.category, "Reliquie di Zara");
    assert.deepEqual(item.classification, { version: 1, family: "equipment", subtype: "ring" });
    const removedByFoundry = await api.handleCampaignItemFoundrySync(request(snapshot(2, "Un ago sottile e luminoso.", "Oggetti della campagna / Reliquie di Zara", false)), campaign, env, {});
    assert.equal(removedByFoundry.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.attunement, false, "Foundry puo rimuovere il requisito quando il sito seguiva il valore canonico");

    const restoredByFoundry = await api.handleCampaignItemFoundrySync(request(snapshot(2)), campaign, env, {});
    assert.equal(restoredByFoundry.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.attunement, true, "Foundry puo ripristinare il requisito");

    const requestedWithoutAttunement = document.data.map((entry) => {
        if (entry.id !== "zara-needle") return entry;
        const next = structuredClone(entry);
        delete next.attunement;
        next.foundry.document.system.attunement = "";
        return next;
    });
    document.data = api.normalizeCampaignItemsForSiteSave(document.data, requestedWithoutAttunement);
    document.version += 1;
    await env.SIGILLO_KV.put(key, JSON.stringify(document));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.sync.pendingFoundry, true);
    const staleConfirmation = snapshot(2);
    staleConfirmation.appliedSiteRevision = item.sync.siteRevision;
    const rejectedConfirmation = await api.handleCampaignItemFoundrySync(request(staleConfirmation), campaign, env, {});
    const rejectedPayload = await rejectedConfirmation.json();
    assert.equal(rejectedPayload.results[0].status, "conflict");
    assert.equal(rejectedPayload.results[0].reason, "attunement-not-applied", "il Worker non conferma una sintonia non applicata");

    const validConfirmation = snapshot(2, "Un ago sottile e luminoso.", "Oggetti della campagna / Reliquie di Zara", false);
    validConfirmation.appliedSiteRevision = item.sync.siteRevision;
    const confirmedRemoval = await api.handleCampaignItemFoundrySync(request(validConfirmation), campaign, env, {});
    assert.equal(confirmedRemoval.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.notEqual(item.attunement, true);
    assert.equal(item.sync.pendingFoundry, false, "la rimozione viene chiusa solo dopo la conferma reale di Foundry");

    const updated = await api.handleCampaignItemFoundrySync(request(snapshot(3, "La luce ora pulsa lentamente.")), campaign, env, {});
    assert.equal(updated.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.cost.components[0].amount, 3, "il prezzo che seguiva Foundry continua a seguirlo");
    assert.equal(item.summary, "La luce ora pulsa lentamente.", "la descrizione che seguiva Foundry continua a seguirlo");

    item.cost = { components: [{ currencyId: "pezza", amount: 77 }] };
    item.summary = "Testo curato sul sito";
    item.properties = [{ name: "Versione editoriale", description: "Non sovrascrivere." }];
    await env.SIGILLO_KV.put(key, JSON.stringify(document));
    const curated = await api.handleCampaignItemFoundrySync(request(snapshot(4, "Testo successivo di Foundry")), campaign, env, {});
    assert.equal(curated.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.cost.components[0].amount, 77, "un prezzo curato separatamente sul sito non viene sovrascritto");
    assert.equal(item.summary, "Testo curato sul sito", "il testo curato separatamente sul sito non viene sovrascritto");
    assert.equal(item.properties[0].name, "Versione editoriale");

    const moved = await api.handleCampaignItemFoundrySync(request(snapshot(4, "Testo successivo di Foundry", "Cripta Wiki Items / Pozioni")), campaign, env, {});
    assert.equal(moved.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.categoryId, "pozioni", "spostare una scheda nella sottocartella Foundry aggiorna la categoria del sito");
    assert.equal(item.category, "Pozioni");
    assert.equal(item.summary, "Testo curato sul sito", "lo spostamento di cartella non sovrascrive il testo curato");

    const siteArchivedData = document.data.map((entry) => entry.id === "zara-needle" ? { ...entry, archived: true, archivedAt: "2026-07-22T12:00:00.000Z" } : entry);
    document.data = api.normalizeCampaignItemsForSiteSave(document.data, siteArchivedData);
    document.version += 1;
    await env.SIGILLO_KV.put(key, JSON.stringify(document));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.sync.pendingFoundry, true, "archiviare dal sito crea una modifica Foundry pendente");

    const archivedEntry = snapshot(4, "Testo successivo di Foundry", "Cripta Wiki Items / _ARCHIVIATI");
    archivedEntry.appliedSiteRevision = item.sync.siteRevision;
    archivedEntry.document.document.flags["cripta-wiki-sync"] = {
        categoryId: "pozioni",
        categoryName: "Pozioni",
        categoryIdentityVersion: 2,
        archived: true,
        archiveIdentityVersion: 1
    };
    const archived = await api.handleCampaignItemFoundrySync(request(archivedEntry), campaign, env, {});
    assert.equal(archived.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.archived, true);
    assert.equal(item.sync.pendingFoundry, false, "Foundry conferma lo spostamento in _ARCHIVIATI");
    assert.equal(item.category, "Pozioni", "archiviare non perde la categoria originale");

    const restoredEntry = snapshot(4, "Testo successivo di Foundry", "Cripta Wiki Items / Pozioni");
    restoredEntry.document.document.flags["cripta-wiki-sync"] = {
        categoryId: "pozioni",
        categoryName: "Pozioni",
        categoryIdentityVersion: 2,
        archived: false,
        archiveIdentityVersion: 1
    };
    const restored = await api.handleCampaignItemFoundrySync(request(restoredEntry), campaign, env, {});
    assert.equal(restored.status, 200);
    document = JSON.parse(store.get(key));
    item = document.data.find((entry) => entry.id === "zara-needle");
    assert.equal(item.archived, undefined, "spostare fuori dall'archivio ripristina il catalogo");

    console.log("Campaign items: round-trip descrizioni, prezzi personalizzati, archivio e protezione dati superati.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
