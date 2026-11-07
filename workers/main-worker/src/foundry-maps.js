import { webpSize } from "./avatar-generation.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 3072;
const idPattern = /^[a-z0-9_-]{1,96}$/i;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const selectRow = "SELECT * FROM foundry_map_snapshots WHERE campaign_id = ? AND world_id = ? AND scene_id = ?";

export async function handleFoundryMaps(request, campaignId, env, services, corsHeaders) {
  const headers = { ...corsHeaders, ...privateHeaders };
  const json = (data, status = 200) => Response.json(data, { status, headers });
  const fail = (error, status) => json({ ok: false, error }, status);
  const url = new URL(request.url);
  const parts = url.pathname.split("/").slice(3);
  if (parts.length && (parts.length !== 2 || !parts.every(id => idPattern.test(id)))) return fail("Scena non valida.", 400);
  if (!env.POLL_DB || !env.MEDIA_BUCKET) return fail("Mappe Foundry non configurate.", 503);
  const db = env.POLL_DB;
  const media = env.MEDIA_BUCKET;
  const row = () => db.prepare(selectRow).bind(campaignId, ...parts).first();

  if (request.method === "GET") {
    const user = await services.requireUser(request);
    if (user instanceof Response) return user;
    const editor = await services.isEditor(user, campaignId);
    if (!editor && !await services.canReadPlayer(user, campaignId)) return fail("Mappe riservate ai giocatori di questa campagna.", 403);
    if (!parts.length) {
      const { results } = await db.prepare(`SELECT world_id AS worldId, scene_id AS sceneId, title, updated_at AS updatedAt
        FROM foundry_map_snapshots WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT 200`).bind(campaignId).all();
      return json({ ok: true, maps: results, canReadDm: editor });
    }
    const dm = url.searchParams.get("view") === "dm";
    if (dm && !editor) return fail("Vista riservata al DM.", 403);
    const entry = await row();
    if (!entry) return fail("Mappa non pubblicata.", 404);
    let object = await media.get(dm ? entry.dm_key : entry.player_key);
    // A publish may replace the previous image while this request is in flight.
    if (!object) {
      const current = await row();
      if (current && current.revision !== entry.revision) object = await media.get(dm ? current.dm_key : current.player_key);
    }
    return object ? new Response(object.body, { headers: { ...headers, "Content-Type": "image/webp" } })
      : fail("Immagine temporaneamente non disponibile.", 503);
  }

  if (request.method !== "POST" || parts.length !== 2) return fail("Operazione non disponibile.", 405);
  if (!services.isFoundry(request)) {
    const user = await services.requireUser(request);
    if (user instanceof Response) return user;
    if (!await services.isEditor(user, campaignId)) return fail("Solo il DM può pubblicare mappe.", 403);
  }
  if (Number(request.headers.get("Content-Length")) > MAX_IMAGE_BYTES * 2 + 8192) return fail("Immagini troppo grandi.", 413);
  let form;
  try { form = await request.formData(); } catch { return fail("Esportazione non valida.", 400); }
  const title = typeof form.get("title") === "string" ? form.get("title").trim().slice(0, 120) : "";
  if (!title) return fail("Inserisci il titolo della mappa.", 400);
  const player = await readImage(form.get("player"));
  const dmFile = form.get("dm");
  const dm = dmFile ? await readImage(dmFile) : player;
  if (!player || !dm || player.width !== dm.width || player.height !== dm.height) {
    return fail("Servono immagini WebP valide, della stessa dimensione, fino a 4 MB ciascuna.", 400);
  }
  const previous = await row();
  if (previous?.player_hash === player.hash && previous.dm_hash === dm.hash && previous.title === title) {
    return json({ ok: true, unchanged: true, revision: previous.revision });
  }
  const revision = crypto.randomUUID();
  const prefix = `_private/foundry-maps/${campaignId}/${parts.join("/")}/${revision}`;
  const playerKey = prefix + "/players.webp";
  const dmKey = player.hash === dm.hash ? playerKey : prefix + "/dm.webp";
  const options = { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" } };
  const newKeys = [...new Set([playerKey, dmKey])];
  try {
    await media.put(playerKey, player.bytes, options);
    if (dmKey !== playerKey) await media.put(dmKey, dm.bytes, options);
  } catch (error) {
    await media.delete(newKeys).catch(() => {});
    throw error;
  }
  const result = await db.prepare(`INSERT INTO foundry_map_snapshots
    (campaign_id, world_id, scene_id, title, revision, updated_at, player_key, dm_key, player_hash, dm_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (campaign_id, world_id, scene_id) DO UPDATE SET
    title = excluded.title, revision = excluded.revision, updated_at = excluded.updated_at,
    player_key = excluded.player_key, dm_key = excluded.dm_key,
    player_hash = excluded.player_hash, dm_hash = excluded.dm_hash
    WHERE foundry_map_snapshots.revision = ?`)
    .bind(campaignId, ...parts, title, revision, new Date().toISOString(), playerKey, dmKey, player.hash, dm.hash, previous?.revision ?? "")
    .run();
  if (result.meta.changes !== 1) {
    await media.delete(newKeys).catch(() => {});
    return fail("La mappa è stata aggiornata da un’altra pubblicazione. Riprova.", 409);
  }
  if (previous) await media.delete([...new Set([previous.player_key, previous.dm_key])]).catch(() => {});
  return json({ ok: true, revision });
}

async function readImage(file) {
  if (!(file instanceof File) || file.type !== "image/webp" || !file.size || file.size > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = webpSize(bytes);
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_EDGE || size.height > MAX_EDGE) return null;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { bytes, hash, ...size };
}
