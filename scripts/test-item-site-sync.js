"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const normalizerSource = fs.readFileSync(path.join(__dirname, "../assets/js/shared/item-normalize.js"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "../assets/js/pages/oggetti.js"), "utf8");
const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    window: {
        CriptaApp: { onPageReady() {}, utils: { escapeHtml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } } },
        localStorage: {
            values: new Map(),
            getItem(key) { return this.values.get(key) ?? null; },
            setItem(key, value) { this.values.set(key, String(value)); }
        },
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
vm.runInContext(normalizerSource, context, { filename: "item-normalize.js" });
vm.runInContext(source, context, { filename: "oggetti.js" });

function createClassList() {
    const values = new Set();
    return {
        contains(value) { return values.has(value); },
        toggle(value, force) {
            const active = force === undefined ? !values.has(value) : Boolean(force);
            if (active) values.add(value);
            else values.delete(value);
            return active;
        }
    };
}

let configClick = null;
const configLabel = { textContent: "" };
const configButton = {
    hidden: true,
    attributes: new Map(),
    classList: createClassList(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    querySelector(selector) { return selector === "span" ? configLabel : null; },
    addEventListener(type, listener) { if (type === "click") configClick = listener; }
};
const configGrid = { classList: createClassList() };
const configState = { canEditItems: true, showConfigurationControls: false };
context.initConfigurationControlsButton(configButton, configState, { grid: configGrid });
assert.equal(configButton.hidden, false);
assert.equal(configButton.attributes.get("aria-pressed"), "false");
assert.equal(configLabel.textContent, "Mostra bottoni configurazione");
assert.equal(configGrid.classList.contains("is-configuration-visible"), false);
configClick();
assert.equal(configState.showConfigurationControls, true);
assert.equal(configButton.attributes.get("aria-pressed"), "true");
assert.equal(configLabel.textContent, "Nascondi bottoni configurazione");
assert.equal(configGrid.classList.contains("is-configuration-visible"), true);

const importedArmor = {
    type: "Armatura",
    foundry: { document: { type: "equipment", system: { type: { value: "medium", baseItem: "halfplate" } } } }
};
assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.CriptaItemNormalize.normalizeItemClassification(importedArmor))),
    { version: 1, family: "armor", subtype: "medium", baseItem: "halfplate" },
    "la classificazione viene derivata senza modificare il documento Foundry"
);
assert.equal(context.formatItemTypeLabel(importedArmor), "Armatura · Media");
assert.equal(context.formatItemTypeLabel({ type: "Materiali", classification: { version: 1, family: "material", subtype: "material" } }), "Materiale");
const armorFiltered = context.filterItems([importedArmor, { type: "Arma" }], {
    query: "", rarity: "all", type: "armor", category: "all", attunement: "all", lifecycle: "active", canEditItems: false, categoryRegistry: { categories: [] }
});
assert.equal(armorFiltered.length, 1, "il filtro Tipo usa la famiglia meccanica" );
const armorEditorMarkup = context.renderItemClassificationEditor(importedArmor);
assert.match(armorEditorMarkup, /Classificazione meccanica/);
assert.match(armorEditorMarkup, /data-item-classification="family"/);
assert.match(armorEditorMarkup, /value="medium" selected/);
const categorySelectMarkup = context.renderItemEditSelect("Categoria", "categoryId", "armature", [{ value: "armature", label: "Armature" }]);
assert.match(categorySelectMarkup, /value="armature" selected>Armature<\/option>/);
assert.doesNotMatch(categorySelectMarkup, /\[object Object\]/);
const armorSystem = { type: { value: "medium", baseItem: "halfplate" }, armor: { value: 15 } };
const heavyArmor = { ...importedArmor, classification: { version: 1, family: "armor", subtype: "heavy", baseItem: "plate" } };
context.synchronizeFoundrySystemFromSite(heavyArmor, importedArmor, armorSystem);
assert.deepEqual(JSON.parse(JSON.stringify(armorSystem.type)), { value: "heavy", baseItem: "plate" });
assert.deepEqual(JSON.parse(JSON.stringify(armorSystem.armor)), { value: 15 }, "la classificazione non cancella le altre meccaniche");
assert.equal(context.window.CriptaItemNormalize.foundryTypeForClassification(heavyArmor.classification), "equipment");
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
        { name: "Idea geniale", description: "Una proprietà eccezionale.", genial: true },
        { name: "Maledizione", description: "Un effetto negativo.", negative: true },
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
assert.match(system.description.value, /class="cripta-catalog-property cripta-catalog-property--normal"/);
assert.match(system.description.value, /class="cripta-catalog-property cripta-catalog-property--genial"[\s\S]*Idea geniale/);
assert.match(system.description.value, /class="cripta-catalog-property cripta-catalog-property--negative"[\s\S]*Maledizione/);
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