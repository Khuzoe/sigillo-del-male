import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
const sandbox = { console, URL, Set, Map, WeakMap, window: { CriptaApp: { onPageReady() {} } } };
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.api = {getManagedVisibleEntries, findManagedLinkedItem, resolveManagedFoundryLink,
        setActor(value) {currentDocument = value;}};
})();`), sandbox);
const api = sandbox.api;
let checks = 0;
function equal(actual, expected, label) {
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, label);
    checks++;
}
const actorUuid = "Actor.MixedCaseActor";
const actor = {actorUuid, definition: {items: []}};
const spells = ["Detect Evil and Good", "Invisibility", "Blade Barrier", "Dispel Evil and Good", "Resurrection", "Commune", "Control Weather"]
    .map((name, index) => ({itemId: `spell${index}`, uuid: `${actorUuid}.Item.spell${index}`, type: "spell", name,
        definition: {level: index, description: `<p>${name}</p>`, effects: []}}));
const owner = {itemId: "casting", uuid: `${actorUuid}.Item.casting`, name: "Innate Spellcasting", type: "feat", definition: {activities: {}}};
spells.forEach((spell, index) => {owner.definition.activities[`cast${index}`] = {type: "cast", spell: {uuid: spell.uuid, spellbook: false}};});
const copies = spells.map((spell, index) => ({...structuredClone(spell), itemId: `cache${index}`, uuid: `${actorUuid}.Item.cache${index}`, sourceId: spell.uuid,
    definition: {...structuredClone(spell.definition), effects: [{_id: "dnd5espellchange", type: "enchantment"}]}}));
actor.definition.items = [owner, ...copies, ...spells];
api.setActor(actor);
const before = JSON.stringify(actor);
equal(api.getManagedVisibleEntries(actor).filter(item => item.type === "spell").map(item => item.name), spells.map(item => item.name), "legacy snapshots show seven real spells, not fourteen cache/original records");
equal(JSON.stringify(actor), before, "reading never deletes or rewrites stored records");
for (const spell of spells) {
    equal(api.resolveManagedFoundryLink("UUID", `.${spell.itemId}`), spell.name, "relative sibling UUID resolves");
    equal(api.resolveManagedFoundryLink("UUID", `.Item.${spell.itemId}`), spell.name, "relative typed UUID resolves");
    equal(api.resolveManagedFoundryLink("UUID", spell.uuid), spell.name, "absolute actor UUID resolves");
}
equal(api.resolveManagedFoundryLink("UUID", ".missing", "Custom label"), "Custom label", "explicit labels win");
equal(api.resolveManagedFoundryLink("UUID", "Actor.Other.Item.spell0"), "Elemento collegato", "another actor's item ID is not mistaken for a local spell");
equal(api.resolveManagedFoundryLink("UUID", ".missing"), "Elemento collegato", "missing links do not accidentally match items without an ID");
spells[0].sourceId = "Compendium.dnd5e.spells.Item.source0";
equal(api.resolveManagedFoundryLink("UUID", spells[0].sourceId), spells[0].name, "compendium provenance resolves to an owned spell");
equal(api.resolveManagedFoundryLink("UUID", "Compendium.dnd5e.spells.source0"), spells[0].name, "legacy compendium UUID resolves");
owner.descriptionLinks = {"Compendium.external.spells.Item.external1": "External spell"};
equal(api.resolveManagedFoundryLink("UUID", "Compendium.external.spells.Item.external1"), "External spell", "exported names resolve links even when the spell is not embedded");
equal(api.resolveManagedFoundryLink("UUID", "toString"), "Elemento collegato", "inherited properties are never treated as labels");

const ordinaryCopy = {...structuredClone(spells[0]), itemId: "intentional", uuid: `${actorUuid}.Item.intentional`, sourceId: spells[0].uuid};
actor.definition.items.push(ordinaryCopy);
equal(api.getManagedVisibleEntries(actor).includes(ordinaryCopy), true, "same-name manually copied spells remain visible without native cache evidence");
owner.definition.activities.cast0.spell.spellbook = true;
equal(api.getManagedVisibleEntries(actor).includes(copies[0]), true, "legacy copies explicitly shown in Foundry's spellbook remain visible");
owner.definition.activities.cast0.spell.spellbook = false;
copies.forEach((copy, index) => {copy.cachedFor = `.Item.casting.Activity.cast${index}`;});
equal(api.getManagedVisibleEntries(actor).filter(item => item.type === "spell").length, 8, "explicit cache metadata hides only internal records");
copies[0].cachedFor = `${actorUuid}.Item.casting.Activity.cast0`;
equal(api.getManagedVisibleEntries(actor).includes(copies[0]), false, "absolute cached activity links work too");
owner.definition.activities.cast0.spell.spellbook = true;
equal(api.getManagedVisibleEntries(actor).includes(copies[0]), true, "explicit spellbook setting preserves distinct linked variants");
copies[0].cachedFor = ".Item.missing.Activity.cast0";
equal(api.getManagedVisibleEntries(actor).includes(copies[0]), true, "orphaned cache records remain inspectable");
delete copies[0].cachedFor;
delete owner.definition.activities.cast0;
equal(api.getManagedVisibleEntries(actor).includes(copies[0]), true, "legacy caches without a matching activity are not hidden");

// Optional installed-module check: exercise the real exporter, without a world.
if (process.argv[2]) {
    const moduleSource = await readFile(process.argv[2], "utf8");
    const start = moduleSource.indexOf("function buildManagedDescriptionLinks(");
    const end = moduleSource.indexOf("\nfunction ", moduleSource.indexOf("function buildManagedActorEntry(") + 1);
    assert.ok(start >= 0 && end > start);
    const sync = {
        MODULE_ID: "cripta-wiki-sync", foundry: {utils: {deepClone: structuredClone}},
        managedActorLinkDocumentSource: item => structuredClone(item._source),
        getItemTransferId: item => item.id, compactValue: value => value,
        cleanHtml: value => value, readSpellPreparation: () => ({method: "innate"}), spellPreparationForWiki: () => ({}),
        buildManagedEntryEffectiveRolls: () => undefined, managedActorLinkItemDefinitionSignature: () => "test",
        getManagedItemEffects: item => structuredClone(item._source.effects || []),
        fromUuidSync(target, {relative, strict}) {
            assert.equal(relative.id, "cached"); assert.equal(strict, false);
            if (target === ".missing") throw new Error("Missing document");
            return target === ".spell0" ? {name: "Detect Evil and Good"} : undefined;
        }
    };
    vm.runInNewContext(moduleSource.slice(start, end) + "\nglobalThis.exportEntry = buildManagedActorEntry;", sync);
    const item = {id: "cached", type: "spell", name: "Detect Evil and Good", _source: {
        flags: {dnd5e: {cachedFor: ".Item.casting.Activity.cast0"}},
        system: {description: {value: "@UUID[.spell0], @UUID[.missing]"}}
    }};
    const original = JSON.stringify(item);
    const exported = sync.exportEntry(item);
    equal(exported.cachedFor, ".Item.casting.Activity.cast0", "sync preserves native cache provenance");
    equal(exported.descriptionLinks, {".spell0": "Detect Evil and Good"}, "sync exports resolved names and tolerates missing links");
    equal(exported.definition.description, item._source.system.description.value, "raw descriptions survive unchanged for editing back to Foundry");
    equal(JSON.stringify(item), original, "export never mutates the source Item");
}
console.log(`Managed actor spells: ${checks} behavioral checks passed.`);
