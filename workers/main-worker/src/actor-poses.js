import {avatarGenerationOptions, avatarReferenceKey} from "./avatar-generation.js";
import {handleConceptImage, UPLOAD_ID} from "./concept-images.js";
import {readNpcPoseDirections} from "./npc-generation.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply = (data, status = 200) => Response.json(data, {status, headers: {"Cache-Control":"private, no-store"}});
const fail = (error, status = 400) => reply({ok:false, error}, status);

async function mediaBaseline(media) {
  const slots = ["avatar", "token", "idle", "hover"].map(part => {
    const slot = media[part];
    return [slot?.path, slot?.revision, slot?.hash, slot?.presentation];
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(slots)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleActorPoses(request, route, campaignId, env, services) {
  const user = await services.requireUser(request);
  if (user instanceof Response) return user;
  if (!await services.isEditor(user, campaignId)) return fail("Solo il DM o l’admin può modificare le pose di questo NPC.", 403);
  const actor = await services.readActor(campaignId, route);
  if (actor?.actorType !== "npc") return fail("NPC non trovato nella campagna.", 404);
  if (!env.NPC_GENERATOR || !env.MEDIA_BUCKET) return fail("Aggiorna il servizio per generare le pose.", 503);
  const context = {campaignId, worldId:route.worldId, actorId:route.actorId, accountId:services.accountId(user)};
  if (!context.accountId) return fail("Account non disponibile.", 403);
  const stub = env.NPC_GENERATOR.get(env.NPC_GENERATOR.idFromName("npc-generations-v1"));
  const call = (action, data = {}) => stub.fetch(new Request("https://npc.internal/" + action, {method:"POST", body:JSON.stringify({...data, context})}));
  const uploadKey = id => `_private/ai-npcs/pose-inputs/${campaignId}/${route.worldId}/${route.actorId}/${encodeURIComponent(context.accountId)}/${id}`;
  if (route.action === "upload") return handleConceptImage(request, null, env.MEDIA_BUCKET, uploadKey);
  const media = actor.media || {}, baseline = await mediaBaseline(media);
  const sourceKey = part => avatarReferenceKey(media[part]?.path, campaignId);
  if (request.method === "GET" && !route.action) {
    const result = await call("latest");
    if (!result.ok) return result;
    const data = await result.json();
    if (!data.actorPoses) return fail("Aggiornamento del generatore di pose in corso.", 503);
    return reply({ok:true, enabled:Boolean(env.OPENAI_API_KEY), supportsIdleDirection:data.supportsIdleDirection === true, job:data.job, baseline, canGenerateIdle:Boolean(sourceKey("avatar") || sourceKey("token")), currentIdle:media.idle?.path || "", canUseIdle:Boolean(sourceKey("idle")), currentHover:media.hover?.path || ""});
  }
  if (request.method === "GET" && ["idle","hover"].includes(route.action)) return call(route.action, {id:route.jobId});
  if (request.method !== "POST") return fail("Operazione non supportata.", 405);
  if (route.action === "stop") return call("stop", {id:route.jobId});
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 6000) return fail("Richiesta troppo lunga.", 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return fail("Richiesta non valida."); }
  if (route.action !== "confirm") {
    if (route.action) return fail("Operazione non supportata.", 405);
    if (!uuid.test(body.requestId) || !["idle","hover","upload"].includes(body.action)) return fail("Richiesta di posa non valida.");
    if (body.baseline !== baseline) return fail("Le immagini dell’NPC sono cambiate. Aggiorna le anteprime.", 409);
    if (body.parentJobId && (!uuid.test(body.parentJobId) || body.action !== "hover")) return fail("Riferimento alla proposta non valido.");
    const directions = readNpcPoseDirections(body.action, body);
    if (!directions) return fail("Le indicazioni possono contenere fino a 500 caratteri.");
    const pose = body.action === "upload" ? "idle" : body.action;
    const options = avatarGenerationOptions(body, pose);
    if (!options) return fail("Qualità o risoluzione non valida.");
    if (body.action === "upload") {
      if (typeof body.uploadId !== "string" || !UPLOAD_ID.test(body.uploadId) || !body.uploadId.endsWith(".webp")) return fail("Scegli un idle WebP trasparente.");
    } else if (!env.OPENAI_API_KEY) return fail("Generazione AI non attiva.", 503);
    return call("actor-pose", {id:body.requestId, pose, baseline, options, name:actor.name,
      ...directions, parentJobId:body.parentJobId, idleRevision:body.idleRevision,
      uploadKey:body.action === "upload" ? uploadKey(body.uploadId) : "", avatarKey:sourceKey("avatar"), tokenKey:sourceKey("token"), currentIdleKey:sourceKey("idle")});
  }
  const claim = await call("claim-poses", {id:route.jobId, idleRevision:body.idleRevision, hoverRevision:body.hoverRevision});
  if (!claim.ok) return claim;
  const {job} = await claim.json();
  if (job.status === "accepted") return reply(job.receipt);
  const target = part => `campaigns/${campaignId}/managed-actors/${route.worldId}/${route.actorId}/site/${part}-ai-${job.id}.webp`;
  const parts = job.usesCurrentIdle ? ["hover"] : ["idle","hover"];
  const applied = parts.every(part => media[part]?.path === "media/" + target(part));
  let revision = actor.revision, nextMedia = {...media};
  if (!applied) {
    if (baseline !== job.actorBaseline) {
      await call("release-poses", {id:job.id});
      return fail("Le immagini dell’NPC sono cambiate. Riparti da quelle attuali.", 409);
    }
    const changes = {}, site = {...actor.site};
    const presentation = (job.usesCurrentIdle && media.idle?.presentation) || {x:50, y:50, scale:1};
    for (const part of parts) {
      const image = await env.MEDIA_BUCKET.get(job[part + "Key"]);
      if (!image) {
        await call("release-poses", {id:job.id});
        return fail("Anteprima non disponibile. Rigenera la posa.", 409);
      }
      await env.MEDIA_BUCKET.put(target(part), image.body, {httpMetadata:{contentType:"image/webp"}});
      changes[part] = {path:"media/" + target(part), revision:Number(media[part]?.revision || 0) + 1, source:"site", presentation};
      const historyKey = part + "History", history = site[historyKey] || [];
      if (media[part]?.path && !history.some(entry => entry.path === media[part].path)) site[historyKey] = [...history, media[part]];
    }
    const saved = await services.saveActor({...actor, expectedRevision:actor.revision, media:changes, site});
    if (!saved.ok) {
      if (saved.status === 409) await call("release-poses", {id:job.id});
      return saved;
    }
    revision = (await saved.json()).revision;
    nextMedia = {...media,...changes};
  }
  const receipt = {ok:true, revision, idle:nextMedia.idle, hover:nextMedia.hover};
  const accepted = await call("accepted", {id:job.id, receipt});
  return accepted.ok ? reply(receipt) : accepted;
}
