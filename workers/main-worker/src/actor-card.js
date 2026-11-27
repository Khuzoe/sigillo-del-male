import { AVATAR_MODEL, avatarReferenceKey, webpSize } from "./avatar-generation.js";
import { NPC_AVATAR_MAX_BYTES, npcVisualReferenceInput } from "./npc-visual-reference.js";
import { GENERATION_WAIT_MS } from "./generation-lifecycle.js";
import { canUseActorOwnerTools } from "./managed-ability-tools.js";

const CARD_WIDTH = 1600;
const CARD_HEIGHT = 960;

export const cardPrompt = name => `Nome dell’NPC: ${name}

Genera una fascia dark fantasy per una card di Foundry VTT, in formato panoramico. Usa il nome fornito come unico input testuale e l’avatar allegato come riferimento visivo per il ritratto.

A DESTRA — Crea un ritratto originale ispirato al nome. Scegli posa, prospettiva, aspetto, colori e illuminazione coerenti con il personaggio. Adatta l’inquadratura alla sua anatomia: primo piano per un umanoide, testa e collo per un drago, sagoma riconoscibile per una creatura priva di volto. Posiziona il dettaglio più espressivo a circa tre quarti della larghezza e mantienilo ben visibile anche in miniatura.

A SINISTRA — Scrivi il nome esattamente come fornito, in un elegante serif avorio, grande e ben leggibile. Riserva al testo circa il 40% della fascia, allinealo a sinistra e centralo verticalmente. Tieni i nomi brevi su una riga e manda a capo quelli lunghi tra due parole. Se il nome contiene già un epiteto separato da « - », componi l’epiteto sotto il nome in corpo più piccolo. In tutti gli altri casi mostra solo il nome. Conserva accenti e apostrofi. Sfondo sfumato, tendente allo scuro.

FINITURA — Fai sfumare lo sfondo del ritratto verso una tonalità ripresa dal personaggio. Lascia libera la zona dietro le lettere. La fascia deve restare leggibile a 330 px di larghezza. Nessun testo aggiuntivo, no cornice, logo o pulsante. Negli ultimi 200 px in basso, scurisci gradualmente l’immagine fino a raggiungere un tono quasi nero sul bordo inferiore.`;

const reply = (data, status = 200) => Response.json(data, {status, headers: {"Cache-Control":"private, no-store"}});
const fail = (message, status) => reply({ok:false, error:message}, status);
const active = job => ["pending", "running", "applying"].includes(job?.status);
const publicJob = job => job && ({id:job.id, status:job.status, error:job.error || "", automatic:job.automatic});
const fingerprint = card => JSON.stringify([card?.path || "", card?.revision || 0]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const previewKey = job => `_private/actor-cards/${job.context.campaignId}/${job.context.worldId}/${job.context.actorId}/${job.id}.webp`;
export const cardKey = job => `campaigns/${job.context.campaignId}/managed-actors/${job.context.worldId}/${job.context.actorId}/site/card-ai-${job.id}.webp`;
export const matchesCardSource = (job, actor) => !!actor && job.name === actor.name && fingerprint(actor.media?.card) === job.baseline
  && (job.avatarBaseline === undefined || job.avatarBaseline === fingerprint(actor.media?.avatar));

async function cardAvatarReference(actor, campaignId, bucket) {
  const referenceKey = avatarReferenceKey(actor.media?.avatar?.path, campaignId);
  const reference = referenceKey && await bucket.head(referenceKey);
  if (!reference?.size || reference.size > NPC_AVATAR_MAX_BYTES) return null;
  return {referenceKey, referenceEtag:reference.etag, avatarBaseline:fingerprint(actor.media.avatar)};
}
const missingAvatar = "Carica e salva sulla scheda un avatar disponibile sulla wiki, fino a 12 MB.";

export function callActorCard(env, {campaignId, worldId, actorId}, action, id) {
  const context = {campaignId, worldId, actorId};
  const stub = env.ACTOR_CARD_GENERATOR.get(env.ACTOR_CARD_GENERATOR.idFromName(JSON.stringify(context)));
  return stub.fetch(new Request(`https://card.internal/${action}`, {method:"POST", body:JSON.stringify({context,id})}));
}

export async function handleActorCard(request, route, campaignId, env, services) {
  const user = await services.requireUser(request);
  if (user instanceof Response) return user;
  const actor = await services.readActor(campaignId, route);
  if (!await canUseActorOwnerTools(user, actor, campaignId, services)) return fail("Permesso di modifica del personaggio richiesto.", 403);
  if (!env.ACTOR_CARD_GENERATOR || !env.MEDIA_BUCKET) return fail("Generatore di card non disponibile.", 503);
  const context = {...route, campaignId};
  if (request.method === "GET" && !route.action) {
    const result = await callActorCard(env, context, "latest");
    if (!result.ok) return result;
    const data = await result.json(), card = actor.media?.card || null;
    if (data.job?.status === "accepted" && card?.path !== "media/" + cardKey({context, id:data.job.id})) data.job = null;
    const reference = await cardAvatarReference(actor, campaignId, env.MEDIA_BUCKET);
    return reply({...data, card, hasAvatar:Boolean(reference)});
  }
  if (request.method === "GET" && route.action === "preview") return callActorCard(env, context, "preview", route.jobId);
  if (request.method === "GET" && route.action === "confirm") {
    if (actor.media?.card?.path === "media/" + cardKey({context, id:route.jobId})) {
      return reply({ok:true, job:{id:route.jobId, status:"accepted"}});
    }
    const latest = await callActorCard(env, context, "latest");
    if (!latest.ok) return latest;
    const {job} = await latest.json();
    return job?.id === route.jobId ? reply({ok:true, job}) : fail("È disponibile una proposta più recente.", 409);
  }
  if (request.method !== "POST") return fail("Operazione non supportata.", 405);
  if (route.action === "confirm") {
    const options = await request.json().catch(() => null);
    return callActorCard(env, context, options?.background === true ? "queue-confirm" : "confirm", route.jobId);
  }
  if (route.action) return fail("Operazione non supportata.", 405);
  const body = await request.json().catch(() => null);
  if (!uuid.test(body?.requestId || "")) return fail("Identificativo richiesta non valido.", 400);
  return callActorCard(env, context, "create", body.requestId);
}

// One coordinator per actor. Its alarm can finish the automatic card after the browser closes.
export class ActorCardGeneration {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }
  async fetch(request) {
    const {context, id} = await request.json(), action = new URL(request.url).pathname.slice(1);
    if (action === "queue-confirm" || action === "confirm") return this.confirm(id, action === "queue-confirm");
    return this.state.blockConcurrencyWhile(async () => {
      const job = await this.storage.get("latest");
      if (action === "latest") return reply({enabled:Boolean(this.env.OPENAI_API_KEY), job:publicJob(job) || null});
      if (action === "preview") {
        if (id !== job?.id || !["ready","accepted"].includes(job.status)) return fail("Anteprima della card non disponibile.", 409);
        const image = await this.env.MEDIA_BUCKET.get(previewKey(job));
        return image ? new Response(image.body, {headers:{"Content-Type":"image/webp","Cache-Control":"private, no-store"}}) : fail("Anteprima non trovata.", 404);
      }
      const automatic = action === "ensure";
      if (!automatic && action !== "create") return fail("Operazione non supportata.", 405);
      if (!this.env.OPENAI_API_KEY) return fail("Generazione immagini non attiva.", 503);
      if (id === job?.id) return reply({job:publicJob(job)});
      const previousId = await this.storage.get("request:" + id);
      if (previousId) return previousId === job?.id ? reply({job:publicJob(job)}) : fail("Questa richiesta è già stata elaborata.", 409);
      if (job?.status === "applying") {
        await this.storage.put("request:" + id, job.id);
        return reply({job:publicJob(job)});
      }
      const actor = await this.readActor(context);
      if (!actor?.name) return fail("Personaggio non trovato.", 404);
      if (automatic && actor.media?.card?.path) return reply({present:true});
      const reference = await cardAvatarReference(actor, context.campaignId, this.env.MEDIA_BUCKET);
      if (!reference) return fail(missingAvatar, 409);
      const canReuse = job && matchesCardSource(job, actor) && (
        (job.referenceKey === reference.referenceKey && job.referenceEtag === reference.referenceEtag)
        || (job.status === "pending" && !job.referenceKey)
      );
      if (active(job) || (automatic && job?.status === "ready" && canReuse)) {
        await this.storage.transaction(async tx => {
          await tx.put("request:" + id, job.id);
          if (automatic && canReuse) {
            job.automatic = true;
            if (job.status === "ready") {
              job.status = "applying";
              job.saveAttempts = 0;
              await tx.setAlarm(Date.now() + 100);
            }
            await tx.put("latest", job);
          }
        });
        return reply({job:publicJob(job)});
      }
      const next = {id, context, name:actor.name, baseline:fingerprint(actor.media?.card), ...reference, automatic, status:"pending"};
      await this.storage.transaction(async tx => {
        await tx.put("latest", next);
        await tx.put("request:" + id, next.id);
        await tx.setAlarm(Date.now() + 100);
      });
      return reply({job:publicJob(next)}, 202);
    });
  }
  async confirm(id, background) {
    const job = await this.storage.transaction(async tx => {
      const current = await tx.get("latest");
      if (!current || current.id !== id) return null;
      if (current.status !== "ready") return current;
      const next = {...current, status:"applying", saveAttempts:0, error:""};
      await tx.put("latest", next);
      await tx.setAlarm(Date.now() + (background ? 100 : 60000));
      return next;
    });
    if (job?.status === "accepted") return this.saveCard(job, previewKey(job));
    if (job?.status !== "applying") return fail(job?.error || "Anteprima della card non disponibile.", 409);
    if (background || this.savingId === id) return reply({ok:true, job:publicJob(job)}, 202);
    return this.apply(job);
  }
  async apply(job) {
    this.savingId = job.id;
    try {
      return await this.finishApply(job);
    } finally {
      this.savingId = null;
    }
  }
  async finishApply(job) {
    let result;
    try {
      result = await this.saveCard(job, previewKey(job));
    } catch {
      result = fail("Salvataggio della card temporaneamente non disponibile.", 503);
    }
    if (result.ok) {
      job.status = "accepted";
      job.error = "";
    } else if ([404, 409].includes(result.status) && (await result.clone().json()).code === "CARD_SOURCE_CHANGED") {
      job.status = "superseded";
      job.error = "Il nome, l’avatar o la card sono cambiati dalla generazione.";
    } else if (job.status === "applying" && (result.status === 409 || result.status >= 500) && (job.saveAttempts || 0) < 3) {
      job.saveAttempts = (job.saveAttempts || 0) + 1;
      await this.storage.transaction(async tx => {
        await tx.put("latest", job);
        await tx.setAlarm(Date.now() + job.saveAttempts * 3000);
      });
      return result;
    } else {
      // The paid image is safe in R2. A confirmation can retry just the save.
      job.status = "ready";
      job.error = "Card pronta. Premi «Applica card» per riprovare il salvataggio.";
    }
    await this.storage.put("latest", job);
    return result;
  }
  async alarm() {
    const job = await this.storage.get("latest");
    if (!active(job)) return;
    if (job.status === "applying") {
      // Keep status requests responsive during R2 copy and D1 commit. A synchronous
      // confirmation from an older client may already be saving this proposal.
      if (this.savingId === job.id) await this.storage.setAlarm(Date.now() + 10000);
      else await this.apply(job);
      return;
    }
    const key = previewKey(job);
    try {
      if (!await this.env.MEDIA_BUCKET.head(key)) {
        if (job.status === "running") throw new Error("La richiesta precedente si è interrotta. Puoi avviare una nuova generazione.");
        const actor = await this.readActor(job.context);
        if (!matchesCardSource(job, actor)) {
          await this.storage.put("latest", {...job,status:"superseded",error:"Il nome, l’avatar o la card sono cambiati prima della generazione."});
          return;
        }
        // Requests queued before avatars became required pick up the saved avatar before spending.
        if (!job.referenceKey) {
          const reference = await cardAvatarReference(actor, job.context.campaignId, this.env.MEDIA_BUCKET);
          if (!reference) throw new Error(missingAvatar);
          Object.assign(job, reference);
        }
        const avatar = await npcVisualReferenceInput(job, this.env);
        job.status = "running";
        await this.storage.transaction(async tx => {
          // An icon request may have adopted a manual proposal during the source check.
          job.automatic = (await tx.get("latest")).automatic;
          await tx.put("latest", job);
          await tx.setAlarm(Date.now() + GENERATION_WAIT_MS);
        });
        const response = await fetch("https://api.openai.com/v1/images/edits", {
          method:"POST", headers:{Authorization:`Bearer ${this.env.OPENAI_API_KEY}`, "Content-Type":"application/json"},
          signal:AbortSignal.timeout(12 * 60 * 1000),
          body:JSON.stringify({model:AVATAR_MODEL, quality:"xhigh", size:`${CARD_WIDTH}x${CARD_HEIGHT}`, n:1, output_format:"webp",
            images:[{image_url:avatar.image_url}], prompt:cardPrompt(job.name)})
        });
        if (!response.ok) throw new Error(`Il servizio immagini ha rifiutato la richiesta (HTTP ${response.status}).`);
        const encoded = (await response.json()).data?.[0]?.b64_json;
        if (!encoded || encoded.length > 16 * 1024 * 1024) throw new Error("Risultato immagine non valido.");
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), size = webpSize(bytes);
        if (size?.width !== CARD_WIDTH || size?.height !== CARD_HEIGHT) throw new Error(`La card ricevuta non è un WebP di ${CARD_WIDTH} × ${CARD_HEIGHT} px.`);
        await this.env.MEDIA_BUCKET.put(key, bytes, {httpMetadata:{contentType:"image/webp"}});
      }
    } catch (error) {
      await this.storage.put("latest", {...job,status:"failed",error:error.message});
      return;
    }
    await this.state.blockConcurrencyWhile(async () => {
      const current = await this.storage.get("latest");
      if (current.id !== job.id) return;
      current.status = current.automatic ? "applying" : "ready";
      await this.storage.transaction(async tx => {
        await tx.put("latest", current);
        if (current.automatic) await tx.setAlarm(Date.now() + 100);
        else await tx.deleteAlarm();
      });
    });
  }
}
