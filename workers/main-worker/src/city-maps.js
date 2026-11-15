import { webpSize } from "./avatar-generation.js";
import { normalizeMapFrame } from "./foundry-maps.js";

const ID = /^[a-z0-9_-]{1,96}$/i;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 3072;
const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const cityText = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const isId = value => typeof value === "string" && ID.test(value);
const scene = (worldId, sceneId) => ({ worldId, sceneId });

export async function handleCityMaps(request, campaign, env, services, corsHeaders = {}) {
  const headers = { ...corsHeaders, ...PRIVATE };
  const json = (data, status = 200) => Response.json(data, { status, headers });
  const abort = (status, error) => { throw json({ ok: false, error }, status); };
  const missing = () => abort(404, "Contenuto della mappa non disponibile.");
  const conflict = () => abort(409, "I dati sono cambiati. Ricarica la mappa e riprova.");
  const url = new URL(request.url);
  const parts = url.pathname.split("/").slice(3);
  const [mapId, section, pointId, action, noteId] = parts;
  const { method } = request;
  const { POLL_DB: db, MEDIA_BUCKET: media } = env;
  const query = (sql, ...values) => db.prepare(sql).bind(campaign, ...values);
  const readMap = id => query("SELECT * FROM city_maps WHERE campaign_id = ? AND id = ?", id).first();
  const readJob = id => query("SELECT * FROM city_map_scene_jobs WHERE campaign_id = ? AND id = ?", id).first();
  const findJob = id => query("SELECT * FROM city_map_scene_jobs WHERE campaign_id = ? AND map_id = ?", id).first();
  const readSnapshot = (worldId, sceneId) => query("SELECT * FROM foundry_map_snapshots WHERE campaign_id = ? AND world_id = ? AND scene_id = ?", worldId, sceneId).first();
  const findByScene = (worldId, sceneId, includePending = false) => query(
    "SELECT m.id, m.published FROM city_maps m WHERE m.campaign_id = ? AND ((m.source_world = ? AND m.source_scene = ?) OR EXISTS (SELECT 1 FROM city_map_scene_jobs j WHERE j.campaign_id = m.campaign_id AND j.map_id = m.id AND j.world_id = ? AND j.scene_id = ? AND (j.completed = 1 OR ? = 1))) ORDER BY m.image_key IS NULL LIMIT 1",
    worldId, sceneId, worldId, sceneId, Number(includePending)).first();
  const requireRevision = (row, data) => {
    if (data.revision !== row.revision) conflict();
  };
  const checkWrite = async statement => {
    if ((await statement.run()).meta.changes !== 1) conflict();
  };
  const readJson = async () => {
    if (Number(request.headers.get("Content-Length")) > 16384) abort(413, "Dati troppo grandi.");
    const body = await request.text();
    if (body.length > 16384) abort(413, "Dati troppo grandi.");
    let parsed;
    try { parsed = JSON.parse(body); } catch { abort(400, "Dati della mappa non validi."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) abort(400, "Dati della mappa non validi.");
    return parsed;
  };
  const imageResponse = object => {
    if (!object) abort(503, "Immagine temporaneamente non disponibile.");
    return new Response(object.body, { headers: { ...headers, "Content-Type": "image/webp" } });
  };
  const snapshotFrame = object => normalizeMapFrame(object?.customMetadata?.frame);
  const isAligned = (map, snapshot, object) => Boolean(snapshot && object &&
    (map.source_revision === snapshot.revision || (map.source_frame && map.source_frame === snapshotFrame(object))));
  const listMap = row => ({ id: row.id, title: row.title, published: Boolean(row.published) });
  const jobResult = row => row && ({
    id: row.id, mapId: row.map_id, worldId: row.world_id, completed: Boolean(row.completed),
    ...(row.completed ? { sceneId: row.scene_id } : {}),
  });

  try {
    const user = await services.requireUser(request);
    if (user instanceof Response) return user;
    const account = services.accountId(user);
    const editor = await services.isEditor(user, campaign);
    const preview = editor && method === "GET" && url.searchParams.get("view") === "player";
    const editView = editor && !preview;
    if (!account || (!editor && !await services.canReadPlayer(user, campaign))) abort(403, "Mappe riservate al gruppo della campagna.");
    if (!db || !media) abort(503, "Mappe della città non configurate.");
    if (parts.some(part => !isId(part))) missing();
    const requireEditor = () => { if (!editor) abort(403, "Operazione riservata al DM."); };
    const readVisibleMap = async id => {
      const map = await readMap(id);
      if (!map || (!editor && !map.published)) missing();
      return map;
    };

    if (!parts.length && method === "GET") {
      const { results } = await query("SELECT id, title, published FROM city_maps WHERE campaign_id = ? AND (published = 1 OR ? = 1) ORDER BY title, id", Number(editView)).all();
      return json({ maps: results.map(listMap), canEdit: editView });
    }

    if (!parts.length && method === "POST") {
      requireEditor();
      const id = crypto.randomUUID();
      if (request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) {
        if (Number(request.headers.get("Content-Length")) > MAX_BYTES + 8192) abort(413, "Sfondo troppo grande.");
        let form;
        try { form = await request.formData(); } catch { abort(400, "Caricamento dello sfondo non valido."); }
        const title = cityText(form.get("title"), 120);
        const locationId = cityText(form.get("locationId"), 96);
        const file = form.get("image");
        if (!title || (locationId && !isId(locationId))) abort(400, "Controlla il titolo e il luogo.");
        if (!(file instanceof File) || file.type !== "image/webp" || !file.size || file.size > MAX_BYTES) abort(400, "Serve uno sfondo WebP fino a 4 MB.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const size = webpSize(bytes);
        if (!size || size.width < 1 || size.height < 1 || size.width > MAX_EDGE || size.height > MAX_EDGE) {
          abort(400, "Lo sfondo deve avere un lato lungo di al massimo 3072 pixel.");
        }
        const key = "_private/city-maps/" + campaign + "/" + id + "/background.webp";
        await media.put(key, bytes, { httpMetadata: { contentType: "image/webp" } });
        try {
          await query("INSERT INTO city_maps (campaign_id, id, title, location_id, image_key, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, title, locationId, key, size.width, size.height).run();
        } catch (error) {
          const stored = await readMap(id).catch(() => undefined);
          if (stored === null) await media.delete(key).catch(() => {});
          if (!stored) throw error;
        }
        return json({ id }, 201);
      }
      const data = await readJson();
      if (!isId(data.worldId) || !isId(data.sceneId)) abort(400, "Scegli una scena Foundry pubblicata.");
      const existing = await findByScene(data.worldId, data.sceneId, true);
      if (existing) return json({ id: existing.id });
      const snapshot = await readSnapshot(data.worldId, data.sceneId);
      if (!snapshot) missing();
      const source = await media.head(snapshot.player_key);
      if (!source) abort(503, "Lo sfondo Foundry è temporaneamente non disponibile.");
      const locationId = cityText(data.locationId, 96);
      if (locationId && !isId(locationId)) abort(400, "Luogo non valido.");
      await query("INSERT INTO city_maps (campaign_id, id, title, location_id, source_world, source_scene, source_revision, source_frame) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(campaign_id, source_world, source_scene) DO NOTHING",
        id, cityText(data.title, 120) || snapshot.title, locationId, data.worldId, data.sceneId, snapshot.revision, snapshotFrame(source)).run();
      const map = await query("SELECT id FROM city_maps WHERE campaign_id = ? AND source_world = ? AND source_scene = ?", data.worldId, data.sceneId).first();
      return json({ id: map.id }, map.id === id ? 201 : 200);
    }

    if (mapId === "by-scene" && parts.length === 3 && method === "GET") {
      const map = await findByScene(section, pointId);
      if (!map || (!editor && !map.published)) missing();
      return json({ id: map.id });
    }

    if (mapId === "worlds" && parts.length === 1 && method === "GET") {
      requireEditor();
      const { results } = await query("SELECT DISTINCT world_id AS id FROM foundry_map_snapshots WHERE campaign_id = ? ORDER BY world_id").all();
      return json({ worlds: results.map(row => row.id) });
    }

    if (mapId === "scene-imports") {
      requireEditor();
      const world = url.searchParams.get("world");
      if (!isId(world)) abort(400, "Mondo Foundry non valido.");
      if (parts.length === 1 && method === "GET") {
        const { results } = await query("SELECT j.id, j.scene_id, m.title, m.width, m.height FROM city_map_scene_jobs j JOIN city_maps m ON m.campaign_id = j.campaign_id AND m.id = j.map_id WHERE j.campaign_id = ? AND j.world_id = ? AND j.completed = 0 ORDER BY m.title",
          world).all();
        return json({ jobs: results.map(row => ({ id: row.id, sceneId: row.scene_id, title: row.title, width: row.width, height: row.height })) });
      }
      if (parts.length !== 3) missing();
      const job = await readJob(section);
      if (!job || job.world_id !== world) missing();
      if (pointId === "image" && method === "GET") {
        const map = await readMap(job.map_id);
        return imageResponse(await media.get(map.image_key));
      }
      if (pointId === "complete" && method === "POST") {
        const data = await readJson();
        if (data.sceneId !== job.scene_id) abort(400, "Identificativo scena non corrispondente alla richiesta.");
        await query("UPDATE city_map_scene_jobs SET completed = 1 WHERE campaign_id = ? AND id = ? AND world_id = ?", job.id, world).run();
        return json({ job: jobResult({ ...job, completed: 1 }) });
      }
      missing();
    }

    if (!mapId) missing();
    const map = await readVisibleMap(mapId);
    const readSource = () => map.source_world ? readSnapshot(map.source_world, map.source_scene) : null;
    if (parts.length === 1 && method === "GET") {
      const snapshot = await readSource();
      const alignmentNeeded = Boolean(map.source_world && !isAligned(map, snapshot, snapshot && await media.head(snapshot.player_key)));
      const { results } = await query("SELECT * FROM city_map_points WHERE campaign_id = ? AND map_id = ? AND (revealed = 1 OR ? = 1) ORDER BY title, id", map.id, Number(editView)).all();
      const points = results.map(row => ({
        id: row.id, title: row.title, description: row.description, locationId: row.location_id,
        x: row.x, y: row.y, revealed: Boolean(row.revealed), revision: row.revision,
        detail: row.detail_world && (editView || row.detail_shared) ? scene(row.detail_world, row.detail_scene) : null,
        detailShared: Boolean(row.detail_world && row.detail_shared),
      }));
      return json({
        map: {
          ...listMap(map), locationId: map.location_id, revision: map.revision, alignmentNeeded,
          ...(editView ? {
            source: map.source_world ? scene(map.source_world, map.source_scene) : null,
            sourceRevision: snapshot?.revision ?? null,
            job: jobResult(await findJob(map.id)),
          } : {}),
        },
        canEdit: editView, preview,
        points: alignmentNeeded && !editView ? [] : points,
      });
    }
    if (section === "image" && parts.length === 2 && method === "GET") {
      if (map.image_key) return imageResponse(await media.get(map.image_key));
      const snapshot = await readSource();
      if (!snapshot) missing();
      if (!editView && url.searchParams.get("view") === "dm") abort(403, "Vista riservata al DM.");
      const dm = editView && url.searchParams.get("view") === "dm";
      const object = await media.get(dm ? snapshot.dm_key : snapshot.player_key);
      if (!editView && !isAligned(map, snapshot, object)) abort(409, "Le coordinate della mappa sono in revisione.");
      if (editView && !dm && !isAligned(map, snapshot, object)
        && url.searchParams.get("review") !== snapshot.revision) abort(409, "Controlla l’allineamento della nuova immagine.");
      return imageResponse(object);
    }
    if (section === "align" && parts.length === 2 && method === "POST") {
      requireEditor();
      const data = await readJson();
      requireRevision(map, data);
      const snapshot = await readSource();
      if (!snapshot || snapshot.revision !== data.sourceRevision) conflict();
      const source = await media.head(snapshot.player_key);
      if (!source) abort(503, "Sfondo Foundry temporaneamente non disponibile.");
      await checkWrite(query("UPDATE city_maps SET source_revision = ?2, source_frame = ?3, revision = revision + 1 WHERE campaign_id = ?1 AND id = ?4 AND revision = ?5",
        snapshot.revision, snapshotFrame(source), map.id, map.revision));
      return json({ ok: true });
    }
    if (!section && method === "PUT") {
      requireEditor();
      const data = await readJson();
      requireRevision(map, data);
      const title = cityText(data.title, 120);
      const locationId = cityText(data.locationId, 96);
      if (!title || (locationId && !isId(locationId)) || typeof data.published !== "boolean") abort(400, "Controlla i dati della mappa.");
      await checkWrite(query("UPDATE city_maps SET title = ?2, location_id = ?3, published = ?4, revision = revision + 1 WHERE campaign_id = ?1 AND id = ?5 AND revision = ?6",
        title, locationId, Number(data.published), map.id, map.revision));
      return json({ ok: true });
    }
    if (section === "import" && parts.length === 2 && method === "POST") {
      requireEditor();
      if (!map.image_key) abort(400, "La mappa è già collegata a una scena Foundry.");
      const data = await readJson();
      if (!isId(data.worldId)) abort(400, "Inserisci l’identificativo del mondo Foundry.");
      const id = crypto.randomUUID();
      const sceneId = id.replaceAll("-", "").slice(0, 16);
      await query("INSERT INTO city_map_scene_jobs (campaign_id, map_id, id, world_id, scene_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(campaign_id, map_id) DO NOTHING",
        map.id, id, data.worldId, sceneId).run();
      const job = await findJob(map.id);
      if (job.world_id !== data.worldId) abort(409, "La mappa è già destinata a un altro mondo.");
      return json({ job: jobResult(job) }, job.id === id ? 201 : 200);
    }

    if (section !== "points") missing();
    if ((parts.length === 2 && method === "POST") || (parts.length === 3 && method === "PUT")) {
      requireEditor();
      const data = await readJson();
      const title = cityText(data.title, 120);
      const locationId = cityText(data.locationId, 96);
      if (!title || (locationId && !isId(locationId)) || ![data.x, data.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) abort(400, "Controlla titolo e posizione del punto.");
      const detail = data.detail;
      if (detail && (!isId(detail.worldId) || !isId(detail.sceneId) || !await readSnapshot(detail.worldId, detail.sceneId))) abort(400, "Scegli una scena pubblicata in questa campagna.");
      const values = [title, cityText(data.description, 4000), locationId, data.x, data.y, Number(data.revealed === true),
        detail?.worldId ?? null, detail?.sceneId ?? null, Number(Boolean(detail) && data.detailShared === true)];
      if (pointId) {
        await checkWrite(query("UPDATE city_map_points SET title = ?4, description = ?5, location_id = ?6, x = ?7, y = ?8, revealed = ?9, detail_world = ?10, detail_scene = ?11, detail_shared = ?12, revision = revision + 1 WHERE campaign_id = ?1 AND map_id = ?2 AND id = ?3 AND revision = ?13",
          map.id, pointId, ...values, data.revision ?? 0));
        return json({ id: pointId });
      }
      const id = crypto.randomUUID();
      await query("INSERT INTO city_map_points (campaign_id, map_id, id, title, description, location_id, x, y, revealed, detail_world, detail_scene, detail_shared) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        map.id, id, ...values).run();
      return json({ id }, 201);
    }
    if (action !== "notes" || parts.length > 5) missing();
    const point = await query("SELECT revealed FROM city_map_points WHERE campaign_id = ? AND map_id = ? AND id = ?", map.id, pointId).first();
    if (!point || (!editView && !point.revealed)) missing();
    if (!noteId && method === "GET") {
      const { results } = await query("SELECT * FROM city_map_notes WHERE campaign_id = ? AND map_id = ? AND point_id = ? AND (audience = 'group' OR (audience = 'personal' AND author_id = ? AND ? = 0) OR (audience = 'dm' AND ? = 1)) ORDER BY created_at, id",
        map.id, pointId, account, Number(preview), Number(editView)).all();
      return json({ notes: results.map(row => ({
        id: row.id, audience: row.audience, author: row.author_name, text: row.text, createdAt: row.created_at, revision: row.revision,
        canEdit: !preview && account === row.author_id,
        canDelete: !preview && (account === row.author_id || (editView && row.audience === "group")),
      })) });
    }
    const existing = noteId ? await query("SELECT * FROM city_map_notes WHERE campaign_id = ? AND map_id = ? AND point_id = ? AND id = ?", map.id, pointId, noteId).first() : null;
    if (noteId && (!existing || (existing.author_id !== account && !(editor && existing.audience === "group" && method === "DELETE")))) missing();
    const data = await readJson();
    if (existing) requireRevision(existing, data);
    if (noteId && method === "DELETE") {
      await checkWrite(query("DELETE FROM city_map_notes WHERE campaign_id = ? AND map_id = ? AND point_id = ? AND id = ? AND revision = ?",
        map.id, pointId, noteId, existing.revision));
      return json({ ok: true });
    }
    if ((!noteId && method === "POST") || (noteId && method === "PUT")) {
      const content = cityText(data.text, 4000);
      if (!content || !["personal", "group", ...(editor ? ["dm"] : [])].includes(data.audience)) abort(400, "Testo o visibilità della nota non validi.");
      if (existing) {
        await checkWrite(query("UPDATE city_map_notes SET text = ?5, audience = ?6, revision = revision + 1 WHERE campaign_id = ?1 AND map_id = ?2 AND point_id = ?3 AND id = ?4 AND revision = ?7",
          map.id, pointId, noteId, content, data.audience, existing.revision));
        return json({ id: noteId });
      }
      const id = crypto.randomUUID();
      await query("INSERT INTO city_map_notes (campaign_id, map_id, point_id, id, author_id, author_name, audience, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          map.id, pointId, id, account, cityText(user.global_name || user.username || user.displayName, 100) || (editor ? "DM" : "Giocatore"),
        data.audience, content, new Date().toISOString()).run();
      return json({ id }, 201);
    }
    missing();
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("City maps request failed", error);
    return json({ ok: false, error: "Mappe della città temporaneamente non disponibili." }, 503);
  }
}
