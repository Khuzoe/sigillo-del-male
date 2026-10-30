// The model and base style are fixed; quality and resolution use a server-owned allowlist.
export const AVATAR_STYLE = "Stylized painterly realism, hand-painted surfaces, textured brush strokes, cinematic character portrait, realistic facial structure, expressive eyes, sophisticated color harmony, dramatic rim lighting, soft global illumination, atmospheric perspective, muted but rich color palette, detailed clothing folds, subtle skin texture, realistic lighting behavior, concept art and illustration hybrid, emotional mood, high production animated series quality, visually rich yet grounded, artistic rendering rather than photorealism, masterfully painted 3D look. fullbody. new pose. 9:16";
export const AVATAR_MODEL = "gpt-image-2.5-sunburst";
export const AVATAR_RESOLUTIONS = Object.freeze({ medium: { width: 864, height: 1536 }, high: { width: 1296, height: 2304 } });
export function avatarGenerationOptions(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const quality = input.quality ?? "high", resolution = input.resolution ?? "high";
  if (!["medium", "high"].includes(quality) || !["medium", "high"].includes(resolution)) return null;
  return { quality, resolution };
}
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const PRIVATE_PREFIX = "_private/ai-avatars/";
const reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const failure = (message, status = 400) => reply({ ok: false, error: message }, status);
const identity = (c) => `${c.campaignId}:${c.worldId}:${c.actorId}`;
const fingerprint = (avatar) => JSON.stringify([normalizeGeneratedAvatarPath(avatar?.path), avatar?.revision || 0, avatar?.hash || ""]);
const publicJob = (job) => job ? ({ id: job.id, status: job.status, details: job.details, options: avatarGenerationOptions(job.options), error: job.error || "", createdAt: job.createdAt }) : null;

// Early confirmations stored the R2 key instead of the site's media path.
// Normalize only those generated assets; never reinterpret arbitrary campaign files.
export function normalizeGeneratedAvatarPath(value) {
  const path = String(value || "").trim();
  return /^campaigns\/[a-z0-9_-]+\/managed-actors\/[a-z0-9_-]+\/[a-z0-9_-]+\/base\/avatar-ai-[a-f0-9-]{36}\.webp$/i.test(path) ? `media/${path}` : path;
}
export function normalizeGeneratedAvatarDocument(actor) {
  const previous = actor?.media?.avatar?.path;
  const path = normalizeGeneratedAvatarPath(previous);
  if (!previous || path === previous) return actor;
  return { ...actor, media: { ...actor.media, avatar: { ...actor.media.avatar, path } } };
}

export function avatarReferenceKey(path, campaignId) {
  let key = String(path || "").trim();
  try {
    if (/^https?:\/\//i.test(key)) key = new URL(key).pathname;
    key = decodeURIComponent(key).replace(/^\/+/, "").replace(/^media\//, "").split(/[?#]/)[0];
  } catch { return ""; }
  // Only read an existing R2 object. Never fetch a client-provided or external URL.
  if (key.includes("..") || key.length > 260 || !/\.(webp|png|jpe?g)$/i.test(key)) return "";
  if (key.startsWith(`campaigns/${campaignId}/`)) return key;
  // Legacy site paths resolve to the original campaign's R2 prefix, like /media/.
  if (campaignId === "cripta-di-sangue" && /^(npcs|players|avatars|managed-actors|characters|creatures|bestiary|companions)\//.test(key)) return `campaigns/${campaignId}/${key}`;
  return "";
}

export async function handleAvatarGeneration(request, route, campaignId, env, services) {
  const user = await services.requireUser(request);
  if (user instanceof Response) return user;
  if (!await services.isEditor(user, campaignId)) return failure("Solo il DM della campagna o l’admin può generare avatar.", 403);
  if (!env.AVATAR_GENERATOR || !env.MEDIA_BUCKET) return failure("Generazione avatar non ancora configurata.", 503);
  const actor = await services.readActor(campaignId, route);
  if (!actor || actor.actorType !== "npc") return failure("NPC non trovato.", 404);
  const stub = env.AVATAR_GENERATOR.get(env.AVATAR_GENERATOR.idFromName("avatar-generations-v1"));
  const context = { campaignId, worldId: route.worldId, actorId: route.actorId };
  const call = (action, data = {}) => stub.fetch(new Request(`https://avatar.internal/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, context }),
  }));
  if (request.method === "GET" && !route.action) {
    const result = await call("latest");
    const payload = await result.json();
    return reply({ ...payload, enabled: Boolean(env.OPENAI_API_KEY), optionsVersion: 1, style: AVATAR_STYLE }, result.status);
  }
  if (request.method === "GET" && route.action === "preview") return call("preview", { id: route.jobId });
  if (request.method !== "POST") return failure("Operazione non supportata.", 405);
  let body;
  try {
    const text = await request.text();
    if (text.length > 6000) return failure("Richiesta troppo lunga.", 413);
    body = JSON.parse(text);
  } catch { return failure("Richiesta non valida."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Richiesta non valida.");
  if (!route.action) {
    if (!env.OPENAI_API_KEY) return failure("Il generatore deve essere attivato dall’amministratore.", 503);
    if (!/^[a-f0-9-]{36}$/i.test(body.requestId || "")) return failure("Identificativo richiesta non valido.");
    if (typeof body.details !== "string" || body.details.length > 1500) return failure("La descrizione può contenere fino a 1500 caratteri.");
    const options = avatarGenerationOptions(body);
    if (!options) return failure("Scegli qualità e risoluzione media o alta.");
    const referenceKey = avatarReferenceKey(actor.media?.avatar?.path, campaignId);
    if (!referenceKey) return failure("Prima carica e salva l’avatar attuale sulla wiki: servirà come riferimento.");
    const reference = await env.MEDIA_BUCKET.head(referenceKey);
    if (!reference || reference.size > MAX_IMAGE_BYTES) return failure("Avatar di riferimento mancante o troppo grande (massimo 12 MB).");
    return call("create", { id: body.requestId, details: body.details.trim(), options, referenceKey, reference: actor.media.avatar });
  }
  if (route.action !== "confirm") return failure("Operazione non supportata.", 405);
  const result = await call("job", { id: route.jobId });
  if (!result.ok) return result;
  const { job } = await result.json();
  if (!["ready", "accepted"].includes(job.status)) return failure("L’anteprima non è ancora disponibile.", 409);
  const key = `campaigns/${campaignId}/managed-actors/${route.worldId}/${route.actorId}/base/avatar-ai-${job.id}.webp`;
  const path = `media/${key}`;
  // Repeating a confirmation after a lost response must not apply it twice.
  if (actor.media?.avatar?.path === path) {
    await call("accepted", { id: job.id });
    return reply({ ok: true, avatar: actor.media.avatar, revision: actor.revision });
  }
  const repairingLegacyPath = actor.media?.avatar?.path === key;
  if (!repairingLegacyPath && (job.status === "accepted" || fingerprint(actor.media?.avatar) !== fingerprint(job.reference))) {
    return failure("L’avatar è cambiato dopo la generazione. Riapri il generatore per usare il riferimento aggiornato.", 409);
  }
  const image = await env.MEDIA_BUCKET.get(`${PRIVATE_PREFIX}${job.id}.webp`);
  if (!image) return failure("Anteprima non disponibile.", 404);
  await env.MEDIA_BUCKET.put(key, image.body, { httpMetadata: { contentType: "image/webp" } });
  const avatar = { path, revision: Number(actor.media?.avatar?.revision || 0) + 1, source: "site", presentation: { x: 50, y: 50, scale: 1 } };
  const history = Array.isArray(actor.site?.avatarHistory) ? [...actor.site.avatarHistory] : [];
  if (!repairingLegacyPath && actor.media?.avatar?.path && !history.some((entry) => entry.path === actor.media.avatar.path)) history.push(actor.media.avatar);
  // Use the regular save pipeline for profile synchronization, media retention and Foundry notification.
  const saved = await services.saveActor({ ...actor, expectedRevision: actor.revision, media: { avatar }, site: { ...actor.site, avatarHistory: history } });
  if (!saved.ok) return saved;
  const savedPayload = await saved.json();
  await call("accepted", { id: job.id });
  return reply({ ok: true, avatar, revision: savedPayload.revision });
}

// A single coordinator bounds API usage across all campaigns. The alarm runs the paid
// request independently of the browser; its persisted running marker prevents paid retries.
export class AvatarGenerationStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async fetch(request) {
    const input = await request.json();
    return this.serial(() => this.handle(new URL(request.url).pathname.slice(1), input));
  }
  async handle(action, input) {
    const storage = this.state.storage;
    const scope = identity(input.context);
    const latest = await storage.get(`latest:${scope}`);
    const id = action === "latest" ? latest : input.id;
    const job = id ? await storage.get(`job:${id}`) : null;
    if (job && identity(job.context) !== scope) return failure("Anteprima non trovata.", 404);
    if (action === "latest") return reply({ ok: true, job: publicJob(job) });
    if (action === "create") {
      if (job) return reply({ ok: true, job: publicJob(job) });
      const previous = latest ? await storage.get(`job:${latest}`) : null;
      if (previous && ["pending", "running"].includes(previous.status)) return reply({ ok: true, job: publicJob(previous) });
      if (await storage.get("active")) return failure("È già in corso una generazione. Riprova tra qualche minuto.", 409);
      const month = new Date().toISOString().slice(0, 7);
      const used = Number(await storage.get(`usage:${month}`) || 0);
      const configuredLimit = Number(this.env.AVATAR_MONTHLY_LIMIT ?? 20);
      const limit = Number.isFinite(configuredLimit) ? Math.max(0, Math.floor(configuredLimit)) : 20;
      if (used >= limit) return failure("Limite mensile di generazioni raggiunto. Contatta l’amministratore.", 429);
      const next = { id: input.id, context: input.context, referenceKey: input.referenceKey, reference: input.reference, details: input.details, options: input.options, status: "pending", createdAt: new Date().toISOString() };
      // Transaction covers reservation, deduplication marker and alarm together.
      await storage.transaction(async (tx) => {
        await tx.put({ [`job:${next.id}`]: next, [`latest:${scope}`]: next.id, active: next.id, [`usage:${month}`]: used + 1 });
        await tx.setAlarm(Date.now() + 100);
      });
      return reply({ ok: true, job: publicJob(next) }, 202);
    }
    if (!job) return failure("Anteprima non trovata.", 404);
    if (action === "job") return reply({ ok: true, job });
    if (action === "accepted") {
      if (!["ready", "accepted"].includes(job.status)) return failure("Anteprima non disponibile.", 409);
      job.status = "accepted";
      await storage.put(`job:${job.id}`, job);
      return reply({ ok: true, job: publicJob(job) });
    }
    if (action === "preview" && ["ready", "accepted"].includes(job.status)) {
      const object = await this.env.MEDIA_BUCKET.get(`${PRIVATE_PREFIX}${job.id}.webp`);
      if (!object) return failure("Anteprima non trovata.", 404);
      return new Response(object.body, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return failure("Operazione non disponibile.", 409);
  }
  async alarm() {
    const job = await this.serial(async () => {
      const id = await this.state.storage.get("active");
      if (!id) return null;
      const current = await this.state.storage.get(`job:${id}`);
      if (!current) { await this.state.storage.delete("active"); return null; }
      if (current.status === "running") {
        current.status = "uncertain";
        current.error = "Generazione interrotta: esito non verificabile. Nessun nuovo tentativo automatico; controlla i consumi prima di rigenerare.";
        await this.state.storage.put(`job:${id}`, current);
        await this.state.storage.delete("active");
        return null;
      }
      if (current.status !== "pending") { await this.state.storage.delete("active"); return null; }
      current.status = "running";
      await this.state.storage.transaction(async (tx) => {
        await tx.put(`job:${id}`, current);
        await tx.setAlarm(Date.now() + 15 * 60 * 1000);
      });
      return current;
    });
    if (!job) return;
    let providerStarted = false;
    try {
      const options = avatarGenerationOptions(job.options);
      if (!options) throw new Error("Il servizio ha ricevuto impostazioni non valide.");
      const dimensions = AVATAR_RESOLUTIONS[options.resolution];
      const source = await this.env.MEDIA_BUCKET.get(job.referenceKey);
      if (!source || source.size > MAX_IMAGE_BYTES) throw new Error("Avatar di riferimento non disponibile.");
      const input = new Uint8Array(await source.arrayBuffer());
      const mime = /\.png$/i.test(job.referenceKey) ? "image/png" : /\.jpe?g$/i.test(job.referenceKey) ? "image/jpeg" : "image/webp";
      const prompt = `Reimagine the character in the reference image. Preserve recognizable identity, facial features, species and distinctive clothing. Show the entire body, including head and feet, in a new pose with breathing room. No text, labels, border or collage.\nAdditional character direction (must respect the mandatory style and composition): ${job.details || "None."}\nMandatory style and composition:\n${AVATAR_STYLE}`;
      providerStarted = true;
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(12 * 60 * 1000),
        body: JSON.stringify({ model: AVATAR_MODEL, images: [{ image_url: `data:${mime};base64,${encodeBase64(input)}` }], prompt, n: 1, size: `${dimensions.width}x${dimensions.height}`, quality: options.quality, output_format: "webp" }),
      });
      if (!response.ok) {
        // Do not expose provider payloads, prompts or credentials in browser errors/logs.
        job.status = response.status >= 500 ? "uncertain" : "failed";
        throw new Error(response.status === 429 ? "Servizio temporaneamente al limite. Riprova più tardi." : response.status === 401 || response.status === 403 ? "Il servizio immagini non è abilitato: contatta l’amministratore." : "Il servizio non ha completato la generazione. Nessun nuovo tentativo automatico.");
      }
      const payload = await response.json();
      const encoded = payload.data?.[0]?.b64_json;
      if (typeof encoded !== "string" || encoded.length > MAX_IMAGE_BYTES * 1.4) throw new Error("Risultato immagine non valido.");
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const size = webpSize(bytes);
      if (!size || size.width !== dimensions.width || size.height !== dimensions.height) throw new Error("Il servizio non ha restituito l’immagine nel formato verticale richiesto.");
      await this.env.MEDIA_BUCKET.put(`${PRIVATE_PREFIX}${job.id}.webp`, bytes, { httpMetadata: { contentType: "image/webp" } });
      job.status = "ready";
    } catch (error) {
      if (job.status === "running") job.status = providerStarted ? "uncertain" : "failed";
      job.error = error.name === "TimeoutError" || error.name === "AbortError"
        ? "La generazione ha superato il tempo disponibile. Nessun nuovo tentativo automatico; verifica i consumi prima di rigenerare."
        : (error.message?.startsWith("Il servizio") || error.message?.startsWith("Avatar") || error.message?.startsWith("Risultato") || error.message?.startsWith("Servizio") ? error.message : "Generazione interrotta. Nessun nuovo tentativo automatico.");
    }
    await this.serial(async () => {
      await this.state.storage.put(`job:${job.id}`, job);
      if (await this.state.storage.get("active") === job.id) {
        await this.state.storage.delete("active");
        await this.state.storage.deleteAlarm();
      }
    });
  }
}

function encodeBase64(bytes) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}

export function webpSize(bytes) {
  const text = (i, n) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 12; i + 8 <= bytes.length;) {
    const length = view.getUint32(i + 4, true), start = i + 8;
    if (start + length > bytes.length) return null;
    const type = text(i, 4);
    if (type === "VP8X" && length >= 10) return { width: 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16), height: 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16) };
    if (type === "VP8 " && length >= 10 && text(start + 3, 3) === "\x9d\x01\x2a") return { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff };
    if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
      const bits = view.getUint32(start + 1, true);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    i = start + length + (length % 2);
  }
  return null;
}
