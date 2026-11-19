import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/shared/character-skill-tree.js', import.meta.url), 'utf8');
const characterPageSource = await readFile(new URL('../assets/js/pages/character-main.js', import.meta.url), 'utf8');
const stylesheetHelpers = characterPageSource.slice(characterPageSource.indexOf('const CHARACTER_MODULE_VERSION ='), characterPageSource.indexOf('async function loadCharactersManifest('));
const moduleLoader = characterPageSource.slice(characterPageSource.indexOf('function loadCharacterSkillTreeModule('), characterPageSource.indexOf('function loadCharacterTransformationsModule('));
const loadedAssets = [];
const pageSandbox = {URL, window: {location: {href: 'https://wiki.test/subsite/pages/characters/character.html?embed=1'}}, document: {
  querySelector(selector) {
    if (selector.includes('data-character-style')) return loadedAssets.find(element => element.dataset.characterStyle === 'skill-tree') || null;
    if (selector.includes('assets/css/pages/character.css')) return {href: 'https://wiki.test/subsite/assets/css/pages/character.css?v=old'};
    if (selector.includes('assets/js/pages/character-main.js')) return {src: 'https://wiki.test/subsite/assets/js/pages/character-main.js?v=old'};
    return null;
  },
  createElement(tag) {return {tag, dataset: {}, listeners: {}, addEventListener(event, callback) {this.listeners[event] = callback;}};},
  head: {appendChild(element) {loadedAssets.push(element);}}
}};
vm.createContext(pageSandbox);
vm.runInContext('let characterSkillTreeModulePromise = null;\n' + stylesheetHelpers + moduleLoader, pageSandbox);
const initialModuleLoad = vm.runInContext('loadCharacterSkillTreeModule()', pageSandbox);
const injectedStyle = loadedAssets.find(asset => asset.tag === 'link');
const injectedScript = loadedAssets.find(asset => asset.tag === 'script');
assert.ok(injectedStyle, 'The legacy/Foundry tree page loads its stylesheet alongside the renderer');
assert.equal(new URL(injectedStyle.href).pathname, '/subsite/assets/css/pages/character-skill-tree.css');
assert.equal(new URL(injectedStyle.href).searchParams.get('v'), new URL(injectedScript.src).searchParams.get('v'), 'Tree markup and CSS use the same cache version');
pageSandbox.window.CriptaCharacterSkillTree = {loaded: true};
injectedScript.listeners.load();
assert.equal(await initialModuleLoad, pageSandbox.window.CriptaCharacterSkillTree);
await vm.runInContext('loadCharacterSkillTreeModule()', pageSandbox);
assert.equal(loadedAssets.length, 2, 'Reopening the tree does not duplicate styles or scripts');
// A renderer loaded by another host must still receive its stylesheet.
loadedAssets.length = 0;
await vm.runInContext('loadCharacterSkillTreeModule()', pageSandbox);
assert.equal(loadedAssets.length, 1);
assert.equal(loadedAssets[0].tag, 'link', 'Styles load even when the renderer is already available');
console.log('OK embedded tree asset loading, version alignment and repeated opening');
const sandbox = {console, Set, Map, URL, structuredClone, window: {localStorage: {getItem() {return null;}}}};
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
  globalThis.ui = {applySkillTreeRuntime, deriveSkillTreeNodes, getSkillTreeRequirementView, getSkillTreePlayerFacingDefinition,
    renderSkillTreeRequirementChecklist, renderSkillTreeNodeProgress, renderSkillTreeRequirementEditorCard,
    getSkillGradeModel, applySkillGradeModel, skillGradeHtml, normalizeSkillTreeDefinitionForSave};
})();`), sandbox);
const ui = sandbox.ui;
ui.applySkillTreeRuntime({escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))});
const copy = value => JSON.parse(JSON.stringify(value));
let checks = 1; // Embedded asset loading regression above.
const test = (label, run) => {run(); checks++; console.log(`OK ${label}`);};
const timed = {
  desc: '<p>Rimani per 1 ora.</p>',
  levels: [{}, {desc:'<p>Rimani per 8 ore.</p>', changeNotes:[{label:'Durata', before:'1 ora', after:'8 ore'}]},
    {desc:'<p>Rimani per quanto desideri.</p>', changeNotes:[{label:'Durata', before:'8 ore', after:'Quanto desideri'}]}],
  externalRequirements:[{id:'studio-3', level:3, label:'Studio', target:32}]
};
test('matching descriptions produce shared text without changing the original record', () => {
  const before = JSON.stringify(timed);
  const model = ui.getSkillGradeModel(timed);
  assert.deepEqual(copy(model.fields[0].values), ['1 ora','8 ore','quanto desideri']);
  assert.equal(ui.skillGradeHtml(model, 2), timed.levels[2].desc);
  assert.equal(JSON.stringify(timed), before);
});
test('one grade edit updates complete descriptions and adjacent comparisons across a save', () => {
  const n = copy(timed);
  const model = ui.getSkillGradeModel(n);
  model.fields[0].values[1] = '12 ore';
  ui.applySkillGradeModel(n, model);
  const saved = ui.normalizeSkillTreeDefinitionForSave({nodes:[n]}).nodes[0];
  assert.equal(saved.levels[0].desc, timed.desc);
  assert.equal(saved.levels[1].desc, '<p>Rimani per 12 ore.</p>');
  assert.equal(saved.levels[2].changeNotes[0].before, '12 ore');
  assert.equal(saved.externalRequirements[0].id, 'studio-3');
  assert.equal(ui.getSkillGradeModel(saved).fields[0].values[1], '12 ore');
  saved.levels[1].desc = '<p>Regola modificata separatamente.</p>';
  assert.equal(ui.getSkillGradeModel(saved), null);
});
test('the player sees compact grade values with separate acquired and preview states', () => {
  const model = {html:'<p>Bonus ⟦0⟧.</p>', fields:[{label:'Bonus', values:['+1','+3','+5']}]};
  const render = (preview, current) => ui.skillGradeHtml(model, preview, 'highlight', current);
  const preview = render(2, 1);
  assert.equal(preview.replace(/<[^>]*>/g, ''), 'Bonus +1/+3/+5.');
  assert.match(preview, /class="skill-grade-step is-current"[^>]*>\+3</);
  assert.match(preview, /class="skill-grade-step is-preview"[^>]*>\+5</);
  assert.match(preview, /aria-label="Bonus\. Grado I, \+1\. Grado II, \+3, attuale\. Grado III, \+5, in anteprima"/);
  assert.doesNotMatch(render(1, 1), /is-preview/);
  assert.doesNotMatch(render(0, -1), /is-current/);
  assert.equal(ui.skillGradeHtml(model, 1), '<p>Bonus +3.</p>');
  const field = model.fields[0];
  model.html = '<p>Infliggi ⟦0⟧danni.</p>';
  field.values = ['1d6 ', '2d6 ', '2d6 '];
  assert.equal(render(1, 1).replace(/<[^>]*>/g, ''), 'Infliggi 1d6/2d6/2d6 danni.');
  model.html = '<p>Ottieni ⟦0⟧.</p>';
  field.values = ['resistenza','resistenza','resistenza'];
  assert.equal(render(0, 0).replace(/<[^>]*>/g, ''), 'Ottieni resistenza.');
  field.values = ['una frase', 'una regola che occupa diverse righe della descrizione', 'fine'];
  assert.doesNotMatch(render(1, 0), /skill-grade-scale|una frase/);
  field.rich = true;
  field.values = ['<em>uno</em>', '<em>due</em>', '<em>tre</em>'];
  assert.equal(render(1, 0), ui.skillGradeHtml(model, 1));
  assert.match(render(1, 0), /due/);
});
test('a saved field with selection whitespace still opens in the variables editor', () => {
  const n = copy(timed);
  const model = ui.getSkillGradeModel(n);
  model.html = '<p>⟦1⟧' + model.html.slice(3);
  model.fields.push({label:'Frequenza', values:['Una ', 'Due ', 'Tre ']});
  ui.applySkillGradeModel(n, model);
  const saved = ui.normalizeSkillTreeDefinitionForSave({nodes:[n]}).nodes[0];
  assert.deepEqual(copy(ui.getSkillGradeModel(saved).fields), copy(model.fields));
});
test('ambiguous, missing or contradictory grade values keep the full descriptions', () => {
  const n = copy(timed);
  n.levels[2].desc = n.levels[1].desc;
  assert.equal(ui.getSkillGradeModel(n), null);
  n.desc = '<p>1 ora. Poi ancora 1 ora.</p>';
  assert.equal(ui.getSkillGradeModel(n), null);
  assert.equal(ui.getSkillGradeModel({desc:timed.desc, levels:[{}]}), null);
});
test('Amplificazione separates the two bonuses, preserves the authored lightning note and reopens after edits', () => {
  const notes = {id:'fulmine', type:'changed', label:'Resistenza Velkarya', before:'Resistenza Fulmine', after:'Immunità Fulmine'};
  const levels = ['+1', '+3', '+5'].map((bonus, i) => {
    const defense = `Velkarya ottiene un bonus di ${bonus} a Intelligenza e resistenza ai danni da fulmine.`;
    const spell = `Dopo la tua modifica, Velkarya è un chierico di ${5+i*4}° livello.`;
    return {desc: `<p>Ottieni un bonus di ${bonus} a Intelligenza.</p><br>` + (i
      ? `<i>TRATTO DI VELKARYA<br><br></i><p>${defense}</p><p>${spell}</p>`
      : `<i>TRATTO DI VELKARYA</i><p>${defense}<br><i><br></i>${spell}<i></i></p>`)};
  });
  levels[2].changeNotes = [notes];
  const n = {id:'node-mrkweb9w', desc:levels[0].desc, levels, gradeTemplate:{mode:'individual'}};
  const original = copy(n);
  const model = ui.getSkillGradeModel(n);
  assert.deepEqual(copy(n), original);
  assert.deepEqual(copy(model.fields.map(field => field.values)), [
    ['+1','+3','+5'], ['+1','+3','+5'], ['5°','9°','13°'], Array(3).fill('resistenza')
  ]);
  const customized = copy(n);
  customized.levels[2].desc += '<p>Ottieni anche un incantesimo.</p>';
  assert.equal(ui.getSkillGradeModel(customized), null, 'A distinct authored effect keeps its individual text');
  model.fields[1].values[1] = '+4';
  ui.applySkillGradeModel(n, model);
  const saved = ui.normalizeSkillTreeDefinitionForSave({nodes:[n]}).nodes[0];
  const reopened = ui.getSkillGradeModel(saved);
  assert.equal(reopened.fields[0].values[1], '+3');
  assert.equal(reopened.fields[1].values[1], '+4');
  assert.equal(reopened.review.noteId, notes.id);
  assert.deepEqual(copy(saved.levels[2].changeNotes.find(e => e.id === notes.id)), notes);
  reopened.fields[3].values[2] = 'immunità';
  ui.applySkillGradeModel(saved, reopened);
  const resolved = ui.getSkillGradeModel(saved);
  assert.match(ui.skillGradeHtml(resolved, 2), /immunità ai danni da fulmine/);
  assert.deepEqual(copy(resolved.originalNotes[2]), [notes]);
});
test('two fields can change at different grades', () => {
  const n = {desc:'<p>3d6 danni. Il tiro annulla.</p>', levels:[{},
    {desc:'<p>5d6 danni. Il tiro annulla.</p>',changeNotes:[{label:'Danni',before:'3d6',after:'5d6'}]},
    {desc:'<p>5d6 danni. Il tiro dimezza.</p>',changeNotes:[{label:'Tiro salvezza',before:'annulla',after:'dimezza'}]}]};
  const model = ui.getSkillGradeModel(n);
  assert.deepEqual(copy(model.fields.map(f=>f.values)), [['3d6','5d6','5d6'],['annulla','annulla','dimezza']]);
  model.fields[0].values[0] = '<img>';
  assert.match(ui.skillGradeHtml(model,0), /&lt;img&gt;/);
});
test('legacy editorial states preserve player-visible nodes and their prerequisites', () => {
  const legacyTree = {nodes: [
    {id: 'start', editorStatus: 'draft', connections: ['next']},
    {id: 'next', workflowStatus: 'review', requires: ['start']}
  ]};
  const visible = ui.getSkillTreePlayerFacingDefinition(legacyTree);
  assert.deepEqual(copy(visible.nodes.map(node => node.id)), ['start', 'next']);
  assert.equal(visible.nodes[0].connections[0].target, 'next');
  assert.deepEqual(copy(visible.nodes[1].requires), ['start']);
});
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
