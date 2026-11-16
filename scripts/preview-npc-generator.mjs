import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";

// Local UI fixture only: production generator and CSS, simulated network.
const root = resolve("."), port = Number(process.argv[2] || 8769);
const avatar = "assets/img/creatures/bestiary/nino_olegna_npc.webp", token = "assets/img/creatures/transp/avatar.webp";
const jobs = new Map(), pendingCreates = []; let latest = null;
const categories = [{ id: "alleati", name: "Alleati", order: 1 }, { id: "custodi", name: "Custodi delle terre di confine", parentId: "alleati", order: 2 }];
const examples = [["nino", "Nino Olegna"], ["guardia", "Guardia della cripta"]].map(([actorId, name]) => ({
  worldId: "mondo-di-prova", actorId, actorType: "npc", actorLink: true, name, revision: 1, updatedAt: "2026-11-16T12:00:00.000Z",
  permissions: { isEditor: true, canReadProfile: true, canReadStats: true }, capabilities: [], visibility: { state: "dm" },
  profile: { name, kind: "person", kindSource: "manual", visibility: { state: "dm" }, lifeState: "alive", categoryId: "alleati", category: "Alleati", tags: [], revision: 1 },
  media: { avatar: { path: `media/campaigns/cripta-di-sangue/${actorId}/avatar.webp` }, token: { path: `media/campaigns/cripta-di-sangue/${actorId}/token.webp` } },
}));
const json = (response, body, status = 200) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); };
const settings = () => ({ ok: true, enabled: true, version: 1, canStop: true, supportedResolutions: ["medium", "high", "2k"], supportedQualities: ["medium", "high", "xhigh"], job: latest });
function staticFixture(config) {
  const nativeFetch = window.fetch.bind(window), stateKey = "npc-generator-qa-state";
  let state;
  try { state = JSON.parse(sessionStorage.getItem(stateKey)); } catch (_) {}
  state ||= { jobs: {}, latest: null, pendingCreates: [] };
  const save = () => sessionStorage.setItem(stateKey, JSON.stringify(state));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (resource, options = {}) => {
    const url = new URL(typeof resource === "string" ? resource : resource.url, location.href), path = url.pathname;
    if (path === "/auth/discord/verify") return json({ user: { accountId: "local-dm", username: "DM di prova" } });
    if (path === "/api/campaign/access") return json({ ok: true, permissions: { canManageCampaign: true } });
    if (path === "/api/managed-actors") return json({ ok: true, data: config.examples, pendingCreates: state.pendingCreates, npcCategories: config.categories, worldIds: ["mondo-di-prova"] });
    if (path === "/api/npc-categories") return json({ ok: true, revision: 1, categories: config.categories });
    const route = path.match(/^\/api\/npc-generation(?:\/([a-f0-9-]+)\/(avatar|token|confirm|retry-token|stop))?$/);
    if (route) {
      const input = options.body ? JSON.parse(options.body) : {}, job = state.jobs[route[1]], method = options.method || "GET";
      if (method === "GET" && !route[2]) {
        const latest = state.jobs[state.latest];
        if (latest?.status === "pending" && Date.now() - Date.parse(latest.createdAt) > 1200) {
          latest.hasAvatar = true; latest.phase = "token";
          if (Date.now() - Date.parse(latest.createdAt) > 2400) { latest.hasToken = true; latest.status = "ready"; }
          save();
        }
        return json({ ok: true, enabled: true, version: 1, canStop: true, supportedResolutions: ["medium", "high", "2k"], supportedQualities: ["medium", "high", "xhigh"], job: latest || null });
      }
      if (method === "GET" && ["avatar", "token"].includes(route[2])) return nativeFetch("/" + (route[2] === "avatar" ? config.avatar : config.token));
      if (!route[2] || route[2] === "retry-token") {
        const next = { id: input.requestId, draftId: job?.draftId || input.draftId || input.requestId, form: input.form || job?.form, options: { quality: input.quality, resolution: input.resolution }, references: input.references || job?.references || [], status: "pending", phase: job ? "token" : "avatar", hasAvatar: Boolean(job), hasToken: false, createdAt: new Date().toISOString() };
        state.latest = next.id; state.jobs[next.id] = next; save(); return json({ ok: true, job: next }, 202);
      }
      if (route[2] === "stop") { job.status = "uncertain"; job.error = "Attesa interrotta (prova simulata)."; save(); return json({ ok: true, job }); }
      if (route[2] === "confirm") {
        if (!job?.hasToken) return json({ error: "Completa le immagini." }, 409);
        const form = input.form || job.form;
        const queued = { id: job.draftId, clientId: `ai-${job.draftId}`, targetWorldId: form.targetWorldId, kind: "actor.create", status: "pending", document: { name: form.name, media: { avatar: "media/campaigns/cripta-di-sangue/new/avatar.webp", token: "media/campaigns/cripta-di-sangue/new/token.webp" } }, profile: { ...form, category: config.categories.find(category => category.id === form.categoryId)?.name || "", visibility: { state: form.visibility }, blocks: [{ id: "descrizione", type: "lore", text: form.description, visibility: "public" }] } };
        if (!state.pendingCreates.some(entry => entry.id === job.draftId)) state.pendingCreates.push(queued);
        job.status = "accepted"; save(); return json({ ok: true, queued: true, request: queued }, 202);
      }
    }
    if (path.startsWith("/api/") || path.startsWith("/auth/")) return json({ ok: true, data: [], items: [], notifications: [] });
    if (url.origin !== location.origin) return json({ error: "External requests disabled in this fixture" }, 503);
    return nativeFetch(resource, options);
  };
}
if (process.argv.includes("--static")) {
  const destination = resolve(root, "output/npc-generator-qa"), prefix = "/output/npc-generator-qa";
  await mkdir(destination, { recursive: true });
  const layout = (await readFile(resolve(root, "assets/js/layout.js"), "utf8"))
    .replace('window.localStorage.getItem(DISCORD_TOKEN_KEY) || ""', '"local-ui-fixture-no-live-credentials"')
    .replace('basePath = cleanSrc.replace("assets/js/layout.js", "");', 'basePath = "/";')
    .replace('function resolveImageUrl(path, options = {}) {', `function resolveImageUrl(path, options = {}) { if (String(path).includes('campaigns/cripta-di-sangue/')) return new URL(String(path).includes('/token.') ? '/${token}' : '/${avatar}', location.origin).href;`);
  const page = (await readFile(resolve(root, "pages/npcs.html"), "utf8"))
    .replace("<head>", `<head><base href="/pages/npcs.html"><script src="${prefix}/fixture.js"></script>`)
    .replace(/src="\.\.\/assets\/js\/layout\.js[^"]*"/, `src="${prefix}/layout.js"`)
    .replace('<main class="main-content">', '<main class="main-content"><p style="padding:8px;color:#e4c689" role="note">Prova simulata: nessuna generazione a pagamento o modifica a Foundry.</p>');
  await writeFile(resolve(destination, "layout.js"), layout);
  await writeFile(resolve(destination, "fixture.js"), `(${staticFixture.toString()})(${JSON.stringify({ categories, examples, avatar, token })});`);
  await writeFile(resolve(destination, "npcs.html"), page);
  await writeFile(resolve(destination, "mobile.html"), '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genera NPC · anteprima mobile</title><style>body{margin:0;background:#25252b;color:#e4c689;font:14px Arial;display:grid;justify-items:center}p{margin:8px}iframe{width:320px;height:860px;border:1px solid #555}</style><p>Anteprima a 320 px · dati simulati</p><iframe title="Genera NPC a 320 pixel" src="npcs.html"></iframe></html>');
  await writeFile(resolve(destination, "desktop.html"), '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genera NPC · anteprima desktop</title><style>body{margin:0;min-width:1200px;background:#25252b;color:#e4c689;font:14px Arial;display:grid;justify-items:center}p{margin:8px}iframe{width:1180px;height:860px;border:1px solid #555}</style><p>Anteprima a 1180 px · dati simulati</p><iframe title="Genera NPC a 1180 pixel" src="npcs.html"></iframe></html>');
  console.log(`Static UI fixture ready: /output/npc-generator-qa/npcs.html (serve with the existing local server)`);
  process.exit(0);
}
const html = embedded => `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genera NPC · prova locale</title>
<link rel="stylesheet" href="/assets/css/abyssal.css"><link rel="stylesheet" href="/assets/css/components/npc-avatar-generator.css"><link rel="stylesheet" href="/assets/css/components/npc-generator.css">
<style>body{margin:0;padding:24px;background:#101115;color:#e8e5df;font:14px Arial,sans-serif}h1{font:28px Georgia,serif;color:#e4c689}body>button{padding:12px 18px;background:#dec28a;border:0;border-radius:9px;cursor:pointer}output{display:block;white-space:pre-wrap;margin-top:20px}.npc-avatar-generator{font-family:Arial,sans-serif}</style>
<h1>Genera NPC</h1><p>Prova locale · nessuna generazione a pagamento · nessuna modifica a Foundry.</p><button id="open">Apri Genera NPC</button><output id="result" role="status"></output>
<script>window.CriptaApp={campaigns:{currentId:()=>"cripta-di-sangue"},urls:{api:path=>new URL('/'+path,location.origin).href},utils:{resolveImageUrl:path=>'/'+path}};window.CriptaDiscordAuth={getToken:()=>"local-ui-fixture-no-live-credentials"};</script>
<script src="/assets/js/shared/npc-generator.js"></script><script>
document.querySelector('#open').addEventListener('click',()=>window.CriptaNpcGenerator.open({worlds:['mondo-di-prova'],categories:[{id:'alleati',name:'Alleati'},{id:'custodi',name:'Custodi delle terre di confine',parentName:'Alleati'}],npcs:[
{name:'Nino Olegna',category:'Alleati',managedActorWorldId:'mondo-di-prova',managedActorId:'nino',images:{avatar:'media/campaigns/cripta-di-sangue/example/avatar.webp',token:'media/campaigns/cripta-di-sangue/example/token.webp'}},
{name:'Guardia della cripta',category:'Custodi',managedActorWorldId:'mondo-di-prova',managedActorId:'guardia',images:{avatar:'media/campaigns/cripta-di-sangue/guardia/avatar.webp',token:'media/campaigns/cripta-di-sangue/guardia/token.webp'}}
],onCreated:payload=>{document.querySelector('#result').textContent='CONFERMA VERIFICATA (simulata)\\n'+JSON.stringify(payload.request,null,2)}}));
${embedded ? "document.querySelector('#open').click();" : ""}</script></html>`;
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`), path = url.pathname;
    if (path === "/pages/npcs.html") {
      const page = await readFile(resolve(root, "pages/npcs.html"), "utf8");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(page.replace("<head>", '<head><script>localStorage.setItem("discord_jwt","local-ui-fixture-no-live-credentials");</script>').replace("<main class=\"main-content\">", '<main class="main-content"><p style="padding:8px;color:#e4c689" role="note">Prova simulata: stessa pagina locale, dati di esempio, nessuna modifica a Foundry.</p>')); return;
    }
    if (path === "/auth/discord/verify") { json(response, { user: { accountId: "local-dm", username: "DM di prova" } }); return; }
    if (path === "/api/campaign/access") { json(response, { ok: true, permissions: { canManageCampaign: true } }); return; }
    if (path === "/api/managed-actors") { json(response, { ok: true, data: examples, pendingCreates, npcCategories: categories, worldIds: ["mondo-di-prova"] }); return; }
    if (path === "/api/npc-categories") { json(response, { ok: true, revision: 1, categories }); return; }
    if (path === "/" && url.searchParams.has("width")) {
      const width = ["320", "390"].includes(url.searchParams.get("width")) ? url.searchParams.get("width") : "320";
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<html><body style="margin:0;background:#333;display:grid;place-items:start center"><iframe title="Anteprima mobile ${width}px" style="width:${width}px;height:840px;border:0" src="/?embedded=1"></iframe></body></html>`); return;
    }
    if (path === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html(url.searchParams.has("embedded"))); return; }
    const route = path.match(/^\/api\/npc-generation(?:\/([a-f0-9-]+)\/(avatar|token|confirm|retry-token|stop))?$/);
    if (route) {
      let body = ""; for await (const chunk of request) body += chunk;
      const input = body ? JSON.parse(body) : {}, job = jobs.get(route[1]);
      if (request.method === "GET" && !route[2]) {
        if (latest?.status === "pending" && Date.now() - Date.parse(latest.createdAt) > 1500) {
          latest.hasAvatar = true; latest.phase = "token";
          if (Date.now() - Date.parse(latest.createdAt) > 3000) { latest.hasToken = true; latest.status = "ready"; }
        }
        json(response, settings()); return;
      }
      if (request.method === "GET" && ["avatar", "token"].includes(route[2])) {
        response.setHeader("Content-Type", "image/webp"); response.end(await readFile(resolve(root, route[2] === "avatar" ? avatar : token))); return;
      }
      if (!route[2] || route[2] === "retry-token") {
        latest = { id: input.requestId, draftId: job?.draftId || input.draftId || input.requestId, form: input.form || job?.form, options: { quality: input.quality, resolution: input.resolution }, references: input.references || job?.references || [], status: "pending", phase: job ? "token" : "avatar", hasAvatar: Boolean(job), hasToken: false, createdAt: new Date().toISOString() };
        jobs.set(latest.id, latest); json(response, { ok: true, job: latest }, 202); return;
      }
      if (route[2] === "stop") { job.status = "uncertain"; job.error = "Attesa interrotta (prova simulata)."; json(response, { ok: true, job }); return; }
      if (route[2] === "confirm") {
        if (!job?.hasToken) { json(response, { error: "Completa le immagini." }, 409); return; }
        const form = input.form || job.form;
        const queued = { id: job.draftId, clientId: `ai-${job.draftId}`, targetWorldId: form.targetWorldId, kind: "actor.create", status: "pending", document: { name: form.name, media: { avatar: "media/campaigns/cripta-di-sangue/new/avatar.webp", token: "media/campaigns/cripta-di-sangue/new/token.webp" } }, profile: { ...form, category: categories.find(category => category.id === form.categoryId)?.name || "", visibility: { state: form.visibility }, blocks: [{ id: "descrizione", type: "lore", text: form.description, visibility: "public" }] } };
        if (!pendingCreates.some(entry => entry.id === job.draftId)) pendingCreates.push(queued);
        job.status = "accepted"; json(response, { ok: true, queued: true, request: queued }, 202); return;
      }
    }
    if (path.startsWith("/api/") || path.startsWith("/auth/")) { json(response, { ok: true, data: [], items: [], notifications: [] }); return; }
    if (path === "/sidebar.html") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(await readFile(resolve(root, "sidebar.html"))); return; }
    const asset = path.startsWith("/media/campaigns/") ? (path.endsWith("token.webp") ? token : avatar) : path.slice(1);
    const file = resolve(root, asset);
    if (!(asset.startsWith("assets/") || asset.startsWith("campaigns/")) || !file.startsWith(root + "\\") || ![".js", ".css", ".json", ".svg", ".webp", ".png", ".woff2", ".woff"].includes(extname(file))) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", ({ ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff" })[extname(file)]);
    if (asset === "assets/js/layout.js") { response.end((await readFile(file, "utf8")).replace('const DISCORD_WORKER_URL = "https://sigillo-api.khuzoe.workers.dev";', `const DISCORD_WORKER_URL = "http://127.0.0.1:${port}";`)); return; }
    response.end(await readFile(file));
  } catch (error) { json(response, { error: error.message }, 500); }
}).listen(port, "127.0.0.1", () => console.log(`NPC generator UI fixture: http://127.0.0.1:${port}/ (simulated API only)`));
