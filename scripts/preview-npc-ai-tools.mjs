import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createServer } from 'node:http';

// Production page and controllers with a local, read-only API fixture.
const destination = resolve('output/npc-ai-tools-qa'), prefix = '/output/npc-ai-tools-qa';
const art = '/assets/img/creatures/bestiary/nino_olegna_npc.webp';
const actor = { actorId: 'custode', worldId: 'mondo-di-prova', campaignId: 'cripta-di-sangue', actorType: 'npc', name: 'Custode della Cripta', revision: 1,
    updatedAt: '2026-11-17T10:00:00Z', permissions: { isEditor: true, canEdit: true, canEditStats: true }, visibility: { state: 'dm' }, sync: { commands: [] },
    media: { avatar: { path: art }, token: { path: art } },
    definition: { prototypeToken: { actorLink: true }, attributes: { hp: { value: 85, max: 85 }, ac: { value: 17 }, prof: 3, movement: { walk: 30, units: 'ft' } },
        details: { cr: 5, type: 'non morto' }, abilities: { str: { value: 18, mod: 4 }, dex: { value: 14, mod: 2 }, con: { value: 16, mod: 3 }, int: { value: 12, mod: 1 }, wis: { value: 15, mod: 2 }, cha: { value: 14, mod: 2 } }, skills: { prc: { passive: 15, total: 5 } }, traits: {},
        items: [{ itemId: 'bite', type: 'feat', name: 'Morso necrotico', definition: { description: '<p>Il custode morde un bersaglio, infliggendo danni necrotici.</p>', activation: { type: 'action' } } },
            { itemId: 'shield', type: 'feat', name: 'Scudo arcano', definition: { description: '<p>Una barriera magica protegge il custode.</p>' } },
            { itemId: 'spell', type: 'spell', name: 'Invisibilità', definition: { description: '<p>Il custode diventa invisibile.</p>', level: 2 } }] }
};
function fixture(actor) {
    const nativeFetch = window.fetch.bind(window), base = `/api/managed-actors/${actor.worldId}/${actor.actorId}`;
    const player = actor.actorType === 'character';
    const toolsKey = `ability-ai-qa:${actor.actorId}`;
    let toolJobs = {}; try { toolJobs = JSON.parse(sessionStorage.getItem(toolsKey)) || {}; } catch {}
    const saveTools = () => sessionStorage.setItem(toolsKey, JSON.stringify(toolJobs));
    const tokenKey = 'npc-ai-tools-qa:token-state', tokenArt = '/assets/img/creatures/transp/avatar.webp';
    let tokenState;
    try { tokenState = JSON.parse(sessionStorage.getItem(tokenKey)); } catch {}
    tokenState ||= { job: null, receipt: null };
    if (tokenState.receipt) { actor.media.token = tokenState.receipt.token; actor.revision = tokenState.receipt.revision; }
    const saveToken = () => sessionStorage.setItem(tokenKey, JSON.stringify(tokenState));
    const idleArt = '/assets/img/creatures/transp/nino_olegna_transp.webp', hoverArt = '/assets/img/creatures/transp/nino_olegna_animation.webp';
    const poseKey = 'npc-ai-tools-qa:poses:' + actor.actorId;
    const poses = JSON.parse(sessionStorage.getItem(poseKey) || '{}');
    const savePoses = () => sessionStorage.setItem(poseKey, JSON.stringify(poses));
    const restoreIdle = async () => {
        if (poses.savedIdleUpload && !actor.media.idle.path.startsWith('blob:')) {
            const file = await (await caches.open('npc-poses-qa')).match('/pose-fixture/' + poses.savedIdleUpload);
            if (file) actor.media.idle = {path:URL.createObjectURL(await file.blob())};
        }
    };
    if (!player) {
        actor.media.idle = {path:poses.savedIdle || idleArt};
        if (poses.savedHover) actor.media.hover = {path:poses.savedHover};
        if (new URLSearchParams(location.search).has('pose')) {
            const observer = new MutationObserver(() => {
                const button = document.querySelector('[data-managed-ai-tools]');
                if (!button) return;
                observer.disconnect(); button.click(); document.querySelector('[data-ai-tool="poses"]')?.click();
            });
            observer.observe(document.documentElement, {childList:true, subtree:true});
        }
    }
    const analysisKey = 'npc-ai-tools-qa:discarded-analysis', analysisId = '11111111-1111-4111-8111-111111111111';
    const analysis = { id: analysisId, status: 'ready', createdAt: '2026-11-10T15:00:00Z', details: 'Mantieni il GS.', report: {
        summary: 'Analisi precedente del custode: rendere più riconoscibile il suo ruolo di guardiano.',
        visualObservations: ['L’armatura e il mantello richiamano un antico guardiano.'], strengths: ['Conservare la resistenza e il ruolo difensivo.'], adjustments: [],
        ideas: [{ name: 'Veglia della cripta', concept: 'Una capacità difensiva per proteggere un passaggio.', visualLink: 'Il mantello avvolge il guardiano.', sheetLink: 'Completa lo scudo arcano.', tradeoff: 'Richiede una reazione.', generatorPrompt: 'Crea una reazione difensiva per proteggere un passaggio.' }], uncertainties: []
    } };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (resource, options = {}) => {
        const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url, location.href), path = url.pathname;
        if (!player && (path === base || path === base + '/poses')) await restoreIdle();
        if (path === base + '/poses' || path.startsWith(base + '/poses/')) {
            const method = options.method || 'GET', action = path.split('/').pop();
            if (action === 'poses' && method === 'GET') return json({enabled:true, baseline:'fixture', canGenerateIdle:true, canUseIdle:true, currentIdle:actor.media.idle.path, currentHover:actor.media.hover?.path || '', job:poses.job});
            if (action === 'upload') {
                const id = crypto.randomUUID() + '.webp';
                await (await caches.open('npc-poses-qa')).put('/pose-fixture/' + id, new Response(options.body));
                return json({uploadId:id});
            }
            if (action === 'poses') {
                const input = JSON.parse(options.body), hover = input.action === 'hover', parent = input.parentJobId && poses.job;
                poses.job = {id:input.requestId, baseline:'fixture', phase:hover ? 'hover' : 'idle', status:'ready', hasIdle:true, hasHover:hover,
                    idleRevision:parent?.idleRevision || input.requestId, hoverRevision:hover ? input.requestId : '', usesCurrentIdle:hover && (!parent || parent.usesCurrentIdle), uploadId:input.uploadId || (parent ? parent.uploadId : hover && poses.savedIdleUpload), poseDirection:input.direction};
                savePoses(); return json({job:poses.job},202);
            }
            if (action === 'idle' && poses.job.uploadId) return (await caches.open('npc-poses-qa')).match('/pose-fixture/' + poses.job.uploadId);
            if (action === 'idle' || action === 'hover') return nativeFetch(action === 'idle' ? idleArt : hoverArt);
            if (action === 'confirm') {
                if (!poses.job.usesCurrentIdle) poses.savedIdleUpload = poses.job.uploadId;
                poses.job.status = 'accepted'; poses.savedHover = hoverArt; savePoses();
                const locationUrl = new URL(location.href); locationUrl.searchParams.delete('pose'); history.replaceState(null,'',locationUrl);
                return json({ok:true});
            }
        }
        const abilityRoute = path.match(new RegExp(`^${base}/(ability-translations|ability-icons)(?:/([a-f0-9-]{36})/(confirm|preview|stop))?$`));
        if (abilityRoute) {
            const channel = abilityRoute[1], textOnly = channel === 'ability-translations', itemId = url.searchParams.get('item'), method = options.method || 'GET';
            const items = actor.definition.items.filter(item => ['feat','weapon','spell'].includes(item.type));
            const rows = toolJobs[channel] ||= {};
            if (method === 'GET' && !abilityRoute[3]) {
                for (const job of Object.values(rows)) if (['pending','icon-pending'].includes(job.status) && Date.now() - Date.parse(job.createdAt) > 1200) {
                    job.status = 'ready';
                    if (textOnly) job.draft = { name: job.itemId === 'bite' ? 'Colpo Arcano' : job.itemId === 'spell' ? 'Invisibilità' : 'Scudo Arcano',
                        description: job.itemId === 'bite' ? '<p>Infligge 2d6 danni da fuoco entro 30 piedi. CD 15.</p>' : '<p>Una barriera magica protegge il personaggio.</p>' };
                    else job.iconId = job.id;
                }
                saveTools();
                return json({ok:true,iconDirections:1,enabled:true,canSync:true,canStop:true,hasAvatar:true,abilityTranslations:1,abilityIcons:1,jobs:Object.values(rows),items:items.map(item => ({id:item.itemId,type:item.type,name:item.name,description:item.definition?.description||'',img:actor.media.avatar.path,blocked:actor.sync.commands.some(command=>command.status==='pending'&&command.target?.itemId===item.itemId)}))});
            }
            if (!abilityRoute[3] && method === 'POST') {
                const input = JSON.parse(options.body);
                rows[itemId] = {id:input.requestId,itemId,details:input.details||'',status:textOnly?'pending':'icon-pending',iconAttempt:input.requestId,createdAt:new Date().toISOString()};
                saveTools(); return json({ok:true,job:rows[itemId]},202);
            }
            const job = rows[itemId]; if (!job || job.id !== abilityRoute[2]) return json({error:'Proposta simulata non trovata.'},404);
            if (abilityRoute[3] === 'preview') return nativeFetch(actor.media.avatar.path);
            if (abilityRoute[3] === 'confirm') {
                job.command ||= {id:crypto.randomUUID(),kind:'item.update',status:'pending',target:{itemId},patches:textOnly?[{path:'name',value:job.draft.name},{path:'system.description.value',value:job.draft.description}]:[{path:'img',value:actor.media.avatar.path}]};
                job.status = 'accepted'; if (!actor.sync.commands.some(command=>command.id===job.command.id)) actor.sync.commands.push(job.command);
                saveTools(); return json({ok:true,command:job.command},202);
            }
            if (abilityRoute[3] === 'stop') {job.status='uncertain';job.error='Attesa interrotta nella prova.';saveTools();return json({ok:true,job});}
        }
        const tokenRoute = path.match(new RegExp(`^${base}/token-generation(?:/([a-f0-9-]{36})/(preview|confirm|stop))?$`));
        if (tokenRoute) {
            const settings = { ok: true, enabled: true, optionsVersion: 1, tokenGenerationVersion: 1, canStop: true, supportedResolutions: ['medium', 'high', '2k'], supportedQualities: ['medium', 'high', 'xhigh'], style: 'Ritratto circolare 1:1 coerente con l’avatar, cornice intera ed esterno trasparente.' };
            const job = tokenState.job, method = options.method || 'GET';
            if (!tokenRoute[2] && method === 'GET') {
                if (job?.status === 'pending' && Date.now() - Date.parse(job.createdAt) > 1200) { job.status = 'ready'; saveToken(); }
                return json({ ...settings, job });
            }
            if (!tokenRoute[2] && method === 'POST') {
                const input = JSON.parse(options.body);
                tokenState.job = { id: input.requestId, mediaSlot: 'token', status: 'pending', details: input.details, options: { quality: input.quality, resolution: input.resolution }, createdAt: new Date().toISOString() };
                tokenState.receipt = null; saveToken(); return json({ ok: true, job: tokenState.job }, 202);
            }
            if (!job || job.id !== tokenRoute[1]) return json({ error: 'Anteprima simulata non trovata.' }, 404);
            if (tokenRoute[2] === 'preview' && method === 'GET') return nativeFetch(tokenArt);
            if (tokenRoute[2] === 'confirm' && method === 'POST' && ['ready', 'accepted'].includes(job.status)) {
                tokenState.receipt ||= { ok: true, token: { path: tokenArt, revision: Number(actor.media.token?.revision || 0) + 1, source: 'site', presentation: { x: 50, y: 50, scale: 1 } }, revision: actor.revision + 1 };
                job.status = 'accepted'; actor.media.token = tokenState.receipt.token; actor.revision = tokenState.receipt.revision; saveToken(); return json(tokenState.receipt);
            }
            if (tokenRoute[2] === 'stop' && method === 'POST') { job.status = 'uncertain'; job.error = 'Attesa interrotta nella prova simulata.'; saveToken(); return json({ ok: true, job }); }
            return json({ error: 'Operazione non disponibile nella prova.' }, 409);
        }
        if (path === `${base}/ability-suggestions/${analysisId}/discard` && options.method === 'POST') {
            sessionStorage.setItem(analysisKey, 'true');
            return json({ ok: true, canDiscardSuggestions: true, discarded: true, job: null, stale: false });
        }
        if ((options.method || 'GET') !== 'GET') return json({ error: 'Prova di navigazione: nessuna generazione o modifica viene avviata.' }, 409);
        if (path === '/auth/discord/verify') return json({ user: { accountId: player ? 'local-owner' : 'local-dm', username: player ? 'Giocatore di prova' : 'DM di prova' } });
        if (path === '/api/campaign/access') return json({ ok: true, permissions: { canManageCampaign: !player } });
        if (path === base) return json({ ok: true, data: actor });
        if (path === `${base}/profile`) return json({ ok: true, data: { name: actor.name, role: 'Guardiano delle sale proibite', kind: 'person', visibility: { state: 'dm' }, blocks: [{ id: 'storia', type: 'lore', title: 'Il custode', text: 'Veglia sulla cripta da secoli, difendendone i segreti.' }] }, permissions: { canEdit: true, isEditor: true } });
        if (path === `${base}/ability-icons`) return json({ ok: true, enabled: true, canSync: true, hasAvatar: true, canStop: true, items: actor.definition.items.filter(item => item.type === 'feat').map(item => ({ id: item.itemId, name: item.name })), jobs: [] });
        if (path === `${base}/ability-generation`) return json({ ok: true, enabled: true, version: 1, canSync: true, canGenerate: true, sharedRuntime: true, hasAvatar: true, canStop: true, job: null });
        if (path === `${base}/ability-suggestions`) return json({ ok: true, enabled: true, version: 1, hasAvatar: true, canDiscardSuggestions: true, stale: true, job: sessionStorage.getItem(analysisKey) ? null : analysis });
        if (path === `${base}/avatar-generation`) return json({ ok: true, enabled: true, optionsVersion: 1, canStop: true, supportedResolutions: ['medium', 'high', '2k'], supportedQualities: ['medium', 'high', 'xhigh'], job: null });
        if (path === '/api/npc-categories') return json({ ok: true, categories: [] });
        if (path.includes('/native-') || path.endsWith('/editor')) return json({ error: 'Snapshot non presente nella prova locale.' }, 404);
        if (path.startsWith('/api/') || path.startsWith('/auth/')) return json({ ok: true, data: [], items: [], jobs: [], notifications: [] });
        if (url.origin !== location.origin) return json({ error: 'Richiesta esterna esclusa dalla prova.' }, 503);
        return nativeFetch(resource, options);
    };
}
await mkdir(destination, { recursive: true });
const layout = (await readFile('assets/js/layout.js', 'utf8'))
    .replace('window.localStorage.getItem(DISCORD_TOKEN_KEY) || ""', '"local-fixture-no-live-credentials"')
    .replace('basePath = cleanSrc.replace("assets/js/layout.js", "");', 'basePath = "/";');
await writeFile(resolve(destination, 'layout.js'), layout);
await writeFile(resolve(destination, 'fixture.js'), `(${fixture.toString()})(${JSON.stringify(actor)});`);
const page = (await readFile('pages/characters/managed-actor.html', 'utf8'))
    .replace('<head>', `<head><base href="/pages/characters/managed-actor.html"><script src="${prefix}/fixture.js"></script>`)
    .replace(/src="\.\.\/\.\.\/assets\/js\/layout\.js[^"]*"/, `src="${prefix}/layout.js"`);
await writeFile(resolve(destination, 'managed-actor.html'), page);
const playerActor = structuredClone(actor);
playerActor.actorId = 'eroe'; playerActor.actorType = 'character'; playerActor.name = 'Elian, Custode delle Braci'; playerActor.relationship = 'player';
playerActor.permissions = {isEditor:false,isOwner:true,canEdit:true,canEditStats:true}; playerActor.visibility.state = 'public';
playerActor.definition.editor = {version:1};
playerActor.definition.items[0].name = 'Arcane Strike'; playerActor.definition.items[0].definition.description = '<p>Deal 2d6 fire damage within 30 feet. DC 15.</p>';
playerActor.definition.items[1].name = 'Arcane Shield'; playerActor.definition.items[2].name = 'Invisibility';
await mkdir(resolve(destination, 'player'), {recursive:true});
await writeFile(resolve(destination, 'fixture-player.js'), `(${fixture.toString()})(${JSON.stringify(playerActor)});`);
await writeFile(resolve(destination, 'player/managed-actor.html'), page.replace(`${prefix}/fixture.js`, `${prefix}/fixture-player.js`));
for (const width of [1180, 320]) {
    await writeFile(resolve(destination, `player-${width}.html`), `<!doctype html><html lang="it"><meta charset="utf-8"><title>AI del personaggio — ${width}px</title><style>body{margin:0;min-width:${width + 20}px;background:#25252b;color:#dec28a;font:14px Arial;display:grid;justify-items:center}p{margin:8px}iframe{width:${width}px;height:860px;border:1px solid #555}</style><p>Proprietario del personaggio · dati simulati · ${width}px</p><iframe title="Scheda personaggio a ${width} pixel" src="player/managed-actor.html?world=mondo-di-prova&actor=eroe"></iframe></html>`);
    await writeFile(resolve(destination, `${width}.html`), `<!doctype html><html lang="it"><meta charset="utf-8"><title>Strumenti AI · ${width}px</title><style>body{margin:0;min-width:${width + 20}px;background:#25252b;color:#dec28a;font:14px Arial;display:grid;justify-items:center}p{margin:8px}iframe{width:${width}px;height:860px;border:1px solid #555}</style><p>Strumenti AI · dati simulati · ${width}px</p><iframe title="Scheda NPC a ${width} pixel" src="managed-actor.html?world=mondo-di-prova&actor=custode"></iframe></html>`);
}
console.log(`AI tools fixture ready: ${prefix}/1180.html and ${prefix}/320.html`);
if (process.argv.includes('--serve')) {
    const root = resolve('.'), types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
    createServer(async (request, response) => {
        try {
            const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:8769').pathname), file = resolve(root, '.' + path);
            if (!file.startsWith(root + sep) || !types[extname(file)] || !(path.startsWith(`${prefix}/`) || path.startsWith('/assets/') || path.startsWith('/campaigns/') || path === '/sidebar.html')) { response.writeHead(404).end(); return; }
            const bytes = await readFile(file); response.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store' }); response.end(bytes);
        } catch { response.writeHead(404).end(); }
    }).listen(8769, '127.0.0.1', () => console.log(`UI fixture: http://127.0.0.1:8769${prefix}/1180.html (simulated API only)`));
}
