import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/js/pages/managed-actor.js", import.meta.url), "utf8");
const copy = value => JSON.parse(JSON.stringify(value));
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const equal = (actual, expected, message) => { assert.deepEqual(copy(actual), expected, message); assertions++; };
let timerCalls = 0;
let latest;
const posts = [];
let rejectRevision = false;
const sandbox = {
    console, structuredClone, URL, URLSearchParams, Set, Map, WeakMap, crypto: globalThis.crypto,
    CSS: { escape: value => value },
    document: { querySelector: () => null },
    window: {
        setTimeout: () => ++timerCalls, clearTimeout() {}, requestAnimationFrame() {},
        CriptaApp: {
            onPageReady() {}, auth: { getToken: () => "test-token" }, navigation: { addLeaveGuard() {} },
            api: {
                clearCache() {},
                async get() { return { data: copy(latest) }; },
                async post(url, body) {
                    posts.push(copy(body));
                    if (rejectRevision) { rejectRevision = false; throw Object.assign(new Error("revision"), { code: "VERSION_CONFLICT" }); }
                    return { command: { id: `c${posts.length}`, status: "pending", ...copy(body) } };
                }
            }
        }
    }
};
const exposed = `
    globalThis.editor = {
        setDocument(value, snapshot = false) { currentDocument = value; if (snapshot) managedEditorSnapshot = structuredClone(value); managedEditMode = true; },
        getDocument() { return currentDocument; },
        baseline(control, value, baseValue = value) { managedFieldBaselines.set(control, { value, baseValue }); },
        collectManagedEntityPatches, collectManagedActorPatches, acceptManagedFieldPatches,
        postManagedActorCommand, scheduleManagedCommandRefresh, renderManagedAbilityRules,
        renderManagedActivitiesGuide, renderManagedActivityPreview, renderCoreStats, saveManagedActorPage, managedDossierImageWidth,
        enqueueManagedItemUpdate, enqueueManagedEffectUpdate, saveManagedActorPresentation,
        hasManagedUnsavedChanges, refreshManagedCommandState,
        setAttempts(value) { managedCommandPollAttempts = value; }
    };
`;
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `${exposed}\n})();`), sandbox);
const editor = sandbox.editor;
const actor = { worldId: "world", actorId: "npc", revision: 1, name: "Plexus", media: {}, visibility: { state: "dm" }, definition: { abilities: { str: { value: 20 } }, attributes: { ac: { calc: "natural", flat: 18 }, hp: { max: 100 } }, items: [] }, sync: { commands: [] } };
latest = copy(actor);
editor.setDocument(copy(actor), true);
function field(kind, path, type, value, base = value) {
    const control = { dataset: {}, value: typeof value === "object" ? JSON.stringify(value) : String(value ?? ""), checked: value === true, reportValidity: () => true };
    control.dataset[`managed${kind[0].toUpperCase() + kind.slice(1)}Path`] = path;
    control.dataset[`managed${kind[0].toUpperCase() + kind.slice(1)}Type`] = type;
    if (kind === "actor") control.dataset.managedActorOriginal = JSON.stringify(base);
    editor.baseline(control, base, base);
    return control;
}
function form(controls, kind, extras = {}) {
    return { dataset: {}, querySelectorAll: selector => selector === `[data-managed-${kind}-path]` ? controls : [], querySelector: () => null, ...extras };
}

const quantity = field("item", "system.quantity", "number", 1);
const name = field("item", "name", "text", "Bite");
const itemForm = form([name, quantity], "item");
// A background refresh must not turn untouched quantity into a write.
editor.setDocument({ ...copy(actor), revision: 2, definition: { ...actor.definition, items: [{ itemId: "bite", state: { quantity: 2 } }] } });
name.value = "Bite modificato";
equal(editor.collectManagedEntityPatches(itemForm, "item", null), [{ path: "name", value: "Bite modificato", baseValue: "Bite" }], "untouched stale item value is not sent");
quantity.value = "3";
equal(editor.collectManagedEntityPatches(itemForm, "item", null)[1], { path: "system.quantity", value: 3, baseValue: 1 }, "item conflict baseline stays at the displayed revision");

const strength = field("actor", "system.abilities.str.value", "number", 20);
strength.value = "24";
editor.setDocument({ ...copy(actor), revision: 3, definition: { ...actor.definition, abilities: { str: { value: 22 } } } });
equal(editor.collectManagedActorPatches(form([strength], "actor")), [{ path: "system.abilities.str.value", value: 24, baseValue: 20 }], "actor conflict baseline is not silently refreshed");
const override = field("actor", "system.spells.spell1.override", "number", 4);
editor.baseline(override, 4, null);
override.value = "5";
equal(editor.collectManagedActorPatches(form([override], "actor"))[0].baseValue, null, "an absent source override stays absent, not the displayed derived maximum");

const activity = { save: { _id: "save", type: "save", save: { ability: ["dex"], dc: { formula: "26" } }, damage: { parts: [], onSave: "half" }, effects: [{ _id: "missing", onSave: false }], flags: { provider: { unknown: "preserve" } } } };
const activityField = field("item", "system.activities", "json", activity);
const changed = copy(activity); changed.save.save.dc.formula = "28";
activityField.value = JSON.stringify(changed);
const activityPatch = editor.collectManagedEntityPatches(form([activityField], "item"), "item", null)[0];
equal(activityPatch.value.save.flags, activity.save.flags, "unknown automation settings survive a guided edit");
equal(activityPatch.baseValue.save.save.dc.formula, "26", "activities preserve the original baseline");

const effectName = field("effect", "name", "text", "Prono");
effectName.value = "Trattenuto";
equal(editor.collectManagedEntityPatches(form([effectName], "effect"), "effect", null), [{ path: "name", value: "Trattenuto", baseValue: "Prono" }], "effects use the displayed baseline");
editor.acceptManagedFieldPatches(itemForm, "item", [{ path: "name", value: name.value }, { path: "system.quantity", value: 3 }]);
equal(editor.collectManagedEntityPatches(itemForm, "item", null), [], "accepted writes stop being unsaved drafts");
quantity.value = "4";
equal(editor.collectManagedEntityPatches(itemForm, "item", null)[0].baseValue, 3, "editing after an accepted write uses its desired baseline");

latest = { ...copy(actor), revision: 9 };
rejectRevision = true;
await editor.postManagedActorCommand({ kind: "actor.update", patches: [{ path: "system.abilities.str.value", value: 24, baseValue: 20 }] }, "token");
equal(posts.at(-1).expectedRevision, 9, "revision race is retried against latest envelope");
equal(posts.at(-1).patches[0].baseValue, 20, "revision retry preserves the field conflict check");

editor.setDocument({ ...copy(actor), sync: { commands: [{ status: "pending", kind: "effect.create" }] } });
editor.setAttempts(40);
editor.scheduleManagedCommandRefresh({ isConnected: true });
check(timerCalls > 0, "polling continues after the old retry cutoff for create commands");
const count = timerCalls;
editor.scheduleManagedCommandRefresh({ isConnected: false });
equal(timerCalls, count, "polling stops for detached pages");

editor.setDocument(copy(actor), true);
const rules = editor.renderManagedAbilityRules({ name: "Swallow", definition: { activities: activity, description: "Heals half damage" } });
check(rules.includes("Dettagli non disponibili") && !rules.includes("prono"), "effect IDs are not interpreted as conditions");
check(!rules.includes("50%"), "prose is not advertised as a configured damage-to-healing rule");
check(editor.renderManagedAbilityRules({ definition: { activities: {} } }) === "", "description-only abilities do not invent mechanics or add technical notices");
const stats = editor.renderCoreStats({ prof: 8, hp: { max: 100 } }, { cr: 20 }, {}, "npc", {}, {}, {}, true, false);
check(!stats.includes('data-managed-actor-path="system.attributes.prof"'), "derived proficiency cannot be edited as a stored field");
const geometry = editor.renderManagedActivitiesGuide({ attack: { type: "attack", range: { override: false }, target: { override: false }, duration: { override: false }, consumption: { targets: [{ type: "attribute", target: "abilities.str.value", value: "1" }] } } }, { definition: {} });
check(geometry.includes("Bersagli e area") && geometry.includes("Risorsa consumata"), "guided editor exposes area and resource consumption");
const healing = { type: "heal", healing: { number: 2, denomination: 8, bonus: "4", types: ["healing"] } };
const healingEditor = editor.renderManagedActivitiesGuide({ heal: healing }, { definition: {} });
check(healingEditor.includes('data-managed-guided-key="heal.healing.number"') && !healingEditor.includes('heal.damage.parts.0.number'), "healing edits target native healing data");
check(editor.renderManagedActivityPreview(healing, { definition: {} }).includes("2d8 + 4"), "healing preview shows the configured formula");

// Exercise Save sheet through real item/effect enqueue functions, without a browser.
const result = { textContent: "" };
const item = { itemId: "bite", transferId: "bite", name: "Bite", definition: { quantity: 1 }, state: { quantity: 1 } };
const effect = { id: "prone", name: "Prono" };
const saveName = field("item", "name", "text", "Bite"); saveName.value = "Bite nuovo";
const saveEffect = field("effect", "name", "text", "Prono"); saveEffect.value = "Effetto nuovo";
const saveButton = { disabled: false };
const root = { isConnected: true, dataset: {}, querySelectorAll: selector => selector === "[data-managed-item-form]" ? [batchItem]
    : selector === "[data-managed-effect-form]" ? [batchEffect] : [],
    querySelector: selector => selector === "[data-managed-status]" ? result : selector === "[data-managed-save]" ? saveButton : null };
const batchItem = form([saveName], "item", { dataset: { managedItemId: "bite", managedTransferId: "bite" }, closest: () => null,
    querySelector: selector => selector === "[data-managed-item-result]" ? { textContent: "" } : selector === "[data-managed-item-save]" ? itemButton : null });
const batchEffect = form([saveEffect], "effect", { dataset: { managedEffectId: "prone" }, querySelector: selector => selector === "[data-managed-effect-result]" ? { textContent: "" }
    : selector === "[data-managed-effect-save]" ? effectButton : null, insertAdjacentHTML() {} });
const itemButton = { closest: selector => selector === "[data-managed-item-form]" ? batchItem : root };
const effectButton = { closest: () => batchEffect };
editor.setDocument({ ...copy(actor), definition: { ...actor.definition, items: [item], effects: [effect] } }, true);
const beforeBatch = posts.length;
await editor.saveManagedActorPage(root);
equal(posts.slice(beforeBatch).map(post => post.kind), ["item.update", "effect.update"], "Save sheet includes existing item and effect drafts");
check(!editor.hasManagedUnsavedChanges(root), "saved batch has no unsent fields");
check(!root.inert && !saveButton.disabled, "batch releases controls");

check(editor.managedDossierImageWidth(970) === 340, "all chapter illustrations use the square image width as their standard");
check(editor.managedDossierImageWidth(628, 20) === editor.managedDossierImageWidth(970), "opening and full-width chapters align their illustration columns");
check(970 - editor.managedDossierImageWidth(970) - 28 >= 360, "wide illustrated chapters retain a readable text column");
check(320 - editor.managedDossierImageWidth(320) - 16 >= 180, "mobile illustrations leave space for the text");
check(editor.managedDossierImageWidth(40) <= 40, "illustrations cannot exceed even a very narrow container");

console.log(`Managed actor editor: ${assertions} behavioral checks passed.`);
