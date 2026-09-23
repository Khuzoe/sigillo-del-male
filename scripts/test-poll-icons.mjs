import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../workers/main-worker/src/index.js';

const store = new Map();
const images = new Map();
const env = {
    JWT_SECRET: 'poll-icons-test-secret', GLOBAL_ADMIN_ACCOUNT_IDS: 'admin',
    GLOBAL_ADMIN_DEVICE_CODE: 'ADMIN-POLL-ICON-TEST-CODE',
    DEVICE_LOGIN_CODES_SECRET: 'PLAYER-POLL-TEST||player|Player;DM-POLL-TEST||dm|DM',
    CAMPAIGN_EDITOR_ACCOUNT_IDS: 'mago-folle:dm',
    SIGILLO_KV: { get: async (key) => store.get(key) ?? null, put: async (key, value) => store.set(key, value) },
    MEDIA_BUCKET: {
        head: async (key) => images.has(key) ? { size: images.get(key).byteLength, httpEtag: 'test' } : null,
        put: async (key, value) => images.set(key, value)
    }
};
async function call(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    }), env, {});
    return { status: response.status, data: await response.json() };
}
async function login(code) {
    const response = await call('/auth/device/login', { body: { code } });
    assert.equal(response.status, 200);
    return response.data.token;
}
const admin = await login('ADMIN-POLL-ICON-TEST-CODE');
const player = await login('PLAYER-POLL-TEST');
const dm = await login('DM-POLL-TEST');
const route = '/api/poll-icons?campaign=mago-folle';
const empty = await call(route);
assert.deepEqual(empty.data.voteIcons, {});
assert.equal(empty.data.version, '');
const iconPath = 'media/campaigns/mago-folle/poll-icons/yes-test.webp';
const change = { playerId: 'lila', state: 'yes', path: iconPath };
const patch = { campaignId: 'mago-folle', version: '', changes: [change] };

for (const token of [undefined, player, dm]) {
    const denied = await call(route, { token, body: patch });
    assert.equal(denied.status, token ? 403 : 401, 'Only global admins may change poll icons');
}
assert.equal((await call(route, { token: admin, body: patch })).status, 400, 'Missing uploads cannot be referenced');

async function upload(token, campaignId = 'mago-folle') {
    const form = new FormData();
    form.set('campaignId', campaignId);
    form.set('folder', 'poll-icons');
    form.set('filename', 'yes-test.webp');
    form.set('file', new File([await readFile(new URL('../assets/img/ui/dm_yes.webp', import.meta.url))], 'yes.webp', { type: 'image/webp' }));
    const response = await worker.fetch(new Request('https://worker.test/media/upload', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
    }), env, {});
    return { status: response.status, data: await response.json() };
}
assert.equal((await upload(player)).status, 403);
assert.equal((await upload(dm)).status, 403, 'Even a campaign editor cannot overwrite poll icon assets');
assert.equal((await upload(admin)).data.path, iconPath);
const saved = await call(route, { token: admin, body: patch });
assert.equal(saved.status, 200);
assert.equal(saved.data.voteIcons.lila.yes, iconPath);
assert.ok(saved.data.version);
assert.equal((await call('/api/poll-icons?campaign=oltre-il-velo')).data.voteIcons.lila, undefined);
assert.equal((await call(route, { token: admin, body: patch })).status, 409, 'Stale drafts must not silently overwrite settings');

for (const invalid of [
    { ...change, path: 'https://external.test/icon.webp' },
    { ...change, path: 'media/campaigns/oltre-il-velo/poll-icons/yes-test.webp' },
    { ...change, path: 'media/campaigns/mago-folle/poll-icons/../yes-test.webp' },
    { ...change, path: 'media/campaigns/mago-folle/poll-icons/yes-test.webp?x=1' },
    { ...change, playerId: '__proto__' }, { ...change, playerId: 'constructor' },
    { ...change, state: 'other' }, { ...change, path: {} }
]) {
    assert.equal((await call(route, { token: admin, body: { ...patch, version: saved.data.version, changes: [invalid] } })).status, 400);
}
assert.equal((await call(route, { token: admin, body: { ...patch, campaignId: 'oltre-il-velo' } })).status, 400);
assert.equal((await call(route, { token: admin, body: { ...patch, changes: [change, change] } })).status, 400);

// A new session and later edits keep campaign-wide icons. Injecting icon settings in a poll save has no effect.
const session = { campaignId: 'mago-folle', number: 1, dmAccountId: 'dm', isScheduled: false, availabilityOptions: [{ id: 'mar-15-set-2030', label: 'Mar 15 Set', time: '20:30 - 23:30' }] };
for (const number of [1, 2]) {
    const created = await call('/api/session?campaign=mago-folle', { token: admin, body: { ...session, number } });
    assert.equal(created.status, 200);
    assert.equal(created.data.data.voteIconOverrides.lila.yes, iconPath);
    const current = await call('/api/session/current?campaign=mago-folle');
    assert.equal(current.data.voteIconOverrides.lila.yes, iconPath);
}
const edited = await call('/api/session?campaign=mago-folle', { token: dm, body: { ...session, number: 2, voteIcons: {}, voteIconOverrides: { lila: { yes: 'bad' } } } });
assert.equal(edited.status, 200);
assert.equal((await call(route)).data.voteIcons.lila.yes, iconPath);
assert.equal((await call('/api/session?campaign=mago-folle&number=1')).data.voteIconOverrides.lila.yes, iconPath);

// Restoring one state preserves customizations for the other states and never deletes an image.
const second = await call(route, { token: admin, body: { ...patch, version: saved.data.version, changes: [{ ...change, state: 'no' }] } });
const restored = await call(route, { token: admin, body: { ...patch, version: second.data.version, changes: [{ ...change, path: null }] } });
assert.deepEqual(restored.data.voteIcons.lila, { no: iconPath });
assert.ok(images.has(iconPath.slice(6)));
const resetAll = await call(route, { token: admin, body: { ...patch, version: restored.data.version, changes: [{ ...change, state: 'no', path: null }] } });
assert.deepEqual(resetAll.data.voteIcons, {});

// Compositions retain their source and placement, independently of the baked image.
assert.equal(resetAll.data.compositionVersion, 1);
const sourcePath = 'media/campaigns/mago-folle/poll-icons/source-test.webp';
images.set(sourcePath.slice(6), new Uint8Array([1, 2, 3]));
const composition = { version: 1, sourcePath, x: -23, y: 18, scale: 145 };
const composedChange = { ...change, composition };
const composed = await call(route, { token: admin, body: { ...patch, version: resetAll.data.version, changes: [composedChange] } });
assert.equal(composed.status, 200);
assert.deepEqual(composed.data.compositions.lila.yes, composition);
assert.equal(composed.data.voteIcons.lila.yes, iconPath);
assert.deepEqual((await call(route)).data.compositions.lila.yes, composition);
assert.deepEqual((await call('/api/session/current?campaign=mago-folle')).data.voteIconCompositions.lila.yes, composition);
assert.deepEqual((await call('/api/poll-icons?campaign=oltre-il-velo')).data.compositions, {});
for (const invalid of [
    { ...composition, sourcePath: 'https://external.test/portrait.webp' },
    { ...composition, sourcePath: sourcePath.replace('mago-folle', 'oltre-il-velo') },
    { ...composition, sourcePath: iconPath },
    { ...composition, sourcePath: 'media/campaigns/mago-folle/poll-icons/missing.webp' },
    { ...composition, x: 101 }, { ...composition, y: -101 }, { ...composition, scale: 301 },
    { ...composition, x: '0' }, { ...composition, scale: 0 }, { ...composition, version: 2 },
    { ...composition, arbitrary: true }, {}, null
]) {
    assert.equal((await call(route, { token: admin, body: { ...patch, version: composed.data.version, changes: [{ ...change, composition: invalid }] } })).status, 400);
}
assert.equal((await call(route, { token: dm, body: { ...patch, version: composed.data.version, changes: [composedChange] } })).status, 403);
assert.equal((await call(route, { token: admin, body: { ...patch, version: '', changes: [composedChange] } })).status, 409);
assert.deepEqual((await call(route)).data.compositions.lila.yes, composition, 'Rejected changes cannot damage the saved draft');
const defaultComposition = await call(route, { token: admin, body: { ...patch, version: composed.data.version,
    changes: [{ ...change, state: 'maybe', composition: { ...composition, sourcePath: null, x: 0, y: 0, scale: 100 } }] } });
assert.equal(defaultComposition.status, 200, 'Default portraits need no duplicate upload');
const legacyReplace = await call(route, { token: admin, body: { ...patch, version: defaultComposition.data.version, changes: [change] } });
assert.equal(legacyReplace.status, 200);
assert.equal(legacyReplace.data.compositions.lila.yes, undefined, 'Replacing a baked icon with a legacy upload removes stale composition metadata');
const resetComposed = await call(route, { token: admin, body: { ...patch, version: legacyReplace.data.version, changes: [{ ...change, state: 'maybe', path: null }] } });
assert.equal(resetComposed.data.compositions.lila, undefined);
assert.ok(images.has(sourcePath.slice(6)), 'Reset keeps the original image');

// Frontend merging preserves the existing theme, untouched states and legacy fallback icons.
const source = await readFile(new URL('../assets/js/shared/next-session.js', import.meta.url), 'utf8');
const window = { CriptaApp: { utils: { escapeHtml: String } } };
vm.runInNewContext(source.replace('window.CriptaNextSession = {', 'window.testIcons = { buildVoteIconSets, sanitizeNextSessionConfig, buildPollMarkup, authService, setCurrentVoteIconSets, buildVoteChoiceContent }; window.CriptaNextSession = {'), {
    window, document: { body: { classList: { contains: () => true } } }, URL, console
});
const defaults = { lila: { yes: 'local-yes.webp', maybe: 'local-maybe.webp', no: 'local-no.webp' } };
const sets = window.testIcons.buildVoteIconSets({ voteIcons: defaults, voteIconOverrides: { lila: { yes: iconPath } } });
assert.equal(sets.lila.yes, iconPath);
assert.equal(sets.lila.maybe, defaults.lila.maybe);
assert.equal(sets.lila.no, defaults.lila.no);
assert.equal(window.testIcons.buildVoteIconSets({ voteIcons: defaults }).lila.yes, defaults.lila.yes);
assert.equal(window.testIcons.buildVoteIconSets({ voteIconOverrides: { newplayer: { yes: iconPath } } }).newplayer.no, 'dm_no.webp');
const sanitized = window.testIcons.sanitizeNextSessionConfig({ voteIconOverrides: { lila: { yes: iconPath } }, voteIconsVersion: 'v1' });
assert.equal(sanitized.voteIconOverrides.lila.yes, iconPath);
assert.equal(sanitized.voteIconsVersion, 'v1');
assert.match(window.testIcons.buildPollMarkup(session, [], [], '', true, {}, true), /Personalizza icone/);
assert.doesNotMatch(window.testIcons.buildPollMarkup(session, [], [], '', true, {}, false), /Personalizza icone/);
assert.equal(typeof window.testIcons.authService.getCampaignAccess, 'function');
window.CriptaPollIconComposer = { markup: (options) => options };
window.location = { pathname: '/pages/sondaggio.html' };
window.testIcons.setCurrentVoteIconSets({ voteIconOverrides: { lila: { yes: iconPath } }, voteIconCompositions: { lila: { yes: composition } } });
assert.equal(window.testIcons.buildVoteChoiceContent('yes', 'lila').final, true, 'Baked icons must not receive a second frame');
assert.equal(window.testIcons.buildVoteChoiceContent('no', 'lila').final, false, 'Legacy images use the new base at display time');
window.testIcons.setCurrentVoteIconSets({});
assert.equal(window.testIcons.buildVoteChoiceContent('yes', 'lila').final, false, 'Changing campaign discards the previous composition state');
console.log('Poll icons: admin permissions, uploads, validation, campaign persistence, reset and frontend merging passed.');
