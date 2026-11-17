import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import worker, { AvatarGenerationStore } from '../workers/main-worker/src/index.js';
import { AVATAR_MODEL } from '../workers/main-worker/src/avatar-generation.js';
import { NPC_TOKEN_PROMPT, NPC_TOKEN_SIZES } from '../workers/main-worker/src/npc-token-prompt.js';

class Storage {
    values = new Map();
    async get(key) { return structuredClone(this.values.get(key)); }
    async put(key, value) { if (typeof key === 'object') { for (const [k, v] of Object.entries(key)) await this.put(k, v); } else this.values.set(key, structuredClone(value)); }
    async delete(key) { this.values.delete(key); }
    async setAlarm(value) { this.alarm = value; }
    async deleteAlarm() { this.alarm = null; }
    async transaction(fn) { const before = structuredClone(this.values); try { return await fn(this); } catch (error) { this.values = before; throw error; } }
}
function image(width, height = width, alpha = true) {
    const bytes = new Uint8Array(alpha ? 40 : 30), view = new DataView(bytes.buffer);
    bytes.set(Buffer.from('RIFF')); view.setUint32(4, bytes.length - 8, true); bytes.set(Buffer.from('WEBPVP8X'), 8); view.setUint32(16, 10, true);
    bytes[20] = alpha ? 0x10 : 0;
    for (const [offset, size] of [[24, width], [27, height]]) { bytes[offset] = (size - 1) & 255; bytes[offset + 1] = ((size - 1) >> 8) & 255; bytes[offset + 2] = (size - 1) >> 16; }
    if (alpha) { bytes.set(Buffer.from('ALPH'), 30); view.setUint32(34, 1, true); }
    return bytes;
}
const campaign = 'cripta-di-sangue', world = 'token-world', actorId = 'token-npc', base = `api/managed-actors/${world}/${actorId}`, generation = `${base}/token-generation`, avatarGeneration = `${base}/avatar-generation`;
const secret = 'local-token-test', storage = new Storage(), kv = new Map(), objects = new Map();
const avatarKey = `campaigns/${campaign}/managed-actors/${world}/${actorId}/base/avatar.webp`, oldTokenKey = `campaigns/${campaign}/managed-actors/${world}/${actorId}/base/token.webp`;
objects.set(avatarKey, image(1296, 2304, false)); objects.set(oldTokenKey, image(512));
const bucket = {
    async head(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length, etag: key } : null; },
    async get(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length, etag: key, httpEtag: `"${key}"`, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.slice().buffer, writeHttpMetadata: headers => headers.set('Content-Type', 'image/webp') } : null; },
    async put(key, body) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); },
    async delete() { assert.fail('Token generation never deletes existing artwork'); }
};
const env = { JWT_SECRET: secret, GLOBAL_ADMIN_ACCOUNT_IDS: 'admin', CAMPAIGN_EDITOR_ACCOUNT_IDS: `${campaign}:dm`, INVENTORY_SYNC_SECRET: secret, OPENAI_API_KEY: 'fake-no-live-calls', MEDIA_BUCKET: bucket,
    SIGILLO_KV: { async get(key) { return kv.get(key) ?? null; }, async put(key, value) { kv.set(key, value); }, async delete(key) { kv.delete(key); } } };
let coordinator = new AvatarGenerationStore({ storage }, env);
env.AVATAR_GENERATOR = { idFromName: name => name, get: () => ({ fetch: request => coordinator.fetch(request) }) };
const auth = account => {
    const content = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ accountId: account, username: account, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')].join('.');
    return `${content}.${createHmac('sha256', secret).update(content).digest('base64url')}`;
};
const sync = { 'X-Cripta-Inventory-Secret': secret, 'X-Khuzoe-Sync-Contract': '1', 'X-Khuzoe-Foundry-Generation': '14' };
async function call(path, body, account = 'dm', targetCampaign = campaign, headers = {}) {
    const response = await worker.fetch(new Request(`https://local.test/${path}?campaign=${targetCampaign}`, {
        headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: `Bearer ${auth(account)}` } : {}), ...headers },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
    }), env, { waitUntil(promise) { promise.catch(() => {}); } });
    return { status: response.status, body: response.headers.get('Content-Type')?.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()), headers: response.headers };
}
const actorInput = { name: 'Custode', actorType: 'npc', schemaVersion: 3, ownerAccountIds: ['player'], visibility: { state: 'public' },
    definition: { attributes: { hp: { max: 42 } }, items: [{ itemId: 'ability', name: 'Morso', type: 'feat' }] },
    media: { avatar: { path: `media/${avatarKey}`, revision: 1 }, token: { path: `media/${oldTokenKey}`, revision: 1 }, idle: { path: `media/${oldTokenKey}` }, variants: [{ id: 'variant', path: `media/${avatarKey}` }] },
    contract: { name: 'khuzoe-wiki-sync', version: 1, module: { id: 'cripta-wiki-sync', version: '0.11.12' }, foundry: { generation: 14 }, system: { id: 'dnd5e', version: '5.3.3' } }
};
assert.equal((await call(base, actorInput, null, campaign, sync)).status, 200);
assert.equal((await call(`${base}/profile`, { expectedRevision: 0, data: { visibility: { state: 'public' }, blocks: [{ id: 'story', type: 'lore', title: 'Storia', text: 'Dossier da conservare', visibility: 'public' }] } })).status, 200);
const readActor = async () => (await call(base)).body.data;
const original = await readActor(), actorKey = `campaign:${campaign}:managed-actor:${world}:${actorId}`;
const originalRecord = kv.get(actorKey), month = new Date().toISOString().slice(0, 7);
for (const [account, headers, expected] of [[null, {}, 401], ['player', {}, 403], [null, sync, 401]]) assert.equal((await call(generation, undefined, account, campaign, headers)).status, expected);
assert.equal((await call(generation, undefined, 'dm', 'mago-folle')).status, 403);
const capabilities = (await call(generation)).body;
assert.equal(capabilities.tokenGenerationVersion, 1); assert.deepEqual(capabilities.tokenSizes, NPC_TOKEN_SIZES); assert.equal(capabilities.style, NPC_TOKEN_PROMPT); assert.equal(capabilities.job, null);
const binding = env.AVATAR_GENERATOR;
try {
    let writes = 0;
    env.AVATAR_GENERATOR = { idFromName: name => name, get: () => ({ fetch: async request => {
        if (new URL(request.url).pathname !== '/latest') writes++;
        return Response.json({ ok: true, job: { id: 'old-avatar', status: 'ready' } });
    } }) };
    assert.equal((await call(generation)).status, 503);
    assert.equal((await call(generation, { requestId: randomUUID(), details: '' })).status, 503);
    assert.equal((await call(`${generation}/${randomUUID()}/preview`)).status, 503);
    assert.equal((await call(`${generation}/${randomUUID()}/confirm`, {})).status, 503);
    assert.equal(writes, 0, 'An old coordinator cannot confuse avatar and token jobs');
} finally { env.AVATAR_GENERATOR = binding; }
for (const options of [{ quality: 'max' }, { resolution: '4k' }, { details: 'x'.repeat(1501) }]) assert.equal((await call(generation, { requestId: randomUUID(), details: '', ...options })).status, 400);
const id = randomUUID(), input = { requestId: id, details: 'Cornice di pietra antica', quality: 'high', resolution: 'high' };
const duplicates = await Promise.all(Array.from({ length: 4 }, () => call(generation, input)));
assert.ok(duplicates.every(result => result.status === 200 || result.status === 202));
assert.equal(await storage.get(`usage:${month}`), 1);
assert.equal((await call(`${generation}/${id}/confirm`, {})).status, 409);
assert.equal((await call(avatarGeneration)).body.job, null);
assert.equal((await call(`${avatarGeneration}/${id}/preview`)).status, 404);
assert.equal((await call(avatarGeneration, { requestId: id, details: '' })).status, 404);
assert.deepEqual(await readActor(), original, 'Starting generation leaves the NPC intact');

const originalFetch = globalThis.fetch;
let calls = 0, mode = 'alpha', captured;
globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits'); calls++; captured = JSON.parse(options.body);
    const [width, height] = captured.size.split('x').map(Number);
    return Response.json({ data: [{ b64_json: Buffer.from(image(mode === 'wrong-size' ? 512 : width, mode === 'wrong-size' ? 512 : height, mode !== 'opaque')).toString('base64') }] });
};
try {
    await coordinator.alarm(); await coordinator.alarm();
    assert.equal(calls, 1); assert.equal(captured.model, AVATAR_MODEL); assert.equal(captured.n, 1); assert.equal(captured.size, '1536x1536'); assert.equal(captured.quality, 'high');
    assert.equal(captured.background, 'transparent'); assert.equal(captured.output_compression, 100); assert.equal(captured.output_format, 'webp');
    assert.ok(captured.prompt.startsWith(NPC_TOKEN_PROMPT)); assert.ok(captured.prompt.includes(input.details));
    assert.equal(captured.images[0].image_url, `data:image/webp;base64,${Buffer.from(objects.get(avatarKey)).toString('base64')}`);
    assert.equal((await call(generation)).body.job.mediaSlot, 'token');
    assert.equal((await call(generation)).body.job.status, 'ready');
    assert.equal((await call(`${generation}/${id}/preview`, undefined, 'player')).status, 403);
    assert.equal((await call(`media/_private/ai-tokens/${id}.webp`, undefined, null)).status, 400, 'Draft token bytes cannot be read through public media');
    assert.equal((await call(`${base.replace(actorId, 'other-npc')}/token-generation/${id}/preview`)).status, 404);
    assert.deepEqual((await call(`${generation}/${id}/preview`)).body, image(1536));
    const reportBefore = (await call(`${base}/profile`)).body.data;
    delete env.OPENAI_API_KEY;
    const confirmed = await call(`${generation}/${id}/confirm`, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body)); assert.equal(confirmed.body.avatar, undefined);
    const saved = await readActor(), descriptor = confirmed.body.token;
    assert.equal(saved.media.token.path, descriptor.path); assert.ok(descriptor.path.startsWith('media/campaigns/'));
    assert.deepEqual(saved.media.avatar, original.media.avatar); assert.deepEqual(saved.media.idle, original.media.idle); assert.deepEqual(saved.media.variants, original.media.variants);
    assert.deepEqual(saved.definition, original.definition); assert.deepEqual(saved.visibility, original.visibility); assert.deepEqual(saved.ownerAccountIds, original.ownerAccountIds);
    assert.ok(saved.site.tokenHistory.some(entry => entry.path === original.media.token.path));
    assert.deepEqual((await call(`${base}/profile`)).body.data.blocks, reportBefore.blocks);
    assert.deepEqual((await call(`${base}/profile`)).body.data.media, reportBefore.media, 'The public dossier keeps its avatar and dedicated list images');
    assert.deepEqual(objects.get(descriptor.path.slice('media/'.length)), image(1536), 'Confirmation preserves the exact provider bytes');
    const served = await call(descriptor.path, undefined, null);
    assert.equal(served.status, 200); assert.equal(served.headers.get('Content-Type'), 'image/webp'); assert.deepEqual(served.body, image(1536));
    const repeated = (await call(`${generation}/${id}/confirm`, {})).body;
    assert.equal(repeated.revision, confirmed.body.revision, 'Confirmation retries do not increment actor revisions');
    assert.equal(repeated.token.path, descriptor.path); assert.equal(repeated.token.revision, descriptor.revision);
    assert.equal(calls, 1);
    env.OPENAI_API_KEY = 'fake-no-live-calls';
    assert.equal((await call(base, { expectedRevision: saved.revision, site: {} })).status, 200);
    assert.ok((await readActor()).site.tokenHistory.some(entry => entry.path === original.media.token.path), 'Ordinary saves retain previous token artwork');

    const staleId = randomUUID(); await call(generation, { requestId: staleId, details: '' }); await coordinator.alarm();
    const beforeStale = kv.get(actorKey), changedAvatar = JSON.parse(beforeStale); changedAvatar.media.avatar.revision++;
    kv.set(actorKey, JSON.stringify(changedAvatar)); assert.equal((await call(`${generation}/${staleId}/confirm`, {})).status, 409);
    const changedToken = JSON.parse(beforeStale); changedToken.media.token.revision++;
    kv.set(actorKey, JSON.stringify(changedToken)); assert.equal((await call(`${generation}/${staleId}/confirm`, {})).status, 409);
    kv.set(actorKey, beforeStale);
    const changedStats = JSON.parse(beforeStale); changedStats.definition.attributes.hp.max = 73; kv.set(actorKey, JSON.stringify(changedStats));
    assert.equal((await call(`${generation}/${staleId}/confirm`, {})).status, 200, 'Unrelated stats edits do not invalidate a media-only preview');
    assert.equal((await readActor()).definition.attributes.hp.max, 73);

    for (const invalid of ['opaque', 'wrong-size']) {
        mode = invalid; const badId = randomUUID(), before = kv.get(actorKey);
        await call(generation, { requestId: badId, details: '' }); await coordinator.alarm();
        assert.equal((await call(generation)).body.job.status, 'uncertain');
        assert.equal((await call(`${generation}/${badId}/confirm`, {})).status, 409);
        assert.ok(!objects.has(`_private/ai-tokens/${badId}.webp`)); assert.equal(kv.get(actorKey), before);
        const count = calls; await coordinator.alarm(); assert.equal(calls, count, 'No paid retry after an invalid image');
    }
    mode = 'alpha';
    const largeId = randomUUID(); await call(generation, { requestId: largeId, details: '', resolution: '2k', quality: 'xhigh' }); await coordinator.alarm();
    assert.equal(captured.size, '2048x2048'); assert.equal(captured.quality, 'xhigh'); assert.equal((await call(generation)).body.job.status, 'ready');
    const stoppedId = randomUUID(), beforeStop = calls;
    await call(generation, { requestId: stoppedId, details: '' }); assert.equal((await call(`${generation}/${stoppedId}/stop`, {})).status, 200); await coordinator.alarm(); assert.equal(calls, beforeStop);
    const avatarId = randomUUID(); assert.equal((await call(avatarGeneration, { requestId: avatarId, details: '' })).status, 202);
    assert.equal((await call(generation, { requestId: randomUUID(), details: '' })).status, 409, 'Avatar and token share the global paid lock');
    await call(`${avatarGeneration}/${avatarId}/stop`, {});

    for (const alpha of [true, false]) {
        const recoveredId = randomUUID(); await call(generation, { requestId: recoveredId, details: '' });
        const interrupted = await storage.get(`job:${recoveredId}`); interrupted.status = 'running'; interrupted.deadlineAt = Date.now() - 1; await storage.put(`job:${recoveredId}`, interrupted);
        objects.set(`_private/ai-tokens/${recoveredId}.webp`, image(1536, 1536, alpha));
        coordinator = new AvatarGenerationStore({ storage }, env);
        const before = calls, recovered = (await call(generation)).body.job;
        assert.equal(recovered.status, alpha ? 'ready' : 'uncertain', 'Recovery accepts only a square token with an alpha channel');
        await coordinator.alarm(); assert.equal(calls, before, 'Recovery never repeats a paid request');
    }
    assert.ok(objects.has(avatarKey) && objects.has(oldTokenKey));
} finally { globalThis.fetch = originalFetch; }
assert.ok(originalRecord);
console.log('Token generation: authenticated real routes, avatar/token isolation, native alpha and dimensions, exact image bytes, shared profile/media save, previous-token retention, stale image protection, retries, stop and recovery passed. No paid calls or world writes.');
