import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { filterNpcReferences, npcReferenceKey, npcReferencePage } from "../assets/js/shared/npc-reference-picker.mjs";

const catalog = Array.from({ length: 65 }, (_, index) => ({ name: `NPC ${index + 1}`, role: index === 42 ? "Custode Éléonore" : "Guardia", managedActorWorldId: "world", managedActorId: `npc-${index}`, kind: index % 2 ? "creature" : "person", categoryId: index % 3 ? "custodi" : "alleati", category: index % 3 ? "Custodi" : "Alleati", categoryGroupId: "alleati", categoryGroupName: "Alleati", archived: index === 64 }));
const seen = [];
for (let page = 0; page < 3; page++) {
    const result = npcReferencePage(catalog, {}, page);
    assert.equal(result.total, 65); assert.equal(result.pages, 3);
    seen.push(...result.items.map(npcReferenceKey));
}
assert.equal(new Set(seen).size, 65, "every NPC is reachable across pages, including entries beyond the old limit of 18");
assert.deepEqual(new Set(seen), new Set(catalog.map(npcReferenceKey)));
assert.equal(npcReferencePage(catalog, {}, 999).page, 2);
assert.equal(npcReferencePage(catalog, {}, -5).page, 0);
assert.equal(filterNpcReferences(catalog, { search: "eleonore custode" })[0].managedActorId, "npc-42", "search handles accents and multiple terms");
assert.equal(filterNpcReferences(catalog, { categoryId: "alleati" }).length, 65, "parent filters include subcategories");
assert.ok(filterNpcReferences(catalog, { categoryId: "custodi", kind: "creature" }).every(npc => npc.kind === "creature" && npc.categoryId === "custodi"));
assert.ok(filterNpcReferences(catalog).some(npc => npc.archived), "archived NPC are included in the full DM catalog");
assert.equal(npcReferencePage(catalog, { search: "not present" }).total, 0);

const source = await readFile(new URL("../assets/js/shared/npc-ability-icons.js", import.meta.url), "utf8");
const start = source.indexOf("    function selectableAbilityIconIds(data)"), end = source.indexOf("    async function open(", start);
const data = { items: [{ id: "available", type: "feat" }, { id: "accepted", type: "weapon" }, { id: "spell", type: "spell" }, { id: "blocked", type: "feat", blocked: true }, { id: "running", type: "spell" }, { id: "confirming", type: "feat" }], jobs: [{ itemId: "accepted", status: "accepted" }, { itemId: "running", status: "icon-running" }, { itemId: "confirming", status: "confirming" }] };
const selected = new Set(['spell']);
const filters = { type: 'abilities', onlySelected: false };
let refreshes = 0;
const context = vm.createContext({ data, busy: false, selected, filters, render: () => { refreshes++; }, saveView() {}, fetch: () => assert.fail("Selection must not start a provider request") });
vm.runInContext(source.slice(start, end), context);
assert.equal(vm.runInContext("selectableAbilityIconIds(null).length", context), 0);
vm.runInContext('const visibleItems = () => visibleAbilityIconItems(data, selected, filters);', context);
assert.deepEqual(Array.from(vm.runInContext('visibleItems().map(item => item.id)', context)), ['available','accepted','blocked','confirming']);
assert.deepEqual(Array.from(vm.runInContext('visibleAbilityIconItems(data, selected, {type:"spells"}).map(item => item.id)', context)), ['spell','running']);
assert.deepEqual(Array.from(vm.runInContext('visibleAbilityIconItems(data, selected, {onlySelected:true}).map(item => item.id)', context)), ['spell']);
assert.equal(vm.runInContext('abilityIconType({id:"legacy"}, {definition:{items:[{itemId:"legacy",type:"spell"}]}})', context), 'spell', 'Older Worker lists use synchronized item types');
const toggleStart = source.indexOf("        const selectAll = value =>");
const toggleEnd = source.indexOf("        el('[data-select-all]').addEventListener", toggleStart);
vm.runInContext(source.slice(toggleStart, toggleEnd), context);
vm.runInContext("selectAll(true)", context);
assert.deepEqual([...selected], ['spell', 'available', 'accepted'], 'Bulk selection adds only visible eligible items and retains hidden choices');
vm.runInContext("selectAll(false)", context);
assert.equal(selected.size, 0);
context.busy = true; vm.runInContext("selectAll(true)", context);
assert.equal(selected.size, 0); assert.equal(refreshes, 2, "bulk actions are locked while a generation is active");

// Run the actual batch controller: a running/finished card must remain in the
// selected-only grid, and every icon keeps its own frozen optional direction.
const generationStart = source.indexOf('        async function generate(ids)');
const generationEnd = source.indexOf('        async function apply(id)', generationStart);
const renders = [], requests = [], notices = [], batchData = structuredClone(data);
batchData.iconDirections = 1; batchData.jobs = [];
const batchSelected = new Set(), batchFilters = { type: 'spells', onlySelected: false };
const batch = vm.createContext({ data: batchData, selected: batchSelected, filters: batchFilters, busy: false, closed: false, timer: null, directions: new Map([['available','Una runa azzurra'],['spell','Una sagoma rossa']]), attempts: {}, crypto: { randomUUID: () => `job-${requests.length}` },
    clearTimeout() {}, saveView() {}, saveAttempts() {},
    status: text => notices.push(text),
    render() { renders.push(Array.from(batchData.items.filter(item => !batchFilters.onlySelected || batchSelected.has(item.id)), item => item.id)); },
    async request(suffix, body, itemId) { requests.push({body, itemId}); batchData.jobs.push({id:body.requestId,itemId,status:'icon-running'}); return {json:async()=>({job:{id:body.requestId}})}; },
    async load() { const job = batchData.jobs.at(-1); job.status = 'ready'; job.iconId = job.id; batch.directions.set('spell','Changed after starting'); },
    jobFor: id => batchData.jobs.find(job => job.itemId === id), running: job => ['icon-pending','icon-running'].includes(job?.status)
});
vm.runInContext(source.slice(start,end) + source.slice(generationStart,generationEnd), batch);
await vm.runInContext('generate(["available","spell","accepted","blocked"])', batch);
assert.deepEqual(requests.map(request=>request.itemId), ['available','spell','accepted']);
assert.deepEqual(requests.map(request=>request.body.details), ['Una runa azzurra','Una sagoma rossa',''], 'Each image receives only its own captured text, including an empty optional field');
assert.ok(renders.every(ids => ids.join(',') === 'available,accepted,spell'), 'Processing/finished cards never disappear from the selected group');
assert.equal(batchFilters.type,'all'); assert.equal(batchFilters.onlySelected,true);
assert.deepEqual([...batchSelected],['available','spell','accepted']);
batchData.iconDirections = undefined; requests.length = 0;
await vm.runInContext('generate(["available"])', batch);
assert.equal(requests.length,0,'Optional text never gets silently ignored by an older Worker');
assert.match(notices.at(-1),/Aggiorna il Worker/);
console.log('NPC generation UI: full catalog, filters, icon types and legacy fallback, visible bulk selection, stable selected-only batches and isolated per-icon directions passed. No paid calls.');
