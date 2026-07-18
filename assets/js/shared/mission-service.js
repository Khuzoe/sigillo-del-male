(() => {
  "use strict";
  const TYPE_LABELS = {
    main: "Principale",
    side: "Secondaria",
    personal: "Personale",
    faction: "Fazione"
  };
  const STATUS_LABELS = {
    draft: "Bozza",
    available: "Disponibile",
    active: "In corso",
    completed: "Completata",
    failed: "Fallita",
    archived: "Archiviata",
    pending: "Da iniziare",
    hidden: "Nascosta"
  };
  const VISIBILITY_LABELS = {
    public: "Tutti",
    players: "Giocatori",
    assigned: "Solo assegnatari",
    dm: "Solo DM"
  };
  const TYPE_OPTIONS = Object.entries(TYPE_LABELS);
  const MISSION_STATUS_OPTIONS = ["draft", "available", "active", "completed", "failed", "archived"].map((value) => [value, STATUS_LABELS[value]]);
  const OBJECTIVE_STATUS_OPTIONS = ["pending", "active", "completed", "failed", "hidden", "archived"].map((value) => [value, STATUS_LABELS[value]]);
  const VISIBILITY_OPTIONS = Object.entries(VISIBILITY_LABELS);
  function clone(value) {
    try {
      return structuredClone(value);
    } catch (_) {
      return JSON.parse(JSON.stringify(value ?? null));
    }
  }
  function slug(value, fallback = "missione") {
    const helper = window.CriptaApp?.utils?.slugify;
    if (typeof helper === "function") return helper(value, fallback);
    const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized || fallback;
  }
  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function stableId(prefix, seed) {
    return `${prefix}-${slug(seed, prefix).slice(0, 54)}-${stableHash(seed)}`;
  }
  function campaignId() {
    return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
  }
  function authToken() {
    return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "").trim();
  }
  async function fetchCampaignJson(pathname, fallback) {
    try {
      const payload = await window.CriptaApp.data.json(pathname, { cache: false });
      return payload;
    } catch (error) {
      console.warn(`Missioni: impossibile caricare ${pathname}.`, error);
      return fallback;
    }
  }
  function arrayFromPayload(payload) {
    return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  }
  function normalizeMediaValue(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return String(value.path || value.url || value.src || value.key || "");
  }
  function normalizeEntity(raw, fallbackType = "npc", source = "legacy") {
    const id = String(raw?.id || raw?.actorId || raw?.ownerCharacterId || "").trim().toLowerCase();
    if (!id) return null;
    const typeValue = String(raw?.relationshipType || raw?.type || fallbackType).toLowerCase();
    const type = ["player", "character"].includes(typeValue) ? "player" : typeValue === "companion" ? "companion" : "npc";
    const images = raw?.images || {};
    const media = raw?.media || {};
    return {
      id,
      type,
      source,
      name: String(raw?.name || raw?.title || id),
      role: String(raw?.role || raw?.profile?.role || raw?.profile?.subtitle || raw?.profile?.category || ""),
      accountIds: [...new Set([
        raw?.accountId,
        ...Array.isArray(raw?.ownerAccountIds) ? raw.ownerAccountIds : []
      ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))],
      worldId: String(raw?.worldId || ""),
      actorId: String(raw?.actorId || raw?.foundryActorId || ""),
      foundryActorId: String(raw?.foundryActorId || ""),
      legacyCharacterId: String(raw?.profile?.legacyCharacterId || raw?.legacyCharacterId || "").trim().toLowerCase(),
      ownerCharacterId: String(raw?.ownerCharacterId || "").trim().toLowerCase(),
      media: {
        avatar: normalizeMediaValue(media.avatar || images.avatar || images.portrait),
        token: normalizeMediaValue(media.token || images.token || images.portrait),
        idle: normalizeMediaValue(media.idle || images.idle),
        hover: normalizeMediaValue(media.hover || images.hover)
      },
      updatedAt: String(raw?.updatedAt || "")
    };
  }
  function mergeEntity(existing, incoming) {
    if (!existing) return incoming;
    const managedFirst = incoming.source === "managed";
    const primary = managedFirst ? incoming : existing;
    const secondary = managedFirst ? existing : incoming;
    return {
      ...secondary,
      ...primary,
      name: primary.name || secondary.name,
      role: primary.role || secondary.role,
      accountIds: [.../* @__PURE__ */ new Set([...existing.accountIds || [], ...incoming.accountIds || []])],
      ownerCharacterId: primary.ownerCharacterId || secondary.ownerCharacterId,
      legacyCharacterId: primary.legacyCharacterId || secondary.legacyCharacterId,
      foundryActorId: primary.foundryActorId || secondary.foundryActorId,
      media: {
        avatar: primary.media?.avatar || secondary.media?.avatar || "",
        token: primary.media?.token || secondary.media?.token || "",
        idle: primary.media?.idle || secondary.media?.idle || "",
        hover: primary.media?.hover || secondary.media?.hover || ""
      }
    };
  }
  async function loadEntityDirectory() {
    const campaignConfig = await window.CriptaApp?.campaigns?.ready?.();
    const token = authToken();
    const legacyCharactersPromise = campaignConfig?.legacyCharacters === false
      ? Promise.resolve([])
      : fetchCampaignJson("characters.json", []);
    const [playersPayload, charactersPayload, managedPayload] = await Promise.all([
      fetchCampaignJson("players.json", []),
      legacyCharactersPromise,
      window.CriptaApp.api.get("api/managed-actors", { token: token || void 0, cache: false }).catch(() => ({ data: [] }))
    ]);
    const map = /* @__PURE__ */ new Map();
    const add = (raw, fallbackType, source) => {
      const entity = normalizeEntity(raw, fallbackType, source);
      if (!entity) return;
      const canonical = entity.type === "player" && entity.ownerCharacterId
        ? { ...entity, id: entity.ownerCharacterId, type: "player" }
        : entity;
      const keys = new Set([
        `${canonical.type}:${canonical.id}`,
        canonical.type === "player" ? `character:${canonical.id}` : "",
        canonical.legacyCharacterId ? `${canonical.type}:${canonical.legacyCharacterId}` : "",
        canonical.actorId ? `${canonical.type}:${canonical.actorId.toLowerCase()}` : "",
        canonical.foundryActorId ? `${canonical.type}:${canonical.foundryActorId.toLowerCase()}` : ""
      ].filter(Boolean));
      let merged = canonical;
      keys.forEach((key) => {
        if (map.has(key)) merged = mergeEntity(map.get(key), merged);
      });
      keys.forEach((key) => map.set(key, merged));
    };
    arrayFromPayload(playersPayload).forEach((entry) => add(entry, "player", "legacy"));
    arrayFromPayload(charactersPayload).forEach((entry) => add(entry, "npc", "legacy"));
    arrayFromPayload(managedPayload).forEach((entry) => add(entry, entry?.ownerCharacterId ? "player" : "npc", "managed"));
    const displayEntities = /* @__PURE__ */ new Map();
    [...new Set(map.values())].forEach((entity) => {
      const displayKey = `${entity.type}:${slug(entity.name, entity.id)}`;
      displayEntities.set(displayKey, mergeEntity(displayEntities.get(displayKey), entity));
    });
    map.forEach((entity, key) => {
      const displayKey = `${entity.type}:${slug(entity.name, entity.id)}`;
      map.set(key, displayEntities.get(displayKey) || entity);
    });
    const entities = [...displayEntities.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
    return { entities, map };
  }
  function entityRef(entity, fallbackId = "", fallbackType = "npc", fallbackName = "") {
    const id = String(entity?.id || fallbackId || "").trim().toLowerCase();
    if (!id) return null;
    return {
      id,
      type: entity?.type || fallbackType,
      name: entity?.name || fallbackName || id,
      accountIds: [...new Set(entity?.accountIds || [])],
      worldId: entity?.worldId || "",
      actorId: entity?.actorId || ""
    };
  }
  function legacyObjectiveStatus(value) {
    const status = String(value || "").toLowerCase();
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    if (status === "hidden") return "hidden";
    if (status === "in_progress" || status === "active") return "active";
    return "pending";
  }
  function migrateLegacyObjective(raw, context, path) {
    const status = legacyObjectiveStatus(raw?.status);
    const title = String(raw?.title || "Obiettivo senza titolo");
    const seed = `${context.groupId}|${path}|${title}`;
    const assignedId = String(raw?.character_specific || "").trim().toLowerCase();
    const player = context.entityMap.get(`player:${assignedId}`) || context.entityMap.get(`character:${assignedId}`);
    const target = Math.max(1, Number(raw?.target || 1) || 1);
    return {
      id: stableId("objective", seed),
      title,
      description: String(raw?.description || ""),
      status,
      visibility: status === "hidden" ? "dm" : "public",
      required: raw?.required !== false,
      progress: {
        current: status === "completed" ? target : Math.max(0, Number(raw?.current || 0) || 0),
        target
      },
      assigneeRefs: assignedId ? [entityRef(player, assignedId, "player", assignedId)].filter(Boolean) : [],
      reward: String(raw?.rewards || raw?.reward || ""),
      subObjectives: (Array.isArray(raw?.subquests) ? raw.subquests : []).map((child, index) => migrateLegacyObjective(child, context, `${path}.${index}`))
    };
  }
  function deriveLegacyMissionStatus(objectives) {
    const visible = objectives.filter((objective) => objective.status !== "hidden");
    if (visible.length && visible.every((objective) => objective.status === "completed")) return "completed";
    if (visible.length && visible.every((objective) => objective.status === "failed")) return "failed";
    if (visible.some((objective) => ["active", "completed", "failed"].includes(objective.status))) return "active";
    return visible.length ? "available" : "draft";
  }
  function migrateLegacyGroups(groups, entityDirectory = { map: /* @__PURE__ */ new Map() }) {
    const copiedAt = (/* @__PURE__ */ new Date()).toISOString();
    return (Array.isArray(groups) ? groups : []).map((group, groupIndex) => {
      const groupId = String(group?.id || stableId("legacy-group", `${groupIndex}|${group?.title || ""}`));
      const npcId = String(group?.npc_id || "").trim().toLowerCase();
      const giver = npcId ? entityDirectory.map.get(`npc:${npcId}`) : null;
      const context = { groupId, entityMap: entityDirectory.map };
      const objectives = (Array.isArray(group?.quests) ? group.quests : []).map((objective, index) => migrateLegacyObjective(objective, context, String(index)));
      const assigneeRefs = objectives.flatMap((objective) => objective.assigneeRefs || []).filter((ref, index, all) => all.findIndex((candidate) => candidate.id === ref.id && candidate.type === ref.type) === index);
      return {
        id: stableId("mission", `legacy|${groupId}`),
        revision: 1,
        type: groupId === "main_quest" ? "main" : "side",
        status: deriveLegacyMissionStatus(objectives),
        visibility: "public",
        title: String(group?.title || "Missione senza titolo"),
        summary: String(group?.summary || ""),
        description: String(group?.description || ""),
        dmNotes: "",
        giverRefs: npcId ? [entityRef(giver, npcId, "npc", group?.title || npcId)].filter(Boolean) : [],
        assigneeRefs,
        links: [],
        tags: [],
        rewards: String(group?.rewards || group?.reward || ""),
        objectives,
        createdAt: copiedAt,
        createdBy: "Migrazione legacy",
        updatedAt: copiedAt,
        updatedBy: "Migrazione legacy",
        legacySource: { collection: "quests", id: groupId, copiedAt }
      };
    });
  }
  async function loadLegacyDocument() {
    try {
      const payload2 = await window.CriptaApp.api.get("api/data/quests", { cache: false });
      if (Array.isArray(payload2?.data)) return {
        data: payload2.data,
        source: payload2.source || "kv",
        version: Number(payload2.version || 0)
      };
    } catch (error) {
      console.warn("Missioni: KV legacy non disponibile, uso il file statico.", error);
    }
    const payload = await fetchCampaignJson("quests.json", []);
    return { data: arrayFromPayload(payload), source: "static", version: 0 };
  }
  async function resolveCanEditFallback() {
    try {
      return Boolean(await window.CriptaDiscordAuth?.isCurrentUserDm?.(window.CriptaBasePath || ""));
    } catch (_) {
      return false;
    }
  }
  async function load(options = {}) {
    const token = authToken();
    const directoryPromise = loadEntityDirectory();
    let endpointAvailable = false;
    try {
      const payload = await window.CriptaApp.api.get("api/missions", {
        token: token || void 0,
        cache: false,
        query: options.force ? { _: Date.now() } : void 0
      });
      endpointAvailable = true;
      const directory2 = await directoryPromise;
      if (Array.isArray(payload?.data)) {
        return {
          schemaVersion: 2,
          source: "missions",
          version: Number(payload.version || 0),
          missions: payload.data,
          canEdit: Boolean(payload?.permissions?.canEdit),
          needsBootstrap: false,
          bootstrapAvailable: true,
          legacyVersion: 0,
          entities: directory2.entities,
          entityMap: directory2.map
        };
      }
    } catch (error) {
      console.info("Missioni v2 non ancora disponibili: uso sicuro del registro legacy.", error);
    }
    const [directory, legacy] = await Promise.all([directoryPromise, loadLegacyDocument()]);
    return {
      schemaVersion: 2,
      source: "legacy",
      version: 0,
      missions: migrateLegacyGroups(legacy.data, directory),
      canEdit: await resolveCanEditFallback(),
      needsBootstrap: true,
      bootstrapAvailable: endpointAvailable,
      legacyVersion: legacy.version,
      entities: directory.entities,
      entityMap: directory.map
    };
  }
  async function bootstrap(state) {
    if (!state?.needsBootstrap) return state;
    const token = authToken();
    if (!token) throw new Error("Accedi come DM per inizializzare il nuovo registro missioni.");
    const result = await window.CriptaApp.api.post("api/missions/bootstrap", {
      data: state.missions,
      sourceVersion: state.legacyVersion || 0
    }, { token });
    return {
      ...state,
      source: "missions",
      version: Number(result?.version || 1),
      missions: Array.isArray(result?.data) ? result.data : state.missions,
      needsBootstrap: false
    };
  }
  async function upsert(mission, expectedRevision = 0) {
    const token = authToken();
    if (!token) throw new Error("Accedi come DM per salvare la missione.");
    return window.CriptaApp.api.post("api/missions/upsert", { mission, expectedRevision }, { token });
  }
  async function patchProgress(missionId, objectiveId, patch, expectedRevision) {
    const token = authToken();
    if (!token) throw new Error("Accedi come DM per aggiornare la missione.");
    return window.CriptaApp.api.post("api/missions/progress", {
      missionId,
      objectiveId,
      patch,
      expectedRevision
    }, { token });
  }
  function walkObjectives(objectives, visitor, depth = 0, parent = null) {
    (Array.isArray(objectives) ? objectives : []).forEach((objective, index) => {
      visitor(objective, { depth, parent, index });
      walkObjectives(objective.subObjectives, visitor, depth + 1, objective);
    });
  }
  function requiredLeaves(mission) {
    const leaves = [];
    walkObjectives(mission?.objectives, (objective) => {
      const activeChildren = (objective.subObjectives || []).filter((child) => child.status !== "archived");
      if (objective.required !== false && !activeChildren.length && objective.status !== "hidden" && objective.status !== "archived") leaves.push(objective);
    });
    return leaves;
  }
  function progress(mission) {
    const leaves = requiredLeaves(mission);
    const total = leaves.reduce((sum, objective) => sum + Math.max(1, Number(objective.progress?.target || 1)), 0);
    const current = leaves.reduce((sum, objective) => {
      const target = Math.max(1, Number(objective.progress?.target || 1));
      const value = objective.status === "completed" ? target : Math.min(target, Math.max(0, Number(objective.progress?.current || 0)));
      return sum + value;
    }, 0);
    return {
      completed: leaves.filter((objective) => objective.status === "completed").length,
      count: leaves.length,
      current,
      total,
      percent: total ? Math.round(current / total * 100) : 0
    };
  }
  function createMission(existingIds = []) {
    let id = `mission-${Date.now().toString(36)}`;
    let counter = 2;
    while (existingIds.includes(id)) id = `mission-${Date.now().toString(36)}-${counter++}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      id,
      revision: 0,
      type: "side",
      status: "draft",
      visibility: "dm",
      title: "Nuova missione",
      summary: "",
      description: "",
      dmNotes: "",
      giverRefs: [],
      assigneeRefs: [],
      links: [],
      tags: [],
      rewards: "",
      objectives: [],
      createdAt: now,
      createdBy: "",
      updatedAt: now,
      updatedBy: ""
    };
  }
  function createObjective(seed = "") {
    return {
      id: stableId("objective", `${Date.now()}|${Math.random()}|${seed}`),
      title: "Nuovo obiettivo",
      description: "",
      status: "pending",
      visibility: "public",
      required: true,
      progress: { current: 0, target: 1 },
      assigneeRefs: [],
      reward: "",
      subObjectives: []
    };
  }
  function missionNameDistance(left, right) {
    const a = String(left || "").replace(/-/g, "");
    const b = String(right || "").replace(/-/g, "");
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const saved = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = saved;
      }
    }
    return row[b.length];
  }
  function findEntity(ref, state) {
    if (!ref) return null;
    const id = String(ref.id || "").toLowerCase();
    const byId = state?.entityMap?.get(`${ref.type}:${id}`) || state?.entities?.find((entry) => entry.id === id);
    if (byId) return byId;
    const nameKey = slug(ref.name || "", "");
    if (!nameKey) return null;
    const entities = state?.entities || [];
    const exact = entities.find((entry) => slug(entry.name || "", "") === nameKey);
    if (exact) return exact;
    const prefix = entities.find((entry) => {
      const candidate = slug(entry.name || "", "");
      return candidate.startsWith(`${nameKey}-`) || nameKey.startsWith(`${candidate}-`);
    });
    if (prefix) return prefix;
    const ranked = entities.map((entry) => ({ entry, distance: missionNameDistance(nameKey, slug(entry.name || "", "")) })).sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    return best && best.distance <= Math.max(3, Math.ceil(nameKey.replace(/-/g, "").length * 0.18)) ? best.entry : null;
  }
  window.CriptaMissions = {
    TYPE_LABELS,
    STATUS_LABELS,
    VISIBILITY_LABELS,
    TYPE_OPTIONS,
    MISSION_STATUS_OPTIONS,
    OBJECTIVE_STATUS_OPTIONS,
    VISIBILITY_OPTIONS,
    clone,
    slug,
    stableId,
    campaignId,
    authToken,
    load,
    bootstrap,
    upsert,
    patchProgress,
    migrateLegacyGroups,
    progress,
    walkObjectives,
    createMission,
    createObjective,
    entityRef,
    findEntity
  };
})();
