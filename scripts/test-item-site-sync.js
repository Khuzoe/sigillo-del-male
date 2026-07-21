"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/pages/oggetti.js"), "utf8");
const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    window: {
        CriptaApp: { onPageReady() {}, utils: { escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } } },
        CriptaItemNormalize: {
            ITEM_TYPES: [],
            ITEM_RARITIES: [],
            filterVisibleItems(value) { return value; },
            normalizeSearch(value) { return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); },
            normalizeMaterialTags(value) { return value; },
            getVisibleMaterialTags(value) { return value; }
        }
    }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "oggetti.js" });

const original = {
    type: "Oggetto meraviglioso",
    rarity: "Comune",
    summary: "",
    notes: "",
    properties: [],
    unidentifiedDescription: ""
};
const draft = {
    ...original,
    type: "Pozione",
    rarity: "Molto raro",
    attunement: true,
    weight: "2.5",
    summary: "Prima riga\nseconda riga",
    notes: "Nota del DM",
    unidentifiedDescription: "Aspetto ancora misterioso.",
    properties: [
        { name: "Effetto", charges: "3", description: "Paragrafo uno.\n\nParagrafo due." },
        { name: "Segreto", description: "Non deve apparire.", hidden: true }
    ]
};
const system = {
    description: { value: "", chat: "chat preservata" },
    activities: { attack: { type: "attack" } },
    weight: { value: 0, units: "lb" }
};

context.synchronizeFoundrySystemFromSite(draft, original, system);
assert.match(system.description.value, /Prima riga<br \/>seconda riga/);
assert.match(system.description.value, /class="cripta-catalog-description"/);
assert.match(system.description.value, /<h3><span>Effetto<\/span>/);
assert.match(system.description.value, /class="cripta-catalog-property-charges">3<\/small>/);
assert.match(system.description.value, /Paragrafo uno\.<\/p><p>Paragrafo due\./);
assert.doesNotMatch(system.description.value, /Segreto|Non deve apparire/);
assert.match(system.description.value, /class="cripta-catalog-notes"[\s\S]*Nota del DM/);
assert.equal(system.description.chat, "chat preservata");
assert.equal(system.unidentified.description, "Aspetto ancora misterioso.");
assert.equal(system.rarity, "veryRare");
assert.equal(system.identified, true);
assert.equal(system.attunement, "required");
assert.equal(system.weight.value, 2.5);
assert.equal(system.weight.units, "lb");
assert.deepEqual(system.activities, { attack: { type: "attack" } });

const custom = { description: { value: "<p>Testo avanzato</p>" }, activities: { keep: true } };
context.synchronizeFoundrySystemFromSite(original, original, custom);
assert.equal(custom.description.value, "<p>Testo avanzato</p>", "un testo Foundry avanzato non viene riscritto senza modifiche narrative");
assert.deepEqual(custom.activities, { keep: true });

const empty = { description: { value: "" } };
const repair = { ...original, summary: "Riparazione" };
context.synchronizeFoundrySystemFromSite(repair, repair, empty);
assert.match(empty.description.value, /Riparazione/, "una descrizione Foundry vuota viene autoriparata dai dati leggibili");

assert.equal(context.mapSiteTypeToFoundry("Pozione"), "consumable");
console.log("Oggetti sito -> Foundry: testi, proprieta e meccaniche preservate.");