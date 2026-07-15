(() => {
    const PLAYER_SKILL_TREE_KEYS = {
        apothecary: "apothecary",
        garun: "garun",
        luca: "garun",
        randra: "randra",
        eli: "randra",
        valdor: "valdor",
        sommo: "valdor",
        theldarion: "theldarion",
        theldari: "theldarion",
        dona: "theldarion"
    };
    const SKILL_TREE_ICON_SIZE = 256;
    let skills = {};
    let skillsVersion = null;
    let states = [];
    let statesVersion = null;
    let skillTreeModulePromise = null;

    function escapeHtml(value) {
        return window.CriptaApp?.utils?.escapeHtml?.(value) || String(value ?? "");
    }

    function normalize(value) {
        return window.CriptaApp?.utils?.normalizeKey?.(value) || String(value ?? "").trim().toLowerCase();
    }

    function slugify(value) {
        return window.CriptaApp?.utils?.slugify?.(value) || normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    function campaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function token() {
        return window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "";
    }

    function ensureSkillTreeAssets() {
        if (!document.querySelector("link[data-managed-skill-tree-style]")) {
            const style = document.createElement("link");
            style.rel = "stylesheet";
            style.href = new URL("../../assets/css/pages/character-skill-tree.css?v=20260715-external-arcs2", window.location.href).toString();
            style.dataset.managedSkillTreeStyle = "true";
            document.head.appendChild(style);
        }
        if (window.CriptaCharacterSkillTree) return Promise.resolve(window.CriptaCharacterSkillTree);
        if (skillTreeModulePromise) return skillTreeModulePromise;
        skillTreeModulePromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = new URL("../../assets/js/shared/character-skill-tree.js?v=20260715-unsaved-guard1", window.location.href).toString();
            script.defer = true;
            script.dataset.managedSkillTreeScript = "true";
            script.addEventListener("load", () => window.CriptaCharacterSkillTree ? resolve(window.CriptaCharacterSkillTree) : reject(new Error("Modulo alberi non inizializzato.")), { once: true });
            script.addEventListener("error", () => reject(new Error("Caricamento modulo alberi fallito.")), { once: true });
            document.head.appendChild(script);
        });
        return skillTreeModulePromise;
    }


    function mediaUrl(descriptor) {
        const path = String(descriptor?.path || descriptor || "").trim();
        if (!path) return "";
        let result = /^(https?:|data:|blob:)/i.test(path) ? path : window.CriptaApp?.urls?.api?.(path) || path;
        const revision = Number(descriptor?.revision || 0);
        if (revision && /^(https?:)/i.test(result)) {
            const url = new URL(result, window.location.href);
            url.searchParams.set("v", String(revision));
            result = url.toString();
        }
        return result;
    }

    function relationshipType(entry) {
        const requested = normalize(entry?.relationshipType);
        if (requested === "player" || requested === "companion") return requested;
        const type = normalize(entry?.actorType || entry?.type);
        if (entry?.ownerCharacterId && type === "npc") return "companion";
        if (entry?.ownerCharacterId && (type === "character" || type === "player")) return "player";
        return "";
    }

    function companionKey(entry) {
        return slugify(entry?.foundryActorId || entry?.actorId || entry?.id || entry?.foundryName || entry?.name || entry?.displayName || "companion");
    }

    function companionMatchKeys(entry) {
        return new Set([
            companionKey(entry),
            slugify(entry?.foundryActorId || ""),
            slugify(entry?.actorId || entry?.id || ""),
            slugify(entry?.foundryName || ""),
            slugify(entry?.displayName || entry?.name || "")
        ].filter(Boolean));
    }

    function companionEntriesMatch(left, right) {
        const leftKeys = companionMatchKeys(left);
        return [...companionMatchKeys(right)].some((key) => leftKeys.has(key));
    }

    function legacyCompanionAsset(entry, kind) {
        const owner = slugify(entry?.ownerCharacterId || entry?.characterId || "");
        const seen = new Set();
        const entityId = [owner, entry?.foundryName || entry?.name || entry?.displayName, entry?.actorId || entry?.id]
            .map(slugify)
            .filter((part) => part && !seen.has(part) && seen.add(part));
        if (!owner || !entityId.length) return "";
        return mediaUrl(`media/campaigns/${campaignId()}/companions/${owner}/${entityId.join("-")}-${kind}.webp`);
    }

    function finiteNumber(value) {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatNumber(value) {
        const number = finiteNumber(value);
        if (number === null) return "-";
        return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(number);
    }

    function formatSigned(value) {
        const number = finiteNumber(value);
        if (number === null) return "-";
        return `${number >= 0 ? "+" : ""}${formatNumber(number)}`;
    }

    function companionDetailChips(snapshot) {
        const details = snapshot?.details || {};
        return [
            details.type ? String(details.type) : "",
            details.cr !== undefined && details.cr !== null && details.cr !== "" ? `CR ${formatNumber(details.cr)}` : "",
            details.alignment ? String(details.alignment) : ""
        ].filter(Boolean);
    }

    function companionVitals(snapshot) {
        const vitals = snapshot?.vitals || {};
        const hp = vitals.hp && typeof vitals.hp === "object" ? vitals.hp : {};
        const entries = [];
        const hpValue = finiteNumber(hp.value);
        const hpMax = finiteNumber(hp.max);
        if (hpValue !== null || hpMax !== null) entries.push({ icon: "fa-heart-pulse", label: "PF", value: `${hpValue === null ? "-" : formatNumber(hpValue)} / ${hpMax === null ? "-" : formatNumber(hpMax)}` });
        const ac = finiteNumber(vitals.ac);
        if (ac !== null) entries.push({ icon: "fa-shield-halved", label: "CA", value: formatNumber(ac) });
        const initiative = finiteNumber(vitals.initiative);
        if (initiative !== null) entries.push({ icon: "fa-bolt", label: "Iniziativa", value: formatSigned(initiative) });
        const proficiency = finiteNumber(vitals.prof);
        if (proficiency !== null) entries.push({ icon: "fa-dice-d20", label: "Competenza", value: formatSigned(proficiency) });
        return entries.slice(0, 4);
    }

    function renderCompanionVitals(snapshot) {
        const entries = companionVitals(snapshot);
        if (!entries.length) return "";
        return `<span class="managed-companion-vitals">${entries.map((entry) => `<span><i class="fas ${entry.icon}"></i><small>${escapeHtml(entry.label)}</small><strong>${escapeHtml(entry.value)}</strong></span>`).join("")}</span>`;
    }

    function renderCompanionChips(snapshot) {
        const chips = companionDetailChips(snapshot);
        return chips.length ? `<span class="managed-companion-chips">${chips.map((chip) => `<small>${escapeHtml(chip)}</small>`).join("")}</span>` : "";
    }

    function setSectionNavVisible(sectionId, visible) {
        const link = document.querySelector(`.managed-section-nav a[href="#${sectionId}"]`);
        if (link) link.hidden = !visible;
    }


    async function getApi(path, options = {}) {
        return window.CriptaApp.api.get(path, {
            cache: false,
            ...(token() ? { token: token() } : {}),
            ...options
        });
    }
    async function postApi(path, body) {
        return window.CriptaApp.api.post(path, body, {
            ...(token() ? { token: token() } : {})
        });
    }

    async function loadCompanions(characterId) {
        const [managedPayload, legacyPayload] = await Promise.all([
            getApi("api/managed-actors").catch(() => ({ data: [] })),
            getApi("api/inventory").catch(() => ({ companions: [] }))
        ]);
        const owner = normalize(characterId);
        const worldId = normalize(new URLSearchParams(window.location.search).get("world") || "");
        const managedAll = (Array.isArray(managedPayload?.data) ? managedPayload.data : [])
            .filter((entry) => !worldId || normalize(entry?.worldId) === worldId);
        const legacyAll = (Array.isArray(legacyPayload?.companions) ? legacyPayload.companions : [])
            .filter((entry) => normalize(entry?.ownerCharacterId) === owner);
        const managed = managedAll
            .filter((entry) => normalize(entry?.ownerCharacterId) === owner && relationshipType(entry) === "companion")
            .map((entry) => ({
                ...entry,
                legacySnapshot: legacyAll.find((snapshot) => companionEntriesMatch(entry, snapshot)) || null
            }))
            .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "it"));
        const managedKeys = new Set(managed.flatMap((entry) => [companionKey(entry), slugify(entry.name || "")]).filter(Boolean));
        const legacy = legacyAll
            .filter((entry) => ![companionKey(entry), slugify(entry.name || entry.displayName || "")].some((key) => key && managedKeys.has(key)))
            .sort((left, right) => String(left.displayName || left.name || "").localeCompare(String(right.displayName || right.name || ""), "it"));
        const available = managedAll
            .filter((entry) => normalize(entry?.actorType) === "npc")
            .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "it"));
        return { managed, legacy, available };
    }

    const COMPANION_ABILITY_LABELS = { str: "FOR", dex: "DES", con: "COS", int: "INT", wis: "SAG", cha: "CAR" };

    function cleanCompanionText(value) {
        let source = String(value?.value ?? value ?? "").trim();
        if (!source) return "";
        const template = document.createElement("template");
        template.innerHTML = source;
        template.content.querySelectorAll("script, style, iframe, object, embed").forEach((entry) => entry.remove());
        source = template.content.textContent || "";
        return source
            .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
            .replace(/@(?:Item|item)\[([^|\]]+)(?:\|[^\]]*)?\]/g, "$1")
            .replace(/&Reference\[([^\]]+)\]/g, (_, reference) => String(reference).split("=").pop() || reference)
            .replace(/\[\[\/save[^\]]*dc=(\d+)[^\]]*\]\]/gi, "CD $1")
            .replace(/\s+/g, " ")
            .trim();
    }

    function formatCompanionTrait(value) {
        if (!value) return "";
        if (typeof value === "string") return value.trim();
        if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
        const values = Array.isArray(value.value) ? value.value : Array.isArray(value.values) ? value.values : [];
        return [...values.map(String), String(value.custom || "").trim()].filter(Boolean).join(", ");
    }

    function renderCompanionAbilities(snapshot) {
        const abilities = snapshot?.abilities || {};
        const entries = Object.entries(COMPANION_ABILITY_LABELS)
            .map(([key, label]) => [label, abilities[key]])
            .filter(([, value]) => value && typeof value === "object");
        if (!entries.length) return "";
        return `<section class="managed-companion-detail-card managed-companion-detail-card--abilities"><header><i class="fas fa-dumbbell"></i><strong>Caratteristiche</strong></header><div class="managed-companion-ability-grid">${entries.map(([label, ability]) => {
            const score = finiteNumber(ability.value) ?? 10;
            const modifier = finiteNumber(ability.mod) ?? Math.floor((score - 10) / 2);
            const save = finiteNumber(ability.save ?? ability.saveBonus);
            return `<span><small>${label}</small><strong>${formatNumber(score)}</strong><em>${formatSigned(modifier)}</em>${save !== null ? `<b>TS ${formatSigned(save)}</b>` : ""}</span>`;
        }).join("")}</div></section>`;
    }

    function companionMovement(snapshot) {
        const speed = snapshot?.vitals?.speed || snapshot?.movement || {};
        if (typeof speed === "string") return speed;
        if (!speed || typeof speed !== "object") return "";
        const labels = { walk: "Passo", fly: "Volo", swim: "Nuoto", climb: "Scalata", burrow: "Scavo" };
        const units = speed.units || "ft";
        return Object.entries(labels).map(([key, label]) => finiteNumber(speed[key]) > 0 ? `${label} ${formatNumber(speed[key])} ${units}` : "").filter(Boolean).join(" / ");
    }

    function renderCompanionDefenses(snapshot) {
        const traits = snapshot?.traits || {};
        const rows = [
            ["Movimento", companionMovement(snapshot)],
            ["Resistenze", formatCompanionTrait(traits.dr)],
            ["Immunit\u00e0", formatCompanionTrait(traits.di)],
            ["Vulnerabilit\u00e0", formatCompanionTrait(traits.dv)],
            ["Immunit\u00e0 condizioni", formatCompanionTrait(traits.ci)],
            ["Linguaggi", formatCompanionTrait(traits.languages)]
        ].filter(([, value]) => value);
        const tempHp = finiteNumber(snapshot?.vitals?.hp?.temp);
        if (tempHp) rows.unshift(["PF temporanei", formatNumber(tempHp)]);
        if (!rows.length) return "";
        return `<section class="managed-companion-detail-card"><header><i class="fas fa-shield-halved"></i><strong>Movimento e difese</strong></header><dl class="managed-companion-fact-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>`;
    }

    function companionEntryDescription(entry) {
        return cleanCompanionText(entry?.description ?? entry?.system?.description?.value ?? entry?.system?.description ?? "");
    }

    function companionEntryBadges(entry) {
        const badges = [];
        const type = normalize(entry?.type);
        const labels = { feat: "Capacit\u00e0", weapon: "Attacco", spell: "Incantesimo", equipment: "Equipaggiamento", consumable: "Consumabile", tool: "Strumento", loot: "Oggetto" };
        if (labels[type]) badges.push(labels[type]);
        const level = finiteNumber(entry?.level ?? entry?.system?.level);
        if (type === "spell") badges.push(level === 0 ? "Trucchetto" : `Livello ${formatNumber(level)}`);
        if (entry?.prepared === true || entry?.system?.preparation?.prepared === true) badges.push("Preparato");
        const activation = entry?.activation?.type || entry?.system?.activation?.type;
        if (activation) badges.push(String(activation));
        const quantity = finiteNumber(entry?.quantity ?? entry?.system?.quantity);
        if (quantity !== null && quantity > 1) badges.push(`x${formatNumber(quantity)}`);
        return badges;
    }

    function renderCompanionEntry(entry) {
        const name = entry?.name || "Elemento senza nome";
        const description = companionEntryDescription(entry);
        const badges = companionEntryBadges(entry);
        return `<details class="managed-companion-entry"><summary><span><strong>${escapeHtml(name)}</strong>${badges.length ? `<small>${badges.map((badge) => `<em>${escapeHtml(badge)}</em>`).join("")}</small>` : ""}</span><i class="fas fa-chevron-down"></i></summary>${description ? `<p>${escapeHtml(description)}</p>` : `<p class="is-empty">Nessuna descrizione disponibile.</p>`}</details>`;
    }

    function renderCompanionCollection(title, icon, entries, open = false) {
        if (!entries.length) return "";
        return `<details class="managed-companion-collection" ${open ? "open" : ""}><summary><span><i class="fas ${icon}"></i><strong>${escapeHtml(title)}</strong></span><span><b>${entries.length}</b><i class="fas fa-chevron-down"></i></span></summary><div>${entries.map(renderCompanionEntry).join("")}</div></details>`;
    }

    function renderCompanionDetails(snapshot) {
        const items = Array.isArray(snapshot?.inventory) ? snapshot.inventory : Array.isArray(snapshot?.items) ? snapshot.items : [];
        const capabilities = items.filter((entry) => ["feat", "weapon"].includes(normalize(entry?.type)));
        const spells = items.filter((entry) => normalize(entry?.type) === "spell");
        const inventory = items.filter((entry) => !["feat", "weapon", "spell", "class", "subclass"].includes(normalize(entry?.type)));
        const overview = [renderCompanionAbilities(snapshot), renderCompanionDefenses(snapshot)].filter(Boolean).join("");
        const collections = [
            renderCompanionCollection("Azioni e tratti", "fa-dragon", capabilities, true),
            renderCompanionCollection("Incantesimi", "fa-wand-sparkles", spells),
            renderCompanionCollection("Inventario", "fa-box-open", inventory)
        ].filter(Boolean).join("");
        if (!overview && !collections) return `<p class="managed-companion-detail-empty"><i class="fas fa-circle-info"></i> Dettagli non ancora disponibili.</p>`;
        return `${overview ? `<div class="managed-companion-details-grid">${overview}</div>` : ""}${collections ? `<div class="managed-companion-collections">${collections}</div>` : ""}`;
    }

    function normalizeManagedCompanionDocument(payload) {
        const document = payload?.data || payload || {};
        const definition = document.definition || {};
        const attributes = definition.attributes || {};
        const ac = typeof attributes.ac === "object" ? (attributes.ac.value ?? attributes.ac.flat) : attributes.ac;
        return {
            details: definition.details || {},
            vitals: {
                hp: document.runtime?.hp || attributes.hp || {},
                ac,
                initiative: attributes.init?.total ?? attributes.init?.bonus ?? attributes.init?.value,
                prof: attributes.prof,
                speed: attributes.movement || {}
            },
            abilities: definition.abilities || {},
            traits: definition.traits || {},
            inventory: Array.isArray(definition.items) ? definition.items : []
        };
    }

    function renderCompanionVisual(name, image, hover, tokenImage) {
        const portrait = image ? `<img class="is-idle" src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">` : `<span class="managed-companion-empty"><i class="fas fa-paw"></i></span>`;
        const hoverPortrait = image && hover && hover !== image ? `<img class="is-hover" src="${escapeHtml(hover)}" alt="" loading="lazy" decoding="async">` : "";
        const hoverData = hover && hover !== image ? ` data-managed-image-hover="${escapeHtml(hover)}"` : "";
        const portraitButton = image ? `<button type="button" class="managed-companion-portrait-zoom" data-managed-image-open="${escapeHtml(image)}"${hoverData} data-managed-image-title="Ritratto - ${escapeHtml(name)}" aria-label="Ingrandisci il ritratto di ${escapeHtml(name)}"><i class="fas fa-expand"></i></button>` : "";
        const token = tokenImage ? `<button type="button" class="managed-companion-token-button" data-managed-image-open="${escapeHtml(tokenImage)}" data-managed-image-title="Token - ${escapeHtml(name)}" aria-label="Ingrandisci il token di ${escapeHtml(name)}"><img class="managed-companion-token" src="${escapeHtml(tokenImage)}" alt="Token ${escapeHtml(name)}" loading="lazy" decoding="async"><i class="fas fa-expand"></i></button>` : "";
        return `<span class="managed-companion-stage"><span class="managed-companion-sigil" aria-hidden="true"></span>${portrait}${hoverPortrait}${portraitButton}${token}</span>`;
    }

    function companionCard({ name, role, playerName, image, hover, tokenImage, snapshot, managedEntry = null, canManage = false }) {
        const identity = slugify(managedEntry?.actorId || managedEntry?.foundryActorId || name || "companion");
        const detailsId = `managed-companion-details-${identity}`;
        const managedData = managedEntry ? ` data-managed-companion-world="${escapeHtml(managedEntry.worldId || "")}" data-managed-companion-actor="${escapeHtml(managedEntry.actorId || "")}" data-managed-companion-relationship-revision="${Number(managedEntry.relationshipRevision || 0)}" data-managed-companion-hydrated="false"` : ` data-managed-companion-hydrated="true"`;
        const removeAction = managedEntry && canManage ? `<button type="button" class="managed-companion-unlink" data-companion-unlink aria-label="Rimuovi ${escapeHtml(name)} dai companion"><i class="fas fa-link-slash"></i><span>Rimuovi</span></button>` : "";
        return `<article class="managed-companion-card"${managedData}>${renderCompanionVisual(name, image, hover, tokenImage)}<span class="managed-companion-copy"><span class="managed-companion-kicker">Companion di ${escapeHtml(playerName || "personaggio")}</span><span class="managed-companion-title"><strong>${escapeHtml(name)}</strong>${removeAction}</span><span class="managed-companion-role">${escapeHtml(role || "Companion")}</span>${renderCompanionChips(snapshot)}${renderCompanionVitals(snapshot)}<button type="button" class="managed-companion-toggle" data-companion-toggle aria-expanded="false" aria-controls="${detailsId}"><i class="fas fa-table-list"></i><span data-companion-toggle-label>Scheda completa</span><i class="fas fa-chevron-down"></i></button></span><div class="managed-companion-details" id="${detailsId}" data-companion-details hidden>${renderCompanionDetails(snapshot)}</div></article>`;
    }

    function managedCompanionCard(entry, playerName, canManage = false) {
        const media = entry.media || {};
        const snapshot = entry.legacySnapshot || null;
        const name = entry.name || snapshot?.displayName || snapshot?.name || "Companion";
        const image = mediaUrl(media.idle || media.avatar || media.token || snapshot?.img || snapshot?.token?.img);
        const hover = mediaUrl(media.hover || media.idle || media.avatar || media.token || snapshot?.img || snapshot?.token?.img);
        const tokenImage = mediaUrl(media.token || media.avatar || snapshot?.token?.img || snapshot?.img);
        const role = entry.profile?.role || "Companion";
        return companionCard({ name, role, playerName, image, hover, tokenImage, snapshot, managedEntry: entry, canManage });
    }

    function legacyCompanionCard(entry, playerName) {
        const name = entry.displayName || entry.name || "Companion";
        const image = mediaUrl(entry.img || entry.token?.img || "");
        const tokenImage = legacyCompanionAsset(entry, "token") || mediaUrl(entry.token?.img || entry.img || "");
        return companionCard({ name, role: "Companion", playerName, image, hover: image, tokenImage, snapshot: entry });
    }


    function applyCompanionFrameCircles(section, result) {
        (Array.isArray(result?.managed) ? result.managed : []).forEach((entry) => {
            const card = Array.from(section.querySelectorAll("[data-managed-companion-actor]")).find((candidate) =>
                String(candidate.dataset.managedCompanionActor || "") === String(entry.actorId || "")
                && String(candidate.dataset.managedCompanionWorld || "") === String(entry.worldId || "")
            );
            if (!card) return;
            const media = entry.media || {};
            const idleDescriptor = media.idle || media.avatar || media.token || null;
            const hoverDescriptor = media.hover || media.idle || media.avatar || media.token || null;
            const stage = card.querySelector(".managed-companion-stage");
            const idleImage = card.querySelector(".managed-companion-stage > .is-idle");
            const hoverImage = card.querySelector(".managed-companion-stage > .is-hover");
            const idleCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(idleDescriptor?.presentation?.frameCircle);
            const hoverCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(hoverDescriptor?.presentation?.frameCircle);
            if (!idleCircle && !hoverCircle) return;
            if (stage) stage.dataset.frameCircleHost = "true";
            if (idleImage && idleCircle) window.CriptaImageAdjust.setFrameCircleDataset(idleImage, idleCircle, { target: ".managed-companion-sigil" });
            if (hoverImage && hoverCircle) window.CriptaImageAdjust.setFrameCircleDataset(hoverImage, hoverCircle, { target: ".managed-companion-sigil" });
        });
        window.CriptaImageAdjust?.initFrameCircleImages?.(section);
    }
    function setupCompanionInteractions(section) {
        section.querySelectorAll("[data-companion-toggle]").forEach((button) => button.addEventListener("click", async () => {
            const card = button.closest(".managed-companion-card");
            const details = card?.querySelector("[data-companion-details]");
            if (!card || !details) return;
            const expand = button.getAttribute("aria-expanded") !== "true";
            button.setAttribute("aria-expanded", String(expand));
            card.classList.toggle("is-expanded", expand);
            details.hidden = !expand;
            button.querySelector("[data-companion-toggle-label]").textContent = expand ? "Riduci scheda" : "Scheda completa";
            if (!expand || card.dataset.managedCompanionHydrated === "true" || card.dataset.managedCompanionLoading === "true") return;
            const worldId = String(card.dataset.managedCompanionWorld || "");
            const actorId = String(card.dataset.managedCompanionActor || "");
            if (!worldId || !actorId) return;
            card.dataset.managedCompanionLoading = "true";
            details.setAttribute("aria-busy", "true");
            try {
                const payload = await getApi(`api/managed-actors/${encodeURIComponent(worldId)}/${encodeURIComponent(actorId)}`);
                const snapshot = normalizeManagedCompanionDocument(payload);
                details.innerHTML = renderCompanionDetails(snapshot);
                const vitalsHtml = renderCompanionVitals(snapshot);
                const chipsHtml = renderCompanionChips(snapshot);
                const currentVitals = card.querySelector(".managed-companion-vitals");
                const currentChips = card.querySelector(".managed-companion-chips");
                if (vitalsHtml) currentVitals ? currentVitals.outerHTML = vitalsHtml : button.insertAdjacentHTML("beforebegin", vitalsHtml);
                if (chipsHtml) currentChips ? currentChips.outerHTML = chipsHtml : button.insertAdjacentHTML("beforebegin", chipsHtml);
                card.dataset.managedCompanionHydrated = "true";
            } catch (error) {
                console.warn("Dettagli companion non disponibili.", error);
            } finally {
                delete card.dataset.managedCompanionLoading;
                details.removeAttribute("aria-busy");
            }
        }));
    }

    async function saveCompanionRelationship(entry, ownerCharacterId) {
        const worldId = String(entry?.worldId || "");
        const actorId = String(entry?.actorId || "");
        if (!worldId || !actorId) throw new Error("Identita NPC mancante.");
        return postApi(`api/managed-actors/${encodeURIComponent(worldId)}/${encodeURIComponent(actorId)}/relationship`, {
            relationshipType: ownerCharacterId ? "companion" : "",
            ownerCharacterId: ownerCharacterId || "",
            expectedRelationshipRevision: Number(entry.relationshipRevision || 0)
        });
    }

    function candidateImage(entry) {
        const media = entry?.media || {};
        return mediaUrl(media.idle || media.avatar || media.token || "");
    }

    function openCompanionPicker(result, characterId, playerName, onRefresh) {
        document.querySelector("[data-managed-companion-picker]")?.remove();
        const candidates = (Array.isArray(result?.available) ? result.available : [])
            .filter((entry) => !(normalize(entry?.ownerCharacterId) === normalize(characterId) && relationshipType(entry) === "companion"));
        const dialog = document.createElement("dialog");
        dialog.className = "managed-companion-picker";
        dialog.dataset.managedCompanionPicker = "true";
        const rows = candidates.map((entry) => {
            const image = candidateImage(entry);
            const linkedTo = normalize(entry?.ownerCharacterId);
            const transfer = Boolean(linkedTo && linkedTo !== normalize(characterId));
            return `<article class="managed-companion-picker-card" data-companion-candidate data-search="${escapeHtml(String(entry.name || "").toLowerCase())}">
                <span class="managed-companion-picker-art">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="fas fa-paw"></i>'}</span>
                <span><strong>${escapeHtml(entry.name || "NPC")}</strong><small>${transfer ? `Companion di ${escapeHtml(entry.ownerCharacterId)}` : "NPC disponibile"}</small></span>
                <button type="button" data-companion-link data-world="${escapeHtml(entry.worldId || "")}" data-actor="${escapeHtml(entry.actorId || "")}">
                    <i class="fas ${transfer ? "fa-arrow-right-arrow-left" : "fa-link"}"></i>
                    ${transfer ? "Trasferisci" : "Aggiungi"}
                </button>
            </article>`;
        }).join("");
        dialog.innerHTML = `<div class="managed-companion-picker-shell">
            <header><span><small>Legami del personaggio</small><strong>Aggiungi companion a ${escapeHtml(playerName || characterId)}</strong></span><button type="button" data-companion-picker-close aria-label="Chiudi"><i class="fas fa-xmark"></i></button></header>
            <label class="managed-companion-picker-search"><i class="fas fa-magnifying-glass"></i><input type="search" placeholder="Cerca nella lista NPC..." autocomplete="off" data-companion-picker-search></label>
            <div class="managed-companion-picker-list">${rows || '<p class="managed-companion-picker-empty">Tutti gli NPC gestiti sono gia collegati.</p>'}</div>
            <footer><span data-companion-picker-status></span><button type="button" data-companion-picker-close>Chiudi</button></footer>
        </div>`;
        document.body.appendChild(dialog);
        const close = () => {
            try { dialog.close(); } catch (_) { /* Dialog gia chiuso. */ }
            dialog.remove();
        };
        dialog.querySelectorAll("[data-companion-picker-close]").forEach((button) => button.addEventListener("click", close));
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            close();
        });
        dialog.querySelector("[data-companion-picker-search]")?.addEventListener("input", (event) => {
            const query = String(event.currentTarget.value || "").trim().toLowerCase();
            dialog.querySelectorAll("[data-companion-candidate]").forEach((card) => {
                card.hidden = Boolean(query && !String(card.dataset.search || "").includes(query));
            });
        });
        dialog.querySelectorAll("[data-companion-link]").forEach((button) => button.addEventListener("click", async () => {
            const entry = candidates.find((candidate) => String(candidate.actorId || "") === String(button.dataset.actor || "")
                && String(candidate.worldId || "") === String(button.dataset.world || ""));
            if (!entry) return;
            const transfer = entry.ownerCharacterId && normalize(entry.ownerCharacterId) !== normalize(characterId);
            if (transfer && !window.confirm(`${entry.name} e gia companion di ${entry.ownerCharacterId}. Trasferirlo a ${playerName || characterId}?`)) return;
            const status = dialog.querySelector("[data-companion-picker-status]");
            button.disabled = true;
            if (status) status.textContent = "Salvataggio...";
            try {
                await saveCompanionRelationship(entry, characterId);
                close();
                await onRefresh();
            } catch (error) {
                button.disabled = false;
                if (status) status.textContent = error.message || "Collegamento non riuscito.";
            }
        }));
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
    }

    function setupCompanionManagement(section, result, characterId, playerName, onRefresh) {
        section.querySelector("[data-companion-add]")?.addEventListener("click", () => openCompanionPicker(result, characterId, playerName, onRefresh));
        section.querySelectorAll("[data-companion-unlink]").forEach((button) => button.addEventListener("click", async () => {
            const card = button.closest(".managed-companion-card");
            const entry = result.managed.find((candidate) => String(candidate.actorId || "") === String(card?.dataset.managedCompanionActor || ""));
            if (!entry || !window.confirm(`Rimuovere ${entry.name || "questo NPC"} dai companion di ${playerName || characterId}? L'Actor non verra cancellato.`)) return;
            button.disabled = true;
            const status = section.querySelector("[data-companion-management-status]");
            if (status) status.textContent = "Salvataggio...";
            try {
                await saveCompanionRelationship(entry, "");
                await onRefresh();
            } catch (error) {
                button.disabled = false;
                if (status) status.textContent = error.message || "Rimozione non riuscita.";
            }
        }));
    }
    function renderCompanions(host, characterId, playerName, result, options = {}, actor = null) {
        const canManage = options.canManageCompanions === true;
        const cards = [
            ...result.managed.map((entry) => managedCompanionCard(entry, playerName, canManage)),
            ...result.legacy.map((entry) => legacyCompanionCard(entry, playerName))
        ];
        setSectionNavVisible("managed-companions", cards.length > 0 || canManage);
        if (!cards.length && !canManage) return false;
        const section = document.createElement("section");
        section.className = "managed-panel managed-panel--wide managed-player-companions";
        section.id = "managed-companions";
        const actions = canManage ? `<span class="managed-companion-management"><span data-companion-management-status></span><button type="button" data-companion-add><i class="fas fa-plus"></i> Aggiungi companion</button></span>` : "";
        const empty = canManage && !cards.length ? '<div class="managed-companion-empty-state"><i class="fas fa-paw"></i><strong>Nessun companion collegato</strong><span>Scegli un NPC gia presente nel flusso gestito.</span></div>' : "";
        section.innerHTML = `<header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Legami</span><h2><i class="fas fa-paw"></i> Companion</h2></div><span class="managed-companion-heading-actions">${actions}<span class="managed-count-badge">${cards.length}</span></span></header><div class="managed-companion-grid">${cards.join("")}${empty}</div>`;
        host.appendChild(section);
        applyCompanionFrameCircles(section, result);
        setupCompanionInteractions(section);
        if (canManage && actor) setupCompanionManagement(section, result, characterId, playerName, () => mount({ companions: host }, actor, options));
        return true;
    }
    function normalizeTrees(data) {
        if (!Array.isArray(data)) return data && typeof data === "object" ? data : {};
        return data.reduce((result, entry) => {
            if (!entry || typeof entry !== "object") return result;
            const tree = entry.tree && typeof entry.tree === "object" ? entry.tree : entry;
            const key = String(entry.id || entry.key || entry.characterId || entry.treeKey || "").trim();
            if (!key || !Array.isArray(tree.nodes)) return result;
            const scope = tree.scope || entry.scope || "";
            const shared = tree.shared === true || entry.shared === true || ["campaign", "shared", "global"].includes(normalize(scope));
            result[key] = {
                ...tree,
                id: key,
                key,
                name: tree.name || entry.name || entry.title || "",
                scope: shared ? "campaign" : scope,
                shared,
                ownerCharacterId: shared ? "" : (tree.ownerCharacterId || entry.ownerCharacterId || entry.characterId || ""),
                characterId: shared ? "" : (tree.characterId || entry.characterId || "")
            };
            return result;
        }, {});
    }

    function serializeTrees(value) {
        return Object.entries(value || {})
            .filter(([, tree]) => tree && typeof tree === "object" && Array.isArray(tree.nodes))
            .map(([id, tree]) => ({ ...tree, id }));
    }

    async function loadTrees() {
        try {
            const payload = await getApi("api/data/skill-trees", { query: { _: Date.now() } });
            if (Array.isArray(payload?.data) && payload.data.length) {
                skillsVersion = Number(payload.version || 0);
                skills = normalizeTrees(payload.data);
                return skills;
            }
        } catch (_) {
            // Usa la raccolta statica senza mutarla.
        }
        const fallback = await window.CriptaApp?.data?.json?.("skills.json").catch(() => ({}));
        skillsVersion = null;
        skills = normalizeTrees(fallback || {});
        return skills;
    }

    async function loadStates() {
        try {
            const payload = await getApi("api/data/skill-tree-states", { query: { _: Date.now() } });
            statesVersion = Number(payload?.version || 0);
            states = Array.isArray(payload?.data) ? payload.data : [];
        } catch (_) {
            statesVersion = null;
            states = [];
        }
        return states;
    }

    async function saveTrees(nextTrees) {
        const body = { data: serializeTrees(nextTrees) };
        if (Number.isFinite(Number(skillsVersion))) body.expectedVersion = Number(skillsVersion);
        const result = await window.CriptaApp.api.post("api/data/skill-trees", body, { token: token() });
        skillsVersion = Number(result?.version || skillsVersion || 0);
        skills = nextTrees;
        return result;
    }

    function resolveSkillAssetPath(path) {
        const value = String(path || "").trim();
        if (!value || /^(data:|blob:)/i.test(value)) return value;
        if (/^https?:/i.test(value)) return value;
        const legacy = value.replace(/\\/g, "/").match(/(?:^|\/)skill_trees\/([^?#/]+)(?:[?#].*)?$/i);
        if (legacy) return window.CriptaApp.urls.api(`media/campaigns/${campaignId()}/skill-trees/${legacy[1]}`);
        if (value.startsWith("media/")) return window.CriptaApp.urls.api(value);
        if (value.startsWith("/media/")) return window.CriptaApp.urls.api(value.slice(1));
        if (value.startsWith("/")) return value;
        return window.CriptaApp.urls.api(`media/campaigns/${campaignId()}/skill-trees/${value}`);
    }

    function normalizeEditableHtml(element) {
        const source = element?.cloneNode?.(true);
        if (!source) return "<p></p>";
        source.querySelectorAll("script, style, iframe, object, embed").forEach((entry) => entry.remove());
        source.querySelectorAll("*").forEach((entry) => {
            const tag = entry.tagName.toLowerCase();
            if (["font", "small", "big", "span"].includes(tag)) {
                while (entry.firstChild) entry.parentNode.insertBefore(entry.firstChild, entry);
                entry.remove();
                return;
            }
            if (!["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"].includes(tag)) {
                entry.replaceWith(document.createTextNode(entry.textContent || ""));
                return;
            }
            Array.from(entry.attributes).forEach((attribute) => entry.removeAttribute(attribute.name));
        });
        return source.innerHTML.trim() || "<p></p>";
    }

    async function resizeWebp(file, width, height, quality = 0.86, cover = false) {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: true });
        context.clearRect(0, 0, width, height);
        const scale = cover ? Math.max(width / bitmap.width, height / bitmap.height) : Math.min(1, width / bitmap.width, height / bitmap.height);
        const drawWidth = Math.max(1, bitmap.width * scale);
        const drawHeight = Math.max(1, bitmap.height * scale);
        context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
        bitmap.close?.();
        return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Conversione WebP fallita.")), "image/webp", quality));
    }

    async function squareWebp(file, size = SKILL_TREE_ICON_SIZE, quality = 0.86) {
        return resizeWebp(file, size, size, quality, true);
    }

    async function boundedWebp(file, maxSize = 1600, quality = 0.86) {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        bitmap.close?.();
        return resizeWebp(file, width, height, quality, false);
    }

    async function renderSkillTrees(host, actor, characterId) {
        await ensureSkillTreeAssets();
        if (!window.CriptaCharacterSkillTree) {
            setSectionNavVisible("managed-player-skill-trees", false);
            return false;
        }
        const [allTrees, allStates, authState, isDm] = await Promise.all([
            loadTrees(),
            loadStates(),
            window.CriptaDiscordAuth?.verify?.().catch(() => null),
            window.CriptaDiscordAuth?.isCurrentUserDm?.("../../").catch(() => false)
        ]);
        if (!host.isConnected) return;
        const authAccountId = String(authState?.user?.accountId || authState?.user?.id || authState?.user?.sub || "").trim();
        const character = {
            id: characterId,
            name: actor.name || characterId,
            accountId: actor.ownerAccountIds?.[0] || (actor.permissions?.isOwner ? authAccountId : "")
        };
        const context = {
            PLAYER_SKILL_TREE_KEYS,
            skillsMemoryCache: allTrees,
            skillTreeStatesMemoryCache: allStates,
            skillTreeStatesVersion: statesVersion,
            skillTreeAuthState: authState,
            skillTreeCurrentUserIsDm: Boolean(isDm),
            escapeHtml,
            normalizeText: normalize,
            slugify,
            getCurrentCampaignId: campaignId,
            readSharedAuthToken: token,
            resolveSkillAssetPath,
            normalizeSkillTreeEditableHtml: normalizeEditableHtml,
            resizeImageFileToSquareWebpBlobShared: squareWebp,
            resizeImageFileToWebpBlobShared: boundedWebp,
            loadSkillTreeStates: async () => states,
            saveSkillTreesData: saveTrees,
            setSkillTreeStates(nextStates, version) {
                states = Array.isArray(nextStates) ? nextStates : [];
                if (Number.isFinite(Number(version))) statesVersion = Number(version);
            },
            setSkillsCache(nextTrees, version) {
                skills = nextTrees || {};
                if (Number.isFinite(Number(version))) skillsVersion = Number(version);
            }
        };
        const cards = window.CriptaCharacterSkillTree.buildCards(character, allTrees, context);
        if (!cards) {
            setSectionNavVisible("managed-player-skill-trees", false);
            return false;
        }
        setSectionNavVisible("managed-player-skill-trees", true);
        const section = document.createElement("section");
        section.className = "managed-panel managed-panel--wide managed-player-skill-trees";
        section.id = "managed-player-skill-trees";
        section.innerHTML = `<header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Progressione</span><h2><i class="fas fa-diagram-project"></i> Alberi abilit&agrave;</h2></div></header>`;
        section.appendChild(cards);
        host.appendChild(section);
        return true;
    }

    async function mount(targets, actor, options = {}) {
        if (!targets || !actor) return;
        const targetMap = Object.prototype.hasOwnProperty.call(targets, "companions") || Object.prototype.hasOwnProperty.call(targets, "skillTrees");
        const companionHost = targetMap ? (targets.companions || null) : targets;
        const skillTreeHost = targetMap ? (targets.skillTrees || null) : targets;
        const hosts = [...new Set([companionHost, skillTreeHost].filter(Boolean))];
        const characterId = slugify(actor.ownerCharacterId || new URLSearchParams(window.location.search).get("character") || "");
        if (!characterId) {
            hosts.forEach((host) => host.remove());
            setSectionNavVisible("managed-companions", false);
            setSectionNavVisible("managed-player-skill-trees", false);
            return;
        }
        const loading = `<div class="managed-player-extension-loading"><i class="fas fa-circle-notch fa-spin"></i> Caricamento...</div>`;
        hosts.forEach((host) => { host.innerHTML = loading; });
        const result = await loadCompanions(characterId);
        if (!hosts.some((host) => host.isConnected)) return;
        hosts.forEach((host) => { host.innerHTML = ""; });
        if (companionHost?.isConnected) renderCompanions(companionHost, characterId, actor.name || characterId, result, options, actor);
        if (skillTreeHost?.isConnected) await renderSkillTrees(skillTreeHost, actor, characterId);
    }

    window.CriptaManagedPlayerExtensions = Object.freeze({ mount });
})();
