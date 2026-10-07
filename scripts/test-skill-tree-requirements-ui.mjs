import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/shared/character-skill-tree.js', import.meta.url), 'utf8');
const sandbox = {console, Set, Map, URL, window: {localStorage: {getItem() {return null;}}}};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
  globalThis.ui = {applySkillTreeRuntime, deriveSkillTreeNodes, getSkillTreeRequirementView,
    renderSkillTreeRequirementChecklist, renderSkillTreeNodeProgress, renderSkillTreeRequirementEditorCard};
})();`), sandbox);
const ui = sandbox.ui;
ui.applySkillTreeRuntime({escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))});
const copy = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const test = (label, run) => {run(); checks++; console.log(`OK ${label}`);};
const node = {id: 'next', title: 'Next', requires: ['a','b'], levels: [{label:'I'},{label:'II'},{label:'III'}], externalRequirements: [
  {id:'goal',label:'Approval',target:1,level:1},
  {id:'count',label:'Research',target:10,level:1},
  {id:'stone',label:'Stone',target:20,level:2},
  {id:'quest',label:'Quest',target:1,level:3}
]};
const tree = {id:'demo',nodes:[{id:'a',title:'A'},{id:'b',title:'B'},node]};
function view(state = {}, level, definition = tree) {
  const derived = ui.deriveSkillTreeNodes(definition, state).find(row => row.id === 'next');
  return ui.getSkillTreeRequirementView(definition, derived, new Set(state.unlocked || []), state.externalProgress || {}, level);
}
test('all prerequisites report the missing ability', () => {
  const v = view({unlocked:['a']});
  assert.equal(v.ready,false); assert.match(v.summary,/B/); assert.equal(v.total,4);
});
test('any prerequisites count as a single logical condition', () => {
  const any = copy(tree); any.nodes[2].requiresMode = 'any';
  const v = view({unlocked:['a'],externalProgress:{next:{goal:1,count:10}}},1,any);
  assert.equal(v.total,3); assert.equal(v.done,3); assert.equal(v.ready,true);
  assert.match(ui.renderSkillTreeRequirementChecklist(v,'next',true),/Alternativa facoltativa/);
});
test('mixed counters do not add unlike quantities', () => {
  const v = view({unlocked:['a','b'],externalProgress:{next:{count:5}}});
  assert.equal(v.done,2); assert.equal(v.percent,63); assert.equal(v.total,4);
});
test('presentation agrees with unlock state', () => {
  const state = {unlocked:['a','b'],externalProgress:{next:{goal:1,count:10}}};
  assert.equal(view(state).ready,true);
  assert.equal(ui.deriveSkillTreeNodes(tree,state).find(row => row.id === 'next').state,'unlockable');
});
test('next stage uses only its own goals', () => {
  const v = view({unlocked:['a','b','next'],levels:{next:1}});
  assert.equal(v.level,2); assert.equal(v.external.length,1); assert.equal(v.external[0].id,'stone');
  assert.equal(v.dependencies.length,0);
});
test('future stage cannot show ready while its previous stage is missing', () => {
  const v = view({unlocked:['a','b'],externalProgress:{next:{quest:1}}},3);
  assert.equal(v.ready,false); assert.ok(v.percent < 100); assert.match(v.summary,/livello 2/);
  assert.match(ui.renderSkillTreeRequirementChecklist(v,'next',true),/disabled/);
});
test('completed stage displays completed goals without rewriting progress', () => {
  const state = {unlocked:['a','b','next'],levels:{next:2},externalProgress:{next:{count:2}}};
  const before = JSON.stringify(state);
  const v = view(state,1);
  assert.equal(v.completed,true); assert.equal(v.external[1].progress,10);
  assert.match(ui.renderSkillTreeRequirementChecklist(v,'next',true),/disabled/);
  assert.equal(JSON.stringify(state),before);
});
test('target one renders a checkbox and quantity renders a counter', () => {
  const html = ui.renderSkillTreeRequirementChecklist(view({unlocked:['a','b']}),'next',true);
  assert.match(html,/type="checkbox"/); assert.match(html,/type="number"/);
  assert.match(html,/aria-label="Completa Approval"/); assert.match(html,/aria-label="Progresso Research"/);
});
test('read only viewer is not invited to edit', () => {
  const html = ui.renderSkillTreeRequirementChecklist(view(),'next',false,false);
  assert.match(html,/disabled/); assert.doesNotMatch(html,/Seleziona il nodo per aggiornare/);
});
test('authorized hover explains how to edit', () => {
  assert.match(ui.renderSkillTreeRequirementChecklist(view(),'next',false,true),/Seleziona il nodo per aggiornare/);
});
test('exclusive choice blocker prevents a full progress bar', () => {
  const exclusive = {nodes:[{id:'root',connections:[{target:'next',mode:'exclusive'},{target:'other',mode:'exclusive'}]},
    {id:'next',requires:[]},{id:'other'}]};
  const v = view({unlocked:['root','other']},1,exclusive);
  assert.equal(v.ready,false); assert.ok(v.percent < 100); assert.match(v.summary,/alternativa/);
});
test('node indicators separate levels from requirements', () => {
  const html = ui.renderSkillTreeNodeProgress(view({unlocked:['a']}),0,3);
  assert.match(html,/Lv\. 0\/3/); assert.match(html,/1\/4/); assert.doesNotMatch(html,/level-dot|external-arc/);
});
test('ready indicator uses a clear label', () => {
  const html = ui.renderSkillTreeNodeProgress(view({unlocked:['a','b'],externalProgress:{next:{goal:1,count:10}}}),0,3);
  assert.match(html,/Pronto/); assert.doesNotMatch(html,/skill-node-requirement-track/);
});
test('large level counts do not generate a row of dots', () => {
  const html = ui.renderSkillTreeNodeProgress(view(),0,30);
  assert.match(html,/Lv\. 0\/30/); assert.doesNotMatch(html,/is-filled|skill-node-requirement-track/);
});
test('single completed node has no unnecessary indicators', () => {
  const v = view({unlocked:['a','b','next'],levels:{next:3}});
  assert.equal(ui.renderSkillTreeNodeProgress(v,1,1),'');
});
test('editor preserves identifiers and escapes names', () => {
  const requirement = {id:'stable"id',label:'<img onerror="bad">',target:20,level:2,presetId:'preset'};
  const before = JSON.stringify(requirement);
  const html = ui.renderSkillTreeRequirementEditorCard(requirement,3);
  assert.match(html,/stable&quot;id/); assert.match(html,/&lt;img/); assert.match(html,/value="20"/);
  assert.match(html,/<option value="2" selected/); assert.equal(JSON.stringify(requirement),before);
});
test('binary editor does not display a confusing numeric target', () => {
  const html = ui.renderSkillTreeRequirementEditorCard({id:'goal',label:'Goal',target:1,level:1},1);
  assert.match(html,/Obiettivo da completare/); assert.doesNotMatch(html,/data-node-external-field="target"/);
  assert.doesNotMatch(html,/Sposta in/);
});
console.log(`Skill tree requirements UI: ${checks} checks passed.`);
