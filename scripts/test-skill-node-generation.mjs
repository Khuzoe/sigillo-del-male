import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import worker, {AbilityGenerationStore} from '../workers/main-worker/src/index.js';
import {formatSkillNodeDescription, skillNodeAvatarReference} from '../assets/js/shared/skill-node-generator.mjs';

const asParagraph = part => part.trim() ? '<p>' + part.trim().replaceAll('<', '&lt;') + '</p>' : '';
assert.equal(formatSkillNodeDescription('## Effetto base\nSpendi 1 carica.\n\n> Durante la forma\n> Infliggi 1d6.\n\n<fine>', asParagraph),
    '<h4>Effetto base</h4><p>Spendi 1 carica.</p><blockquote><p>Durante la forma\nInfliggi 1d6.</p></blockquote><p>&lt;fine></p>');

const values = new Map(), media = new Map(), requests = [];
const campaign = 'cripta-di-sangue', managed = {worldId: 'world-a', actorId: 'Actor01'};
const avatarKey = 'campaigns/' + campaign + '/players/valdor-avatar.webp';
const profile = {...managed, media: {avatar: {path: 'media/' + avatarKey}}};
const avatarBytes = Uint8Array.of(17, 23, 41);
const avatars = new Map([[avatarKey, {size: avatarBytes.length, etag: 'avatar-v1', arrayBuffer: async () => avatarBytes.buffer}]]);
const actorRecords = new Map([['campaign:' + campaign + ':managed-actor:world-a:actor01', JSON.stringify(profile)]]);
assert.deepEqual(skillNodeAvatarReference({managedActor: profile, avatar: 'ignored'}), managed);
assert.equal(skillNodeAvatarReference({managedActor: {...managed, media: {token: {path: 'media/token.webp'}}}, avatar: 'media/token.webp'}), null);
const legacy = skillNodeAvatarReference({images: {avatar: 'media/players/missing.webp', avatarFallback: 'media/players/valdor-avatar.webp?v=2'}});
assert.deepEqual(legacy.paths, ['media/players/missing.webp', 'media/players/valdor-avatar.webp?v=2']);
assert.equal(skillNodeAvatarReference({images: {token: 'media/players/token.webp'}}), null);
const storage = {
    get: async key => structuredClone(values.get(key)),
    put: async (key, value) => {
        for (const [k, v] of Object.entries(typeof key === 'string' ? {[key]: value} : key)) values.set(k, structuredClone(v));
    },
    delete: async key => values.delete(key), setAlarm: async () => {}, deleteAlarm: async () => {},
    transaction: async fn => fn(storage)
};
const env = {JWT_SECRET: 'test', OPENAI_API_KEY: 'mock', GLOBAL_ADMIN_ACCOUNT_IDS: 'admin',
    CAMPAIGN_EDITOR_ACCOUNT_IDS: 'cripta-di-sangue:dm', SIGILLO_KV: {get: async key => actorRecords.get(key) || null},
    MEDIA_BUCKET: {head: async key => avatars.get(key) || (media.has(key) ? {size: media.get(key).byteLength} : null),
        put: async (key, bytes) => media.set(key, bytes),
        get: async key => avatars.get(key) || (media.has(key) ? {body: media.get(key), size: media.get(key).byteLength, arrayBuffer: async () => media.get(key)} : null)}};
const coordinator = new AbilityGenerationStore({storage}, env);
env.ABILITY_GENERATOR = {idFromName: name => name, get: () => coordinator};
function call({body, account = 'dm', tree = 'valdor', campaign = 'cripta-di-sangue', path = ''} = {}) {
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    const data = Buffer.from(JSON.stringify({accountId: account, exp: Math.floor(Date.now() / 1000) + 60})).toString('base64url');
    const sig = createHmac('sha256', 'test').update(header + '.' + data).digest('base64url');
    const headers = account ? {Authorization: 'Bearer ' + [header, data, sig].join('.')} : {};
    if (body instanceof Blob) headers['Content-Type'] = body.type;
    return worker.fetch(new Request('https://local.test/api/skill-trees/generate-node' + path + '?' + new URLSearchParams({campaign, tree}),
        {headers, ...(body ? {method: 'POST', body: body instanceof Blob ? body : JSON.stringify(body)} : {})}), env, {});
}
const proposal = {name: 'Eco tonante', description: 'Infliggi 1d6 danni da tuono.', questions: ['Qual è la CD?']};
const notes = {mode: 'text', notes: '1d6 tuono, TS, CD da decidere', requestId: randomUUID(),
    examples: [{name: 'Carica tonante', description: 'Spendi una carica.'}]};
const image = {mode: 'icon', name: 'Nome rivisto', description: 'Descrizione rivista', direction: 'Una runa blu', requestId: randomUUID()};
const revision = {mode: 'refine', source: {name: 'Rintocco', description: '1d6 danni da tuono, come reazione.'},
    notes: 'Metti prima l’attivazione.', examples: notes.examples, requestId: randomUUID()};
const bytes = Buffer.alloc(30); bytes.write('RIFF'); bytes.write('WEBPVP8X', 8);
bytes.writeUInt32LE(22, 4); bytes.writeUInt32LE(10, 16);
bytes.writeUIntLE(1023, 24, 3); bytes.writeUIntLE(1023, 27, 3);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body); requests.push(payload);
    if (url.endsWith('/images/generations') || url.endsWith('/images/edits')) {
        if (url.endsWith('/edits')) {
            assert.ok(payload.images.length > 0);
            assert.ok(payload.prompt.includes('Reference image 1'));
        } else {
            assert.ok(!payload.images); assert.ok(!payload.prompt.includes('Reference image 1'));
        }
        for (const edited of [image.name, image.description, image.direction]) assert.ok(payload.prompt.includes(edited));
        return Response.json({data: [{b64_json: bytes.toString('base64')}]});
    }
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const input = JSON.parse(payload.input);
    if (input.livello) {
        assert.deepEqual(input, {livello: revision.source, indicazioni: revision.notes, esempi: revision.examples});
        assert.ok(payload.instructions.includes('Conserva il nome e tutte le meccaniche'));
    } else {
        assert.deepEqual(input, {appunti: notes.notes, esempi: notes.examples});
    }
    return Response.json({status: 'completed', output: [{content: [{type: 'output_text', text: JSON.stringify(proposal)}]}]});
};
try {
    assert.equal((await call({body: notes, account: ''})).status, 401);
    assert.equal((await call({body: notes, account: 'player'})).status, 403);
    assert.equal((await call({body: notes, campaign: 'mago-folle'})).status, 403);
    assert.equal((await call({body: {...notes, examples: Array(6).fill(notes.examples[0])}})).status, 400);
    assert.equal((await call({body: notes})).status, 202);
    assert.equal((await call({body: image})).status, 409);
    const textPath = '/' + notes.requestId;
    await coordinator.alarm();
    assert.deepEqual((await (await call({path: textPath})).json()).job.draft, proposal);
    assert.equal((await call({path: textPath, account: 'admin'})).status, 404);
    assert.equal((await call({path: textPath, tree: 'randra'})).status, 404);
    assert.equal((await call({body: notes})).status, 200);
    await coordinator.alarm(); assert.equal(requests.length, 1);
    assert.equal((await call({body: image})).status, 202);
    await coordinator.alarm();
    const iconPath = '/' + image.requestId;
    assert.equal((await (await call({path: iconPath})).json()).job.iconId, image.requestId);
    assert.equal((await call({path: iconPath + '/preview', account: 'player'})).status, 403);
    assert.equal((await call({path: iconPath + '/preview', tree: 'randra'})).status, 404);
    assert.deepEqual(Buffer.from(await (await call({path: iconPath + '/preview'})).arrayBuffer()), bytes);
    assert.deepEqual([...media.keys()], [`_private/ai-abilities/${image.requestId}/${image.requestId}.webp`]);
    assert.equal((await call({body: image})).status, 200);
    await coordinator.alarm(); assert.equal(requests.length, 2);
    assert.equal((await call({body: revision, account: 'player'})).status, 403);
    assert.equal((await call({body: {...revision, source: {name: 'Rintocco', description: ''}}})).status, 400);
    assert.equal((await call({body: revision})).status, 202);
    await coordinator.alarm();
    const revisionPath = '/' + revision.requestId;
    assert.deepEqual((await (await call({path: revisionPath})).json()).job.draft, {...proposal, name: revision.source.name});
    assert.equal((await call({path: revisionPath, tree: 'randra'})).status, 404);
    assert.equal((await call({body: revision})).status, 200);
    await coordinator.alarm(); assert.equal(requests.length, 3);
    assert.equal(media.size, 1, 'Rewriting existing text should not generate a new icon');
    const portraitJob = avatar => ({...image, requestId: randomUUID(), avatar});
    for (const avatar of [managed, legacy]) {
        const withAvatar = portraitJob(avatar);
        assert.equal((await call({body: withAvatar})).status, 202);
        await coordinator.alarm();
        assert.equal((await (await call({path: '/' + withAvatar.requestId})).json()).job.iconId, withAvatar.requestId);
        assert.deepEqual(requests.at(-1).images, [{image_url: 'data:image/webp;base64,' + Buffer.from(avatarBytes).toString('base64')}]);
        assert.match(requests.at(-1).prompt, /Reference image 1 supplies the character's palette/);
        const original = avatars.get(avatarKey);
        avatars.delete(avatarKey);
        assert.equal((await call({body: withAvatar})).status, 200, 'Recover the original job after its avatar disappears');
        avatars.set(avatarKey, original);
    }
    const changed = portraitJob(managed), original = avatars.get(avatarKey);
    assert.equal((await call({body: changed})).status, 202);
    avatars.set(avatarKey, {...original, etag: 'v2'});
    await coordinator.alarm();
    assert.ok((await (await call({path: '/' + changed.requestId})).json()).job.iconError);
    avatars.set(avatarKey, {...original, size: 12 * 1024 * 1024 + 1});
    assert.equal((await call({body: portraitJob(managed)})).status, 400);
    avatars.set(avatarKey, original);
    for (const avatar of [{...managed, worldId: 'missing'}, {paths: ['media/campaigns/other/players/valdor.webp']}, {paths: ['/private/avatar.webp']}]) {
        assert.equal((await call({body: portraitJob(avatar)})).status, 400);
    }
    assert.equal(requests.length, 5, 'Missing, changed and oversized avatars do not start another provider generation');
    const attachment = new Blob([bytes], {type: 'image/webp'});
    assert.equal((await call({path: '/concepts', body: attachment, account: 'player'})).status, 403);
    assert.equal((await call({path: '/concepts', body: new Blob(['invalid'], {type: 'image/png'})})).status, 400);
    const uploaded = await call({path: '/concepts', body: attachment});
    assert.equal(uploaded.status, 200);
    const {uploadId} = await uploaded.json();
    assert.deepEqual(Buffer.from(await (await call({path: '/concepts/' + uploadId})).arrayBuffer()), bytes);
    assert.equal((await call({path: '/concepts/' + uploadId, account: 'admin'})).status, 404);
    assert.equal((await call({path: '/concepts/' + uploadId, tree: 'other'})).status, 404);
    for (const withPortrait of [false, true]) {
        const conceptName = withPortrait ? 'Evocazione che si sacrifica per me' : 'Emblema del corvo';
        const body = {...image, requestId: randomUUID(), concept: uploadId, conceptName, ...(withPortrait ? {avatar: managed} : {})};
        assert.equal((await call({body, tree: 'other'})).status, 400);
        assert.equal((await call({body})).status, 202);
        await coordinator.alarm();
        assert.equal((await (await call({path: '/' + body.requestId})).json()).job.iconId, body.requestId);
        const payload = requests.at(-1);
        assert.deepEqual(payload.images.map(img => img.image_url), [
            'data:image/webp;base64,' + bytes.toString('base64'),
            ...(withPortrait ? ['data:image/webp;base64,' + Buffer.from(avatarBytes).toString('base64')] : [])
        ]);
        assert.equal(JSON.parse(payload.prompt.split('\n').at(-1)).ability.visualReferenceName, conceptName);
        assert.match(payload.prompt, /Reference image 1 is the user's visual reference/);
        assert.match(payload.prompt, /preserve the depicted species and recognizable identity/);
        assert.equal(payload.prompt.includes("Reference image 2 is the ability owner's avatar"), withPortrait);
    }
    console.log('Skill node generation: DM access, campaign/tree/account isolation, draft and clarification, edited icon source, private preview and idempotent retries passed.');
} finally { globalThis.fetch = originalFetch; }
