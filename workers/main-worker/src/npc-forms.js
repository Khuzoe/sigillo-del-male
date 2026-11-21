// Relations belong to the wiki. Actor documents, media, snapshots and commands
// keep their original Foundry identities throughout a transformation.
export const actorKey = ({ worldId, actorId }) => `${worldId}:${actorId}`;
export const eligibleNpc = actor => actor?.actorType === "npc" && !actor.relationshipType
  && !actor.ownerCharacterId && actor.profile?.lifecycle?.state !== "archived";

export function groupFor(registry, key) {
  return registry.groups.find(group => group.forms.some(form => form.key === key));
}

export function updateForms(registry, owner, body, actors) {
  const fail = (message, status = 400) => ({ error: message, status });
  const existing = groupFor(registry, owner);
  if (existing && existing.owner !== owner) return fail("Questo Actor appartiene già a un altro dossier.", 409);
  if (!eligibleNpc(actors.get(owner))) return fail("Seleziona un dossier NPC attivo.", 404);
  if (body.expectedRevision !== (existing?.revision ?? 0)) return fail("Le forme sono cambiate. Ricarica il dossier e riprova.", 409);
  const group = existing ? structuredClone(existing) : {
    owner, current: owner, forms: [{ key: owner, label: "Forma originaria", past: false }]
  };
  const { action, key } = body;
  const form = group.forms.find(entry => entry.key === key);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (["link", "rename"].includes(action) && (!label || label.length > 120)) return fail("Inserisci un nome per la forma (massimo 120 caratteri).");
  if (action === "link") {
    if (!eligibleNpc(actors.get(key))) return fail("Actor NPC non disponibile.", 404);
    if (form || groupFor(registry, key)) return fail("Questo Actor è già collegato a un dossier.", 409);
    group.forms.push({ key, label, past: false, showPortrait: body.showPortrait === true });
  } else {
    if (!existing || !form) return fail("Forma non collegata al dossier.", 404);
    switch (action) {
      case "current":
        if (!eligibleNpc(actors.get(key))) return fail("La forma selezionata non è disponibile.");
        group.current = key;
        form.past = false;
        break;
      case "past":
        if (key === group.current && body.past === true) return fail("Scegli un’altra forma attuale prima di segnare questa come passata.");
        if (typeof body.past !== "boolean") return fail("Stato della forma non valido.");
        form.past = body.past;
        break;
      case "portrait":
        if (key === owner || typeof body.showPortrait !== "boolean") return fail("Visibilità non valida.");
        form.showPortrait = body.showPortrait;
        break;
      case "rename": form.label = label; break;
      case "unlink":
        if (key === owner || key === group.current) return fail("Puoi scollegare solo una forma aggiunta che non sia attuale.");
        group.forms = group.forms.filter(entry => entry.key !== key);
        break;
      default: return fail("Azione sulle forme non riconosciuta.");
    }
  }
  const version = registry.version + 1;
  const groups = registry.groups.filter(entry => entry.owner !== owner);
  if (group.forms.length > 1) groups.push({ ...group, revision: version });
  return { registry: { version, groups } };
}

export function visibleForms(group, actors, access, editor) {
  const owner = actors.get(group.owner);
  if (!owner || (!editor && owner.profile?.lifecycle?.state === "archived")) return [];
  const rootAccess = access(owner);
  if (!rootAccess.stats && !rootAccess.profile) return [];
  return group.forms.flatMap(form => {
    const actor = actors.get(form.key);
    // Keep missing members manageable so an editor can detach a removed Actor.
    if (!actor && !editor) return [];
    if (actor && !eligibleNpc(actor) && !editor) return [];
    const stats = !!actor && access(actor).stats;
    const portrait = rootAccess.profile && (form.key === group.owner || form.showPortrait);
    if (!editor && !stats && !portrait) return [];
    const [worldId, actorId] = form.key.split(":");
    const media = actor?.media || {};
    return [{
      key: form.key, worldId, actorId, label: form.label, past: form.past,
      current: form.key === group.current, canReadStats: stats,
      media: { avatar: media.avatar, token: media.token, idle: media.idle, hover: media.hover },
      ...(editor ? { showPortrait: !!form.showPortrait, available: eligibleNpc(actor) } : {})
    }];
  });
}
