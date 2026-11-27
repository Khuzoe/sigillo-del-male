import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const toolsSource = await readFile(new URL('../assets/js/shared/npc-ai-tools.js', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../assets/js/pages/managed-actor.js', import.meta.url), 'utf8');
const sandbox = { console, URL, structuredClone, window: {
    CriptaApp: { onPageReady() {}, utils: { resolveImageUrl: path => path } }, CriptaDiscordAuth: { getToken: () => 'test-session' },
    alert: message => assert.fail(message), fetch: () => assert.fail('Opening the tools must not start a generation')
} };
vm.runInNewContext(toolsSource, sandbox);
const { toolsFor, abilityChoices } = sandbox.window.CriptaNpcAiTools;
const actor = { name: 'Custode', actorType: 'npc', actorId: 'npc', worldId: 'world', permissions: { isEditor: true }, media: { avatar: { path: 'media/avatar.webp' } },
    definition: { items: [{ itemId: 'bite', type: 'feat', name: 'Mòrso' }, { itemId: 'shield', type: 'feat', name: 'Scudo arcano' }, { itemId: 'spell', type: 'spell', name: 'Invisibilità' }, { itemId: 'sword', type: 'weapon', name: 'Spada' }, { itemId: 'coin', type: 'loot', name: 'Moneta' }] } };
const all = (subject = actor, options) => toolsFor(subject, options).flatMap(group => group.tools);
assert.equal(all().length, 11);
assert.ok(all().every(tool => !tool.reason));
const playerTools = ['avatar', 'token', 'card', 'icons', 'translate-abilities'];
assert.deepEqual(Array.from(all({ ...actor, actorType: 'character' }), tool => tool.id), playerTools);
const player = { ...actor, actorType: 'character', permissions: { isOwner: true, canEdit: true, canEditStats: true } };
assert.deepEqual(Array.from(all(player), tool => tool.id), playerTools);
assert.deepEqual(Array.from(all({ ...player, actorType: 'player' }), tool => tool.id), playerTools);
assert.equal(all({ ...player, permissions: { canEditStats: true } }).length, 0, 'Public stats editing does not grant AI access');
assert.equal(all({ ...actor, permissions: { isOwner: true } }).length, 0);
for (const options of [{ unsaved: true }, { saving: true }]) assert.ok(all(actor, options).every(tool => tool.reason));
const pending = { ...actor, sync: { commands: [{ nativeSheetVersion: 1, status: 'pending' }] } };
assert.deepEqual(Array.from(all(pending).filter(tool => !tool.reason), tool => tool.id), ['avatar', 'token', 'card', 'poses', 'drop']);
assert.match(all({ ...actor, media: {} }).find(tool => tool.id === 'avatar').reason, /avatar/);
assert.match(all({ ...actor, media: {} }).find(tool => tool.id === 'token').reason, /avatar/);
assert.match(all({ ...actor, media: {} }).find(tool => tool.id === 'card').reason, /avatar/);
assert.equal(all({ ...actor, media: {} }).find(tool => tool.id === 'suggestions').reason, '', 'Saved analyses remain accessible without an avatar');
assert.deepEqual(Array.from(abilityChoices(actor, 'morso'), item => item.id), ['bite']);
assert.deepEqual(Array.from(abilityChoices(actor, 'incantesimo'), item => item.id), ['spell']);
assert.equal(abilityChoices(actor).length, 4, 'Loot is not offered as an ability');
assert.equal(abilityChoices(actor, 'scudo', ['shield'])[0].blocked, true);

vm.runInNewContext(pageSource.replace(/\}\)\(\);\s*$/, `
    globalThis.aiTest = { run: runManagedAiTool, open: openManagedAiTools,
        bar: renderManagedCommandBar,
        set(actor, { editing = false, dirty = false, saving = false } = {}) { currentDocument = actor; managedEditMode = editing; managedProfileDirty = dirty; managedSaveInProgress = saving; }
    };
})();`), sandbox);
const api = sandbox.aiTest, root = { isConnected: true, querySelector: () => null };
api.set(actor);
const barOptions = { abilities: {}, skills: {}, traits: {}, identityEntries: [], variants: [], effects: [], attackEntries: [], spellEntries: [], inventoryEntries: [], canEdit: true, actor };
for (const editMode of [false, true]) assert.match(api.bar({ ...barOptions, editMode }), /data-managed-ai-tools/, 'Tools are available in reading and editing mode');
assert.doesNotMatch(api.bar({ ...barOptions, canEdit: false }), /data-managed-ai-tools/);
assert.doesNotMatch(api.bar({ ...barOptions, actor: { ...actor, permissions: {} } }), /data-managed-ai-tools/);
const calls = [];
sandbox.window.CriptaNpcPoses = {open: options => calls.push({kind:'poses',options})};
for (const [name, kind] of [['CriptaAvatarGenerator', 'avatar'], ['CriptaTokenGenerator', 'token'], ['CriptaActorCard', 'card'], ['CriptaAbilityIcons', 'icons'], ['CriptaAbilityTranslations', 'translations'], ['CriptaAbilityGenerator', 'ability'], ['CriptaNpcSheetAi', 'sheet'], ['CriptaNpcSuggestions', 'suggestions'], ['CriptaDropGenerator', 'drop']]) {
    sandbox.window[name] = { open: options => { calls.push({ kind, options }); } };
}
for (const action of ['avatar', 'token', 'icons', 'create-ability', 'sheet', 'suggestions', 'drop', 'edit-ability']) await api.run(root, action, { id: 'bite' });
assert.deepEqual(calls.map(call => call.kind), ['avatar', 'token', 'icons', 'ability', 'sheet', 'suggestions', 'drop', 'ability']);
assert.ok(calls.every(call => call.options.actor === actor && call.options.token === 'test-session'));
assert.equal(calls.at(-1).options.targetItem.id, 'bite');
assert.equal(calls[0].options.referenceUrl, 'media/avatar.webp');
assert.equal(calls.find(call => call.kind === 'token').options.referenceUrl, 'media/avatar.webp');
await api.run(root, 'poses');
assert.equal(calls.at(-1).kind, 'poses');
assert.equal(calls.at(-1).options.actor, actor);
await calls.find(call => call.kind === 'suggestions').options.onDevelop('Una nuova idea');
assert.equal(calls.at(-1).options.initialDetails, 'Una nuova idea', 'Suggestions retain their transition into ability creation');
let before = calls.length;
api.set(actor, { editing: true, dirty: true });
await assert.rejects(api.run(root, 'avatar'), /Salva o annulla/);
api.set(pending);
await assert.rejects(api.run(root, 'icons'), /Foundry/);
api.set({ ...actor, sync: { commands: [{ kind: 'item.update', status: 'pending', target: { itemId: 'bite' } }] } });
await assert.rejects(api.run(root, 'edit-ability', { id: 'bite' }), /attesa/);
api.set({ ...actor, permissions: {} });
await assert.rejects(api.run(root, 'sheet'), /gestori/);
api.set({ ...actor, media: {} });
await assert.rejects(api.run(root, 'avatar'), /avatar/);
await assert.rejects(api.run(root, 'token'), /avatar/);
assert.equal(calls.length, before, 'Guards never open a generator or start a paid request');
api.set(actor);
let captured;
sandbox.window.CriptaNpcAiTools.open = options => { captured = options; };
api.open(root);
api.set({ ...actor, actorId: 'another-npc' });
assert.throws(() => captured.onAction('avatar'), /scheda è cambiata/, 'A stale tools dialog cannot target another NPC');
assert.equal(calls.length, before);
api.set(player);
assert.match(api.bar({ ...barOptions, actor: player }), /data-managed-ai-tools/);
for (const action of playerTools) await api.run(root, action);
assert.deepEqual(calls.slice(before).map(call => call.kind), ['avatar', 'token', 'card', 'icons', 'translations']);
for (const call of calls.slice(before, before + 2)) assert.equal(call.options.referenceUrl, player.media.avatar.path);
for (const action of ['poses', 'create-ability', 'edit-ability', 'sheet', 'suggestions', 'drop']) await assert.rejects(api.run(root, action, { id: 'bite' }), /riservato/);
assert.equal(calls.length, before + playerTools.length);
console.log('AI tools: NPC editor and PC owner catalogs, image references, controller guards and stale actor selection passed. No paid calls.');
