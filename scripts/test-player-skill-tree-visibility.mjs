import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../workers/main-worker/src/index.js';

const secret = 'player-tree-visibility-test';
const records = new Map();
const env = {
    JWT_SECRET: secret,
    DISCORD_BOT_TOKEN: '',
    SIGILLO_KV: {
        async get(key) { return records.get(key) ?? null; },
        async put(key, value) { records.set(key, String(value)); }
    }
};
function jwt(accountId, expired = false) {
    const unsigned = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ accountId, exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600) })).toString('base64url')
    ].join('.');
    return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
async function call(campaign, path, token = jwt('bob'), body) {
    const url = new URL(`https://worker.test/${path}`);
    url.searchParams.set('campaign', campaign);
    const response = await worker.fetch(new Request(url, {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    }), env);
    return { status: response.status, body: await response.json() };
}
const put = (campaign, key, value) => records.set(`campaign:${campaign}:${key}`, JSON.stringify(value));
let sample;
for (const campaign of ['cripta-di-sangue', 'mago-folle', 'oltre-il-velo']) {
    const characterId = `hero-${campaign}`;
    const actor = { worldId: 'world', actorId: 'hero', actorType: 'character', relationshipType: 'player',
        ownerCharacterId: characterId, ownerAccountIds: ['alice'], name: 'Hero', visibility: { state: 'owners' },
        definition: { secretStats: true }, runtime: { secretRuntime: true }, media: {} };
    const profile = { worldId: 'world', actorId: 'hero', name: 'Hero', media: {}, mediaSyncVersion: 1,
        visibility: { state: 'public' }, lifecycle: { state: 'active' }, role: 'Secret role',
        blocks: [{ id: 'public', text: 'Public story', visibility: 'public' }, { id: 'secret', text: 'Private story', visibility: 'dm' }] };
    const privateActor = { ...actor, actorId: 'private', ownerCharacterId: `private-${characterId}`, name: 'Private hero' };
    const privateProfile = { ...profile, actorId: 'private', name: privateActor.name, visibility: { state: 'dm' } };
    const npc = { ...actor, actorId: 'npc', actorType: 'npc', relationshipType: 'companion' };
    const archived = { ...actor, actorId: 'archived', name: 'Archived hero' };
    const archivedProfile = { ...profile, actorId: 'archived', name: archived.name, lifecycle: { state: 'archived' } };
    const pairs = [[actor, profile], [privateActor, privateProfile], [npc, { ...privateProfile, actorId: 'npc', name: npc.name }], [archived, archivedProfile]];
    for (const [entry, dossier] of pairs) {
        put(campaign, `managed-actor:world:${entry.actorId}`, entry);
        put(campaign, `managed-actor-profile:world:${entry.actorId}`, dossier);
    }
    put(campaign, 'managed-actors:index', { profileAccessVersion: 2, actorLinkIndexVersion: 1,
        data: pairs.map(([entry, dossier]) => ({ ...entry, profile: dossier })) });
    const tree = { id: `tree-${campaign}`, ownerCharacterId: characterId, nodes: [{ id: 'first' }] };
    const state = { id: `${campaign}-${tree.id}-${characterId}`, treeKey: tree.id, characterId,
        ownerAccountId: 'alice', unlocked: ['first'], levels: {}, scope: 'character', shared: false };
    put(campaign, 'data:characters:override', { data: [{ id: characterId, accountId: 'alice' }] });
    put(campaign, 'data:skill-trees:override', { version: 1, data: [tree] });
    put(campaign, 'data:skill-tree-states:override', { version: 1, data: [state] });

    const path = 'api/managed-actors/world/hero';
    assert.equal((await call(campaign, path)).status, 403, 'Another player cannot read private statistics');
    assert.equal((await call(campaign, path, jwt('alice'))).status, 200, 'The owner keeps statistics access');
    const result = await call(campaign, `${path}/profile`);
    assert.equal(result.status, 200);
    assert.equal(result.body.permissions.canReadSkillTrees, true);
    assert.equal(result.body.permissions.canEdit, false);
    assert.equal(result.body.skillTreeActor.ownerCharacterId, characterId);
    assert.equal(result.body.skillTreeActor.permissions.isOwner, false);
    assert.equal(result.body.skillTreeActor.ownerAccountIds, undefined);
    assert.equal(result.body.skillTreeActor.definition, undefined);
    assert.equal(result.body.skillTreeActor.runtime, undefined);
    assert.deepEqual(result.body.data.blocks.map(block => block.id), ['public']);
    assert.equal((await call(campaign, `${path}/profile`, '')).body.skillTreeActor, null, 'Guests receive no player-tree context');
    assert.equal((await call(campaign, `${path}/profile`, jwt('bob', true))).body.skillTreeActor, null, 'Expired sessions receive no player-tree context');

    const privateResult = await call(campaign, 'api/managed-actors/world/private/profile');
    assert.equal(privateResult.status, 200, 'Private dossiers do not block player trees');
    assert.equal(privateResult.body.permissions.canReadProfile, false);
    assert.equal(privateResult.body.permissions.canReadSkillTrees, true);
    assert.deepEqual(privateResult.body.data.blocks, []);
    assert.equal(privateResult.body.data.role, '');
    assert.equal(privateResult.body.data.merchant, undefined);
    assert.equal((await call(campaign, 'api/managed-actors/world/private/profile', '')).status, 403);
    assert.equal((await call(campaign, 'api/managed-actors/world/npc/profile')).status, 403, 'Companion dossiers retain their access rules');
    assert.equal((await call(campaign, 'api/managed-actors/world/archived/profile')).status, 403);
    const directory = (await call(campaign, 'api/managed-actors?view=directory')).body.data;
    assert.deepEqual(directory.map(entry => entry.actorId), ['hero', 'private']);
    assert.equal(directory[1].permissions.canReadStats, false);
    assert.equal(directory[1].permissions.canReadProfile, false);
    assert.equal(directory[1].permissions.canReadSkillTrees, true);
    assert.equal(directory[1].profile, null);

    for (const forged of [
        { ...state, unlocked: [] },
        { ...state, ownerAccountId: 'bob', unlocked: [] },
        { ...state, id: 'different-id', ownerAccountId: 'bob', unlocked: [] },
        { ...state, characterId: 'different-character', ownerAccountId: 'bob', unlocked: [] }
    ]) {
        const before = (await call(campaign, 'api/data/skill-tree-states')).body;
        await call(campaign, 'api/data/skill-tree-states', jwt('bob'), { expectedVersion: before.version, data: [forged] });
        assert.deepEqual((await call(campaign, 'api/data/skill-tree-states')).body.data, [state], 'Reading another tree grants no progress writes');
    }
    const beforeOwnerSave = (await call(campaign, 'api/data/skill-tree-states')).body;
    const ownerSave = await call(campaign, 'api/data/skill-tree-states', jwt('alice'), {
        expectedVersion: beforeOwnerSave.version, data: [{ ...state, unlocked: [] }]
    });
    assert.equal(ownerSave.status, 200);
    const afterOwnerSave = (await call(campaign, 'api/data/skill-tree-states')).body;
    assert.deepEqual(afterOwnerSave.data[0].unlocked, [], 'Owners keep progress editing');
    await call(campaign, 'api/data/skill-tree-states', jwt('alice'), { expectedVersion: afterOwnerSave.version, data: [state] });
    sample = { campaign, actor: result.body.skillTreeActor, profile: result.body.data, tree, state };
}

// Exercise the profile renderer and its real extension loader together. Layout
// helpers are unrelated to visibility and use a minimal DOM in this harness.
const clone = value => JSON.parse(JSON.stringify(value));
const element = () => ({ isConnected: true, children: [], dataset: {}, innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} }, before() {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); }, querySelector() { return null; } });
const host = element(), panel = element(), hero = element(), nav = element();
const root = { ...element(), querySelector(selector) {
    return selector === '.managed-profile-panel' ? panel : selector === '.managed-actor-hero' ? hero
        : selector === '[data-managed-player-skill-trees]' ? host : null;
} };
let rendered;
const sandbox = { console, structuredClone, URL, URLSearchParams,
    document: { createElement: element, querySelector: () => nav },
    window: { location: { href: 'https://wiki.test/pages/characters/managed-actor.html', search: '?character=forged' },
        localStorage: { getItem() { return null; } },
        CriptaDiscordAuth: { getToken: () => jwt('bob'), verify: async () => ({ user: { accountId: 'bob' } }), isCurrentUserDm: async () => false },
        CriptaApp: { onPageReady() {}, campaigns: { currentId: () => sample.campaign }, urls: { api: path => path },
            api: { get: async path => (await call(sample.campaign, path)).body } }
    }
};
const treeSource = await readFile(new URL('../assets/js/shared/character-skill-tree.js', import.meta.url), 'utf8');
vm.runInNewContext(treeSource.replace(/\}\)\(\);\s*$/, `globalThis.treeApi = {applySkillTreeRuntime,
    resolvePlayerSkillTreeEntries, getCharacterSkillTreeState, canEditSkillTreeUnlocks, canManagePersonalSkillTrees,
    canManageSkillTreeDefinition}; })();`), sandbox);
assert.equal(sandbox.window.CriptaCharacterSkillTree.buildCards({ id: 'hero' }, { tree: sample.tree }), null, 'Guests cannot render player trees');
sandbox.window.CriptaCharacterSkillTree = { buildCards(character, trees, context) {
    sandbox.treeApi.applySkillTreeRuntime(context);
    rendered = { character, entries: sandbox.treeApi.resolvePlayerSkillTreeEntries(character, trees),
        state: sandbox.treeApi.getCharacterSkillTreeState(character, sample.tree.id, sample.tree) };
    assert.equal(sandbox.treeApi.canEditSkillTreeUnlocks(character), false);
    assert.equal(sandbox.treeApi.canManagePersonalSkillTrees(character), false);
    assert.equal(sandbox.treeApi.canManageSkillTreeDefinition(character, sample.tree), false);
    return element();
} };
vm.runInNewContext(await readFile(new URL('../assets/js/shared/skill-tree-sheet.js', import.meta.url), 'utf8'), sandbox);
vm.runInNewContext(await readFile(new URL('../assets/js/shared/managed-player-extensions.js', import.meta.url), 'utf8'), sandbox);
const mounts = [];
const mount = sandbox.window.CriptaManagedPlayerExtensions.mount;
sandbox.window.CriptaManagedPlayerExtensions = { mount(...args) { const pending = mount(...args); mounts.push(pending); return pending; } };
const pageSource = await readFile(new URL('../assets/js/pages/managed-actor.js', import.meta.url), 'utf8');
vm.runInNewContext(pageSource.replace(/\}\)\(\);\s*$/, `
    setupManagedNpcDossierLayout = setupManagedImageLightbox = setupManagedAvatarFallback =
        setupManagedSectionNavigation = setupManagedStickyLayout = () => {};
    renderManagedProfileSection = () => '<section class="managed-profile-panel"></section>';
    renderManagedAvatarArtwork = renderManagedImageLightbox = () => '';
    globalThis.renderProfile = renderManagedProfileOnly; })();`), sandbox);
sandbox.renderProfile(root, sample.profile, sample.actor);
await Promise.all(mounts);
assert.match(root.innerHTML, /href="#managed-player-skill-trees"/);
assert.match(root.innerHTML, /Torna ai giocatori/);
assert.equal(host.children[0].id, 'managed-player-skill-trees', 'The profile-only page mounts its tree section');
assert.equal(rendered.character.id, sample.actor.ownerCharacterId, 'The server identity wins over the character URL parameter');
assert.deepEqual(clone(rendered.entries.map(entry => entry.key)), [sample.tree.id]);
assert.deepEqual(clone(rendered.state.unlocked), ['first'], 'Other players see the owner progress');
sandbox.renderProfile(root, sample.profile);
assert.equal(mounts.length, 1, 'Anonymous and NPC profiles do not mount player trees');
assert.doesNotMatch(root.innerHTML, /data-managed-player-skill-trees/);
console.log('Player tree visibility: authenticated readers, private dossiers, campaign isolation, progress permissions and profile rendering passed.');
