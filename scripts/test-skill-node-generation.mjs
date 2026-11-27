import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import worker, {AbilityGenerationStore} from '../workers/main-worker/src/index.js';
import {formatSkillNodeDescription, skillNodeAvatarReference} from '../assets/js/shared/skill-node-generator.mjs';
import {skillNodePreviewKey} from '../assets/js/shared/skill-node-preview-key.mjs';
import {treeReviewSteps} from '../assets/js/shared/skill-tree-review.mjs';

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
    list: async ({prefix, limit, startAfter = ''}) => new Map([...values.keys()].sort()
        .filter(key => key.startsWith(prefix) && key > startAfter).slice(0, limit).map(key => [key, structuredClone(values.get(key))])),
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
function call({body, account = 'dm', tree = 'valdor', campaign = 'cripta-di-sangue', path = '', item = '', dossierActor = '', query = {}} = {}) {
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    const data = Buffer.from(JSON.stringify({accountId: account, exp: Math.floor(Date.now() / 1000) + 60})).toString('base64url');
    const sig = createHmac('sha256', 'test').update(header + '.' + data).digest('base64url');
    const headers = account ? {Authorization: 'Bearer ' + [header, data, sig].join('.')} : {};
    if (body instanceof Blob) headers['Content-Type'] = body.type;
    const base = dossierActor ? '/api/managed-actors/world-a/' + dossierActor + '/dossier-ai' : item ? '/api/items/generate' : '/api/skill-trees/generate-node';
    return worker.fetch(new Request('https://local.test' + base + path + '?' + new URLSearchParams({campaign, tree, item, ...query}),
        {headers, ...(body ? {method: 'POST', body: body instanceof Blob ? body : JSON.stringify(body)} : {})}), env, {});
}
const proposal = {name: 'Eco tonante', description: 'Infliggi 1d6 danni da tuono.', questions: ['Qual è la CD?']};
const nodeProposal = {...proposal, flavor: 'Il tuono ritorna sui suoi passi.'};
const notes = {mode: 'text', notes: '1d6 tuono, TS, CD da decidere', requestId: randomUUID(),
    examples: [{name: 'Carica tonante', description: 'Spendi una carica.', flavor: 'Il cielo trattiene il fiato.'}]};
const image = {mode: 'icon', name: 'Nome rivisto', description: 'Descrizione rivista', direction: 'Una runa blu', requestId: randomUUID()};
const revision = {mode: 'refine', source: {name: 'Rintocco', description: '1d6 danni da tuono, come reazione.'},
    notes: 'Metti prima l’attivazione.', examples: [], requestId: randomUUID()};
const bytes = Buffer.alloc(30); bytes.write('RIFF'); bytes.write('WEBPVP8X', 8);
bytes.writeUInt32LE(22, 4); bytes.writeUInt32LE(10, 16);
bytes.writeUIntLE(1023, 24, 3); bytes.writeUIntLE(1023, 27, 3);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body); requests.push(payload);
    if (url.endsWith('/images/generations') || url.endsWith('/images/edits')) {
        assert.equal(payload.quality, 'high');
        if (url.endsWith('/edits')) {
            assert.ok(payload.images.length > 0);
            assert.ok(payload.prompt.includes('Reference image 1') || JSON.parse(payload.prompt.split('\n').at(-1)).optionalReferenceImages?.[0]?.image === 1);
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
        assert.ok(!Object.hasOwn(payload.text.format.schema.properties, 'flavor'));
    } else {
        assert.deepEqual(input, {appunti: notes.notes, esempi: notes.examples});
        assert.ok(payload.text.format.schema.required.includes('flavor'));
    }
    return Response.json({status: 'completed', output: [{content: [{type: 'output_text', text: JSON.stringify(input.livello ? proposal : nodeProposal)}]}]});
};
try {
    assert.equal((await call({body: notes, account: ''})).status, 401);
    assert.equal((await call({body: notes, account: 'player'})).status, 403);
    assert.equal((await call({body: notes, campaign: 'mago-folle'})).status, 403);
    assert.equal((await call({body: {...notes, examples: Array(6).fill(notes.examples[0])}})).status, 400);
    assert.equal((await call({body: {...notes, examples: [{...notes.examples[0], flavor: 'x'.repeat(1001)}]}})).status, 400);
    assert.equal((await call({body: notes})).status, 202);
    assert.equal((await call({body: image})).status, 409);
    const textPath = '/' + notes.requestId;
    await coordinator.alarm();
    assert.deepEqual((await (await call({path: textPath})).json()).job.draft, nodeProposal);
    assert.equal((await call({path: textPath, account: 'admin'})).status, 404);
    assert.equal((await call({path: textPath, tree: 'randra'})).status, 404);
    assert.equal((await call({body: notes})).status, 200);
    await coordinator.alarm(); assert.equal(requests.length, 1);
    assert.equal((await call({body: image})).status, 202);
    await coordinator.alarm();
    const iconPath = '/' + image.requestId;
    const interrupted = {...image, requestId: randomUUID()};
    const stopPath = '/' + interrupted.requestId + '/stop';
    const attemptsBeforeStop = requests.length;
    assert.equal((await call({body: interrupted})).status, 202);
    assert.equal((await call({path: stopPath})).status, 405);
    assert.equal((await call({path: stopPath, body: {}, account: 'player'})).status, 403);
    assert.equal((await call({path: stopPath, body: {}, account: 'admin'})).status, 404);
    assert.equal((await call({path: stopPath, body: {}, tree: 'other'})).status, 404);
    assert.equal(await storage.get('active'), interrupted.requestId);
    const stopped = await (await call({path: stopPath, body: {}})).json();
    assert.equal(stopped.job.id, interrupted.requestId);
    assert.match(stopped.job.iconError, /Attesa interrotta/);
    assert.equal(await storage.get('active'), undefined);
    assert.equal((await call({path: stopPath, body: {}})).status, 200);
    await coordinator.alarm();
    assert.equal(requests.length, attemptsBeforeStop, 'Stopping a queued icon never starts a provider request');
    assert.equal((await (await call({path: iconPath + '/stop', body: {}})).json()).job.iconId, image.requestId, 'Stop preserves an already finished preview');
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
    const slot = await skillNodePreviewKey(['node-1', 0, 'icon']);
    const otherLevel = await skillNodePreviewKey(['node-1', 1, 'icon']);
    const latestIcon = async (query, options) => {
        let result;
        do { result = await (await call({query, ...options})).json(); } while (result.scanning);
        return result.preview;
    };
    const legacyJob = await storage.get('job:' + image.requestId);
    const legacyId = randomUUID();
    await storage.put('job:' + legacyId, {...legacyJob, id:legacyId, iconId:legacyId, context:{...legacyJob.context, tree:'archivio'}});
    const legacyKey = await skillNodePreviewKey([image.name, image.description]);
    assert.equal((await latestIcon({previewSlot:slot, legacy:legacyKey}, {tree:'archivio'})).id, legacyId);
    const archived = await latestIcon({previewSlot:slot, legacy:'tree'}, {tree:'archivio'});
    assert.equal(archived.id, legacyId);
    assert.equal(archived.description, image.description);
    assert.equal(await latestIcon({previewSlot:slot, legacy:otherLevel}, {tree:'archivio'}), null);
    const scoped = {...image, requestId:randomUUID(), previewSlot:slot, flavor:nodeProposal.flavor};
    assert.equal((await call({body:scoped})).status, 202);
    await coordinator.alarm();
    const afterIcon = requests.length;
    assert.equal((await latestIcon({previewSlot:slot})).id, scoped.requestId);
    assert.equal((await latestIcon({previewSlot:slot, legacy:'tree'})).flavor, nodeProposal.flavor);
    assert.equal(await latestIcon({previewSlot:otherLevel}), null);
    assert.equal(await latestIcon({previewSlot:slot}, {account:'admin'}), null);
    assert.equal(await latestIcon({previewSlot:slot}, {tree:'altro'}), null);
    const query = {icons:slot + ',' + otherLevel + '.' + legacyKey};
    const batch = (await (await call({query})).json()).previews;
    assert.equal(batch[slot].id, scoped.requestId);
    assert.ok(batch[otherLevel]?.id && batch[otherLevel].id !== scoped.requestId);
    assert.deepEqual((await (await call({query, account:'admin'})).json()).previews, {});
    assert.equal((await call({query:{icons:slot + '.tree'}})).status, 400);
    assert.equal((await call({query:{icons:Array(33).fill(slot).join(',')}})).status, 400);
    const abandoned = {...scoped, requestId:randomUUID()};
    assert.equal((await call({body:abandoned})).status, 202);
    assert.equal((await call({path:'/' + abandoned.requestId + '/stop', body:{}})).status, 200);
    assert.equal((await latestIcon({previewSlot:slot})).id, scoped.requestId);
    assert.equal(requests.length, afterIcon, 'Reopening and recovering previews never starts a paid request');
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
    const runningIcon = {...image, requestId: randomUUID()}, nextIcon = {...image, requestId: randomUUID()};
    const providerStarted = Promise.withResolvers(), finishProvider = Promise.withResolvers();
    const mockProvider = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        providerStarted.resolve(init.signal);
        await finishProvider.promise;
        return mockProvider(url, init);
    };
    assert.equal((await call({body: runningIcon})).status, 202);
    const runningAlarm = coordinator.alarm(), signal = await providerStarted.promise;
    assert.equal((await call({path: '/' + runningIcon.requestId + '/stop', body: {}})).status, 200);
    assert.equal(signal.aborted, true);
    assert.equal((await call({body: nextIcon})).status, 202, 'The editor can generate another icon immediately');
    finishProvider.resolve(); await runningAlarm;
    assert.equal(await storage.get('active'), nextIcon.requestId, 'A late response cannot release the next generation');
    await coordinator.alarm();
    assert.equal((await (await call({path: '/' + nextIcon.requestId})).json()).job.iconId, nextIcon.requestId);
    const tree = {name:'Guardiano', nodes:Array.from({length:18}, (_, i) => ({id:String(i), name:'Nodo ' + i,
        connections:i ? [] : [{target:'17',mode:'exclusive'}], levels:[{key:'n' + i, description:'Una regola. '.repeat(700)}]}))};
    tree.nodes[0].template = {text:'Ottieni ⟦0⟧ cariche.', variables:[{marker:'⟦0⟧', values:['1','3','5']}]};
    const entries = tree.nodes.map(n => ({key:n.levels[0].key, original:n.template?.text || n.levels[0].description, generateIcon:true}));
    const steps = treeReviewSteps(entries, true, true);
    assert.ok(steps.filter(s => s.kind === 'review').length > 1);
    assert.equal(steps.filter(s => s.kind === 'icon').length, entries.length);
    assert.deepEqual(steps.flatMap(s => s.targets || []).map(t => t.key), entries.map(e => e.key));
    const review = {mode:'tree-review', requestId:randomUUID(), tree, targets:steps[0].targets, direction:'Richiama il tuono'};
    let breakMarker = false, reviewCalls = 0;
    globalThis.fetch = async (_url, init) => {
        reviewCalls++;
        const input = JSON.parse(JSON.parse(init.body).input);
        if (review.referenceNotes) assert.deepEqual(input.optionalImageNotesForRelevantIconsOnly, review.referenceNotes);
        assert.deepEqual(input.tree, tree, 'Each portion sees the entire tree, including the last node and exclusive links');
        const proposals = input.targets.map(t => ({key:t.key, description:t.key === 'n0' && !breakMarker ? 'Recuperi ⟦0⟧ cariche.' : 'Testo rivisto.', visual:'Un martello di tuono'}));
        return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({proposals, visualStyle:'Ambra e ferro sotto una luce temporalesca.'})}]}]});
    };
    assert.equal((await call({body:review, account:'player'})).status, 403);
    assert.equal((await call({body:{...review, targets:[{key:'ignoto',text:true,icon:false}]}})).status, 400);
    assert.equal((await call({body:review})).status, 202);
    assert.ok((await storage.get('job:' + review.requestId)).parts > 1);
    await coordinator.alarm();
    const plan = (await (await call({path:'/' + review.requestId})).json()).job;
    assert.equal(plan.status, 'ready', plan.error);
    assert.equal(plan.draft.proposals[0].description, 'Recuperi ⟦0⟧ cariche.');
    assert.equal(plan.draft.visualStyle, 'Ambra e ferro sotto una luce temporalesca.');
    assert.equal((await call({body:review})).status, 200); assert.equal(reviewCalls, 1);
    assert.equal((await call({path:'/' + review.requestId, tree:'other'})).status, 404);
    review.mode = 'tree-review-references'; review.referenceNotes = ['Stemma da usare nelle capacità del guardiano']; review.requestId = randomUUID();
    assert.equal((await call({body:review})).status,202); await coordinator.alarm();
    assert.equal((await (await call({path:'/'+review.requestId})).json()).job.status,'ready');
    breakMarker = true; review.requestId = randomUUID();
    assert.equal((await call({body:review})).status, 202); await coordinator.alarm();
    const invalid = (await (await call({path:'/' + review.requestId})).json()).job;
    assert.equal(invalid.status,'uncertain'); assert.equal(invalid.draft, null);
    globalThis.fetch = mockProvider;
    const styled = {...image, requestId:randomUUID(), treeStyle:plan.draft.visualStyle};
    assert.equal((await call({body:styled})).status, 202); await coordinator.alarm();
    assert.equal(requests.at(-1).quality, 'high');
    assert.equal(JSON.parse(requests.at(-1).prompt.split('\n').at(-1)).ability.sharedArtDirectionForThisTree, styled.treeStyle);
    for (const useAvatar of [false,true]) {
        const refs = [{uploadId,note:'Il simbolo del tuono'}];
        const optional = {...styled,requestId:randomUUID(),mode:'icon-references',references:refs,...(useAvatar && {avatar:managed})};
        assert.equal((await call({body:optional,tree:'other'})).status,400);
        const result = await call({body:optional}); assert.equal(result.status,202,await result.clone().text());
        await coordinator.alarm();
        const edit = requests.at(-1), prompt = JSON.parse(edit.prompt.split('\n').at(-1));
        assert.equal(edit.images.length,useAvatar ? 2 : 1);
        assert.deepEqual(prompt.optionalReferenceImages,[{image:useAvatar ? 2 : 1,note:refs[0].note}]);
        assert.equal(edit.images.at(-1).image_url,'data:image/webp;base64,'+bytes.toString('base64'));
        assert.match(edit.prompt,/including none/);
    }
    const catalog = {item:'anello'};
    const postItem = body => call({...catalog, body});
    const rewriteItem = {...revision, requestId:randomUUID()};
    assert.equal((await call({...catalog, account:'player', body:rewriteItem})).status, 403);
    assert.equal((await postItem(notes)).status, 400);
    globalThis.fetch = async (url, init) => {
        const payload = JSON.parse(init.body);
        requests.push(payload);
        if (url.endsWith('/responses')) {
            assert.match(payload.instructions, /oggetto.*dadi/s);
            return Response.json({status:'completed', output:[{content:[{type:'output_text', text:JSON.stringify(proposal)}]}]});
        }
        assert.match(payload.prompt, /clean white background/);
        assert.match(payload.prompt, /translucent watercolor stain/);
        assert.equal(payload.background, 'opaque');
        assert.equal(payload.quality, 'medium');
        if (payload.images) {
            assert.ok(url.endsWith('/edits'));
            assert.equal(payload.images[0].image_url, 'data:image/webp;base64,' + bytes.toString('base64'));
            assert.match(payload.prompt, /main design source/);
        } else assert.ok(url.endsWith('/generations'));
        return Response.json({data:[{b64_json:bytes.toString('base64')}]});
    };
    assert.equal((await postItem(rewriteItem)).status, 202);
    await coordinator.alarm();
    const itemDraft = (await (await call({...catalog, path:'/'+rewriteItem.requestId})).json()).job.draft;
    assert.equal(itemDraft.description, proposal.description);
    const itemImage = {...image, requestId:randomUUID()};
    assert.equal((await postItem({...itemImage, concept:uploadId})).status, 400);
    const concept = await call({...catalog, path:'/concepts', body:new Blob([bytes], {type:'image/webp'})});
    assert.equal(concept.status, 200);
    const itemReferenceId = (await concept.json()).uploadId;
    const secondaryBytes = Buffer.from(bytes);
    secondaryBytes[20] = 1;
    const secondReference = await call({...catalog, path:'/concepts', body:new Blob([secondaryBytes], {type:'image/webp'})});
    const secondaryId = (await secondReference.json()).uploadId;
    for (const ref of [{concept:itemReferenceId}, {itemImage:itemReferenceId}, {itemImage:itemReferenceId, concept:secondaryId}, {}]) {
        const body = {...itemImage, requestId:randomUUID(), ...ref};
        assert.equal((await postItem(body)).status, 202);
        await coordinator.alarm();
        if (ref.concept === secondaryId) {
            assert.equal(requests.at(-1).images[1].image_url, 'data:image/webp;base64,' + secondaryBytes.toString('base64'));
            assert.match(requests.at(-1).prompt,/Image 2 is a secondary/);
        }
        const previewPath = '/' + body.requestId + '/preview';
        assert.equal((await call({path:previewPath, tree:catalog.item})).status, 404);
        assert.equal((await call({...catalog, item:'altro', path:previewPath})).status, 404);
        assert.deepEqual(Buffer.from(await (await call({...catalog, path:previewPath})).arrayBuffer()), bytes);
        assert.equal((await postItem(body)).status, 200);
    }
    const whole = {mode:'item-review', concept:itemReferenceId, requestId:randomUUID(), notes:'Voce solenne', appearance:'Cuciture viola', source:{
        name:'Anello dei Sogni', unidentifiedName:'Cerchio annerito', type:'Anello', rarity:'Leggendario', attunement:true,
        summary:'', unidentifiedDescription:'', notes:'Dono del fabbro',
        properties:[
            {name:'Eco', charges:'2', description:'Infligge **2d6** danni.', genial:true},
            {name:'Eco', charges:'Al tramonto', description:'Il sigillo segreto usa [[/r 1d4]].', negative:true, hidden:true},
            {name:'Freddo', charges:'', description:'', hidden:false}
        ]
    }};
    assert.equal((await call({body:whole})).status,400);
    assert.equal((await call({...catalog,account:'player',body:whole})).status,403);
    let faulty = false;
    const groupInputs = [];
    globalThis.fetch = async (url, init) => {
        assert.ok(url.endsWith('/responses'));
        const request = JSON.parse(init.body);
        const inputText = Array.isArray(request.input) ? request.input[0].content[0].text : request.input;
        const input = JSON.parse(inputText);
        if (input.audience === 'DM') assert.equal(typeof request.input, 'string');
        else assert.equal(request.input[0].content[1].image_url, 'data:image/webp;base64,' + bytes.toString('base64'));
        assert.equal(request.text.format.name,'catalog_item_review');
        assert.equal(input.aspettoVisibile,'Cuciture viola');
        groupInputs.push(input);
        if (input.audience === 'non identificato') {
            assert.doesNotMatch(inputText,/Sogni|Dono del fabbro|sigillo segreto|Infligge|Voce solenne|Leggendario|attunement/);
            assert.equal(input.context.unidentifiedName,'Cerchio annerito');
        } else if (input.audience === 'identificato') {
            assert.doesNotMatch(inputText,/sigillo segreto|tramonto/);
            assert.equal(input.targets.find(t=>t.key==='notes').text,'Dono del fabbro');
            assert.equal(input.context.attunement,true);
            assert.equal(input.context.rarity,'Leggendario');
            assert.deepEqual(input.context.properties.map(p=>p.key),['property-0','property-2']);
            assert.equal(input.context.properties[0].charges,'2');
        } else {
            assert.equal(input.audience,'DM');
            assert.equal(input.context.hidden[0].negative,true);
        }
        const edits = input.targets.map(({key,text})=>({key, text:text || (key==='summary'?'Un anello incantato.':key==='unidentifiedDescription'?'Si vedono cuciture viola.':'')}));
        if (faulty && input.audience==='identificato') edits[0].key=edits[1].key;
        return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({edits:edits.reverse()})}]}]});
    };
    assert.equal((await postItem(whole)).status,202);
    await coordinator.alarm();
    const wholeDraft = (await (await call({...catalog,path:'/'+whole.requestId})).json()).job;
    assert.equal(wholeDraft.status,'ready',wholeDraft.error);
    const fields = Object.fromEntries(wholeDraft.draft.edits.map(e=>[e.key,e.text]));
    assert.deepEqual(fields,{summary:'Un anello incantato.', unidentifiedDescription:'Si vedono cuciture viola.',notes:'Dono del fabbro',
        'property-0':'Infligge **2d6** danni.', 'property-1':'Il sigillo segreto usa [[/r 1d4]].','property-2':''});
    assert.equal((await postItem(whole)).status,200);
    await coordinator.alarm();
    assert.equal(groupInputs.length,3);
    assert.equal((await call({...catalog,account:'admin',path:'/'+whole.requestId})).status,404);
    faulty=true;
    const bad = {...whole,requestId:randomUUID()};
    assert.equal((await postItem(bad)).status,202);
    await coordinator.alarm();
    const badJob = (await (await call({...catalog,path:'/'+bad.requestId})).json()).job;
    assert.notEqual(badJob.status,'ready');
    assert.equal(badJob.draft,null);
    const plainItem = {...whole, concept:undefined, requestId:randomUUID(), source:{...whole.source, properties:[], notes:''}};
    const audiences = [];
    globalThis.fetch = async (url, init) => {
        const group = JSON.parse(JSON.parse(init.body).input);
        audiences.push(group.audience);
        const edits = group.targets.map(({key}) => ({key, text: key === 'notes' ? 'Una nota inventata.' : 'Un cerchio di ferro.'}));
        return Response.json({status:'completed', output:[{content:[{type:'output_text', text:JSON.stringify({edits})}]}]});
    };
    assert.equal((await postItem(plainItem)).status,202);
    await coordinator.alarm();
    const plainJob = (await (await call({...catalog,path:'/'+plainItem.requestId})).json()).job;
    assert.equal(plainJob.status,'ready',plainJob.error);
    assert.deepEqual(audiences.sort(),['identificato','non identificato']);
    assert.equal(plainJob.draft.edits.find(edit=>edit.key==='notes').text,'');
    assert.equal((await postItem({...whole, field:'notes', requestId:randomUUID()})).status,400);
    assert.equal((await call({item:'altro', body:{...whole, requestId:randomUUID()}})).status,400);
    for (const field of ['summary','unidentifiedDescription']) {
        const focused = {...whole, field, requestId:randomUUID()};
        let count = 0;
        globalThis.fetch = async (url, init) => {
            ++count;
            const [note, picture] = JSON.parse(init.body).input[0].content;
            const group = JSON.parse(note.text);
            const text = field === 'summary' ? 'Il cerchio infligge 2d6 danni.' : 'Un cerchio di ferro lavorato.';
            assert.deepEqual(group.targets,[{key:field,text:''}]);
            assert.doesNotMatch(note.text,/sigillo segreto/);
            assert.equal(picture.type,'input_image');
            assert.equal(picture.image_url,'data:image/webp;base64,'+bytes.toString('base64'));
            return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({edits:[{key:field,text}]})}]}]});
        };
        assert.equal((await postItem(focused)).status,202);
        await coordinator.alarm();
        const result = (await (await call({...catalog,path:'/'+focused.requestId})).json()).job;
        assert.equal(result.status,'ready',result.error);
        assert.equal(result.draft.edits.length,1);
        assert.equal(count,1);
    }
    const additions = [
        {name:'Infusione', charges:'1 volta per riposo breve', description:'Infondi la pergamena di energia necrotica o di fuoco. Infligge danni aggiuntivi del tipo scelto.', clarification:'Quanti danni aggiuntivi infligge e quanto dura?', hidden:false, genial:false, negative:false},
        {name:'Colpo di seguito', charges:'Azione bonus', description:'Se con la tua azione effettui un colpo senz’armi o un attacco che usa una caratteristica diversa da Forza e Destrezza, puoi usare la tua azione bonus per attaccare con quest’arma.', clarification:'', hidden:false, genial:false, negative:false}
    ];
    const creation = { ...whole, concept:undefined, propertyMode:'auto', notes:'Aggiungi un’infusione necrotica o di fuoco una volta per riposo breve. Poi vorrei un attacco bonus con l’arma dopo colpi senz’armi o attacchi con caratteristiche diverse da Forza e Destrezza.' };
    for (const scenario of [{}, {propertyMode:'add'}, {field:'property-1'}, {field:'property-0', mixed:true}, {propertyMode:'add', invalid:true}]) {
        const {mixed, invalid, ...options} = scenario;
        const body = {...creation, ...options, requestId:randomUUID()};
        let calls = 0;
        globalThis.fetch = async (_, init) => {
            ++calls;
            const {instructions, input, text} = JSON.parse(init.body), group = JSON.parse(input);
            assert.match(instructions,/effetto indipendente/);
            assert.equal(group.indicazioni, creation.notes);
            assert.ok(text.format.schema.required.includes('additions'));
            if (body.propertyMode === 'add') {
                assert.equal(text.format.schema.properties.additions.minItems, 1);
                assert.deepEqual(group.targets, []);
            }
            if (body.field === 'property-1') assert.equal(group.audience, 'DM');
            else assert.doesNotMatch(input, /sigillo segreto/);
            const edits = mixed ? group.targets.map(t => ({...t, text:t.text + ' Effetto rivisto.'})) : [];
            return Response.json({status:'completed', output:[{content:[{type:'output_text', text:JSON.stringify({
                intent: mixed ? 'add_and_revise' : 'add', additions:invalid ? [] : additions, edits
            })}]}]});
        };
        assert.equal((await postItem(body)).status,202);
        await coordinator.alarm();
        const result = (await (await call({...catalog, path:'/'+body.requestId})).json()).job;
        if (invalid) assert.equal(result.draft,null);
        else {
            assert.equal(result.status,'ready',result.error);
            assert.deepEqual(result.draft.additions, additions.map(p=>({...p,hidden: body.field === 'property-1'})));
            if (mixed) assert.deepEqual(result.draft.edits, [{key:'property-0',text:'Infligge **2d6** danni. Effetto rivisto.'}]);
            else { assert.equal(result.draft.appendOnly,true); assert.deepEqual(result.draft.edits,[]); }
            assert.equal((await postItem(body)).status,200);
            await coordinator.alarm();
        }
        assert.equal(calls,1);
    }
    for (const extra of [{field:'property-20'}, {field:'summary'}, {propertyMode:'add', notes:''}]) {
        assert.equal((await postItem({...creation,...extra,requestId:randomUUID()})).status,400);
    }
    console.log('Catalog additions: independent properties, add-only, mixed edits, hidden scope and idempotent recovery passed.');
    const dossier = options => call({dossierActor:'actor01',...options});
    const chapter = {requestId:randomUUID(),mode:'chapter',audience:'public',source:{title:'Custode',text:'Una guardia. %%furtivamente%%'},
        notes:'Protegge il ponte. Segreto DM: ha aperto il cancello.',ideas:true,
        examples:[{audience:'dm',title:'Colpa',text:'Il patto segreto'},{audience:'public',title:'Il ponte',text:'Pietra %%maledetta%%.'}]};
    const calls = [];
    const origins = 'Crebbe nei vicoli del porto.';
    const recent = 'Molti anni dopo incontrò il capitano.';
    globalThis.fetch = async (url,init) => {
        const payload = JSON.parse(init.body);
        calls.push(payload);
        if (url.includes('/images/')) {
            const wide = Buffer.from(bytes); wide.writeUIntLE(1535,24,3);
            return Response.json({data:[{b64_json:wide.toString('base64')}]});
        }
        const row = JSON.parse(payload.input);
        const result = {title:row.title || 'Il cancello',text:row.text || row.notes,visual:'Lo stemma spezzato',ideas:['Ricorda il ponte.']};
        const newChapters = row.notes === origins + ' ' + recent
            ? [{...result,title:'I vicoli del porto',text:origins,visual:'Il porto'}, {...result,title:'Il capitano',text:recent,visual:''}]
            : [result];
        const reply = row.original ? result : {chapters:newChapters};
        assert.equal(payload.text.format.name,row.original ? 'dossier_chapter' : 'dossier_chapters');
        return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(reply)}]}]});
    };
    assert.equal((await dossier({body:chapter,account:'player'})).status,403);
    assert.equal((await dossier({body:chapter})).status,202);
    await coordinator.alarm();
    const drafted = (await (await dossier({path:'/'+chapter.requestId})).json()).job;
    assert.equal(drafted.status,'ready',drafted.error);
    assert.equal(drafted.draft.chapters.length,2);
    assert.equal(drafted.draft.chapters[0].text,chapter.source.text);
    assert.equal(drafted.draft.chapters[1].audience,'dm');
    assert.doesNotMatch(calls[0].input,/furtivamente|maledetta|ha aperto|patto segreto/);
    assert.match(calls[1].input,/ha aperto/);
    assert.equal((await dossier({path:'/'+chapter.requestId,account:'admin'})).status,404);
    assert.equal((await dossier({body:chapter})).status,200);
    const art = {requestId:randomUUID(),mode:'illustration',title:'Custode',text:chapter.source.text,direction:'Stemmi sul ponte',useAvatar:true};
    assert.equal((await dossier({body:art})).status,202);
    await coordinator.alarm();
    assert.equal(calls.length,3);
    assert.equal(calls[2].size,'1536x1024');
    assert.equal(calls[2].images.length,1);
    assert.doesNotMatch(calls[2].prompt,/furtivamente|ha aperto|patto segreto/);
    assert.equal((await dossier({path:'/'+art.requestId+'/preview'})).status,200);
    actorRecords.set('campaign:'+campaign+':managed-actor:world-a:actor01',JSON.stringify({...profile,ownerAccountIds:['player']}));
    const ownerRequest = {mode:'chapter',audience:'public',notes:'Una guardia del ponte.',examples:[],requestId:randomUUID()};
    assert.equal((await dossier({body:ownerRequest,account:'player'})).status,202);
    assert.equal((await dossier({path:'/'+ownerRequest.requestId+'/stop',body:{},account:'player'})).status,200);
    assert.equal((await dossier({path:'/'+chapter.requestId,account:'player'})).status,404);
    assert.equal((await dossier({body:{...chapter,requestId:randomUUID()},account:'player'})).status,400);
    const mixedNotes = {mode:'chapter',audience:'public',notes:origins+' '+recent,secretNotes:'Il capitano è un impostore.',examples:[],requestId:randomUUID()};
    const beforeMixed = calls.length;
    assert.equal((await dossier({body:mixedNotes})).status,202);
    await coordinator.alarm();
    const mixedDraft = (await (await dossier({path:'/'+mixedNotes.requestId})).json()).job.draft;
    assert.deepEqual(mixedDraft.chapters.map(c=>[c.text,c.audience,c.original]),[
        [origins,'public',false], [recent,'public',false], [mixedNotes.secretNotes,'dm',false]
    ]);
    assert.equal(calls.length-beforeMixed,2);
    assert.doesNotMatch(calls[beforeMixed].input,/impostore/);
    assert.equal(mixedDraft.chapters[0].visual,'Il porto');
    assert.equal(mixedDraft.chapters[1].visual,'');
    console.log('Dossier: private and public prompts, inline secrets, preview, retry and avatar illustration passed.');
    console.log('Whole item revision: all fields, duplicate names, empty descriptions, private context, validation and idempotent recovery passed.');
    console.log('Catalog items: DM-only text, illustration, reference uploads, scoped preview and retries passed.');
    console.log('Skill node and whole-tree generation: access, scoped drafts, complete context, grade variables, private previews, stop and idempotent retries passed.');
} finally { globalThis.fetch = originalFetch; }
