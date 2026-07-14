window.CriptaApp.onPageReady("giocatori", async function() {
    const container = document.getElementById("player-list-container");
    const basePath = "../assets/";
    const dataUrl = (pathname) => window.CriptaApp?.urls?.data?.(pathname) || `../assets/data/${String(pathname || "").replace(/^\/+/, "")}`;
    if (!container) return;

    function escapeHtml(value) {
        return window.CriptaApp.utils.escapeHtml(value);
    }

    function normalizeText(value) {
        return window.CriptaApp.utils.normalizeKey(value);
    }

    function normalizeRosterSearch(value) {
        return String(value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("it")
            .trim();
    }

    const HIDDEN_INVENTORY_ITEM_NAMES = new Set(["unarmedstrike"]);

    function isHiddenInventoryItem(item) {
        return HIDDEN_INVENTORY_ITEM_NAMES.has(normalizeText(item?.name));
    }

    function slugify(value) {
        return window.CriptaApp.utils.slugify(value, "personaggio");
    }

    function getCurrentCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function getSyncedPlayerImagePath(player, variant = "avatar") {
        const playerId = slugify(player?.id || player?.name || "personaggio");
        const campaignId = getCurrentCampaignId();
        const suffix = variant === "token"
            ? "-token"
            : variant === "hover"
                ? "-hover"
                : variant === "idle" || variant === "card"
                    ? "-idle"
                    : "-avatar";
        return `media/campaigns/${campaignId}/players/${playerId}${suffix}.webp`;
    }

    function getLegacySyncedPlayerImagePath(player, variant = "avatar") {
        const playerId = slugify(player?.id || player?.name || "personaggio");
        const campaignId = getCurrentCampaignId();
        if (campaignId !== "cripta-di-sangue") return "";
        if (variant === "idle" || variant === "card") return `media/players/${playerId}.webp`;
        if (variant === "hover") return `media/players/${playerId}_animation.webp`;
        const suffix = variant === "token" ? "-token" : "-avatar";
        return `media/players/${playerId}${suffix}.webp`;
    }

    function getLegacySyncedPlayerAvatarPath(player) {
        const playerId = slugify(player?.id || player?.name || "personaggio");
        const campaignId = getCurrentCampaignId();
        if (campaignId !== "cripta-di-sangue") return "";
        return `media/players/${playerId}.webp`;
    }

    function getPlayerImages(player) {
        const images = { ...(player?.images || {}) };
        const fallbackAvatar = getSyncedPlayerImagePath(player, "avatar");
        const syncedIdle = getSyncedPlayerImagePath(player, "idle");
        const syncedHover = getSyncedPlayerImagePath(player, "hover");
        const legacyIdle = getLegacySyncedPlayerImagePath(player, "idle") || getLegacySyncedPlayerAvatarPath(player);
        const legacyHover = getLegacySyncedPlayerImagePath(player, "hover");
        const legacyAvatar = getLegacySyncedPlayerAvatarPath(player);
        images.idle = images.idle || images.card || images.list || images.showcase || syncedIdle;
        if (!images.idleFallback && images.idle === syncedIdle) images.idleFallback = legacyIdle;
        images.cardHover = images.cardHover || images.listHover || images.showcaseHover || syncedHover;
        if (!images.cardHoverFallback && images.cardHover === syncedHover) images.cardHoverFallback = legacyHover || legacyIdle;
        if (!images.avatar) images.avatar = fallbackAvatar;
        if (!images.avatarFallback && images.avatar === fallbackAvatar) images.avatarFallback = legacyAvatar;
        if (getCurrentCampaignId() === "cripta-di-sangue" && images.hover && images.hover.startsWith("media/players/")) {
            images.hoverFallback = images.hover;
            images.hover = syncedHover;
        }
        if (!images.hover) images.hover = images.avatar;
        if (!images.hoverFallback && images.hover === fallbackAvatar) images.hoverFallback = legacyAvatar;
        if (!images.portrait) images.portrait = images.avatar;
        if (!images.token) images.token = getSyncedPlayerImagePath(player, "token");
        if (!images.tokenFallback && images.token === getSyncedPlayerImagePath(player, "token")) images.tokenFallback = getLegacySyncedPlayerImagePath(player, "token");
        const managedMedia = player?._managedActor?.media || null;
        if (managedMedia) {
            const idleDescriptor = managedMedia.idle || managedMedia.token || managedMedia.avatar || null;
            const hoverDescriptor = managedMedia.hover || managedMedia.idle || managedMedia.token || managedMedia.avatar || null;
            const tokenDescriptor = managedMedia.token || managedMedia.avatar || null;
            if (idleDescriptor?.path) images.idle = idleDescriptor.path;
            if (hoverDescriptor?.path) images.cardHover = hoverDescriptor.path;
            if (tokenDescriptor?.path) images.token = tokenDescriptor.path;
            images._managedIdleDescriptor = idleDescriptor;
            images._managedHoverDescriptor = hoverDescriptor;
            images._managedTokenDescriptor = tokenDescriptor;
        }
        return images;
    }

    async function resolvePlayerCardImageAvailability(players) {
        const list = Array.isArray(players) ? players : [];
        await Promise.all(list.map(async (player) => {
            const images = getPlayerImages(player);
            const cardUrl = resolveImageUrl(images.idle);
            const hoverUrl = resolveImageUrl(images.cardHover);
            const [hasCard, hasHover] = await Promise.all([
                imageExists(cardUrl),
                imageExists(hoverUrl)
            ]);
            player._hasDedicatedCardImages = Boolean(hasCard && hasHover);
        }));
    }

    function imageExists(url) {
        if (!url) return Promise.resolve(false);
        return new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = url;
        });
    }

    function buildImageStyle(kind, adjust, counterpartAdjust) {
        return window.CriptaImageAdjust.buildNpcImageStyle(kind, adjust, counterpartAdjust);
    }

    function resolveImageUrl(path) {
        const value = String(path || "").trim();
        if (!value) return "";
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith("media/")) return window.CriptaApp.urls.api(value);
        if (value.startsWith("/media/")) return window.CriptaApp.urls.api(value.slice(1));
        if (value.startsWith("assets/")) return `../${value}`;
        return `${basePath}${value}`;
    }

    function resolvePublicImageUrl(path) {
        const value = String(path || "").trim();
        if (!value) return "";
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith("media/")) return window.CriptaApp.urls.api(value);
        if (value.startsWith("/media/")) return window.CriptaApp.urls.api(value.slice(1));
        if (value.startsWith("assets/")) return `../${value}`;
        if (value.startsWith("campaigns/")) return `../${value}`;
        if (value.startsWith("img/")) return window.CriptaApp.urls.api(value);
        return "";
    }

    function buildFallbackImageErrorHandler(fallbackPath, placeholderText, hideOnFailure = false) {
        const fallbackUrl = resolveImageUrl(fallbackPath);
        const placeholderUrl = `https://placehold.co/200x200/1a1a1a/gold?text=${encodeURIComponent(String(placeholderText || "?").charAt(0))}`;
        const failureAction = hideOnFailure ? "this.style.display='none';" : `this.src='${placeholderUrl}';`;
        if (fallbackUrl) {
            return `if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{${failureAction}}`;
        }
        return failureAction;
    }

    function getAvatarVariantPath(path) {
        const value = String(path || "").trim();
        if (!value || !/\.webp(?:[?#].*)?$/i.test(value)) return "";
        return value.replace(/\.webp(?=([?#].*)?$)/i, "-avatar.webp");
    }

    async function fetchJson(url, fallback) {
        try {
            if (typeof window.CriptaApp?.fetchJson === "function") {
                return await window.CriptaApp.fetchJson(url, { clone: true });
            }
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        } catch (error) {
            console.warn(`Impossibile caricare ${url}`, error);
            return fallback;
        }
    }

    async function loadInventorySnapshot() {
        try {
            if (typeof window.CriptaApp?.api?.get === "function") {
                return await window.CriptaApp.api.get("api/inventory");
            }
            const inventoryUrl = new URL("https://sigillo-api.khuzoe.workers.dev/api/inventory");
            inventoryUrl.searchParams.set("campaign", window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue");
            const response = await fetch(inventoryUrl.toString());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        } catch (error) {
            console.warn("Inventory API non disponibile per lista giocatori.", error);
            return null;
        }
    }


    async function loadManagedPlayerIndex() {
        try {
            if (typeof window.CriptaApp?.api?.get !== "function") return [];
            const token = String(window.CriptaDiscordAuth?.getToken?.() || "").trim();
            const payload = await window.CriptaApp.api.get("api/managed-actors", {
                cache: false,
                ...(token ? { token } : {})
            });
            return Array.isArray(payload?.data) ? payload.data : [];
        } catch (error) {
            console.warn("Actor gestiti non disponibili per la lista giocatori.", error);
            return [];
        }
    }

    function attachManagedPlayers(players, managedEntries) {
        (Array.isArray(players) ? players : []).forEach((player) => {
            const playerId = normalizeText(player?.id);
            const entry = (Array.isArray(managedEntries) ? managedEntries : []).find((candidate) => {
                const owner = normalizeText(candidate?.ownerCharacterId);
                const relationship = normalizeText(candidate?.relationshipType);
                const actorType = normalizeText(candidate?.actorType);
                return owner === playerId && (relationship === "player" || actorType === "character" || actorType === "player");
            });
            if (entry) player._managedActor = entry;
        });
    }

    function applyManagedPlayerFrameCircles(root, players) {
        const cards = Array.from(root.querySelectorAll(".player-card"));
        (Array.isArray(players) ? players : []).forEach((player, index) => {
            const card = cards[index];
            if (!card) return;
            const images = getPlayerImages(player);
            const animated = player._hasDedicatedCardImages === true && images.idle && images.cardHover && images.cardHover !== images.idle;
            const idleDescriptor = animated ? images._managedIdleDescriptor : (images._managedTokenDescriptor || images._managedIdleDescriptor);
            const hoverDescriptor = animated ? images._managedHoverDescriptor : idleDescriptor;
            const idleCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(idleDescriptor?.presentation?.frameCircle);
            const hoverCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(hoverDescriptor?.presentation?.frameCircle);
            if (!idleCircle && !hoverCircle) return;
            const host = card.querySelector(".npc-avatar-container");
            const idleImage = card.querySelector(".img-main");
            const hoverImage = card.querySelector(".img-hover");
            if (host) host.dataset.frameCircleHost = "true";
            if (idleImage && idleCircle) window.CriptaImageAdjust.setFrameCircleDataset(idleImage, idleCircle);
            if (hoverImage && hoverCircle) window.CriptaImageAdjust.setFrameCircleDataset(hoverImage, hoverCircle);
        });
        window.CriptaImageAdjust?.initFrameCircleImages?.(root);
    }
    function findPlayerActor(inventorySnapshot, player) {
        const actors = Array.isArray(inventorySnapshot?.actors) ? inventorySnapshot.actors : [];
        if (!actors.length) return null;
        const playerId = normalizeText(player.id);
        const byCharacterId = actors.find((actor) => {
            const ownerCharacterId = normalizeText(actor.ownerCharacterId || actor.characterId);
            return ownerCharacterId && ownerCharacterId === playerId;
        });
        if (byCharacterId) return byCharacterId;

        const keys = new Set([
            normalizeText(player.name),
            normalizeText(player.id),
            normalizeText(player.inventory_api_name)
        ].filter(Boolean));

        if (Array.isArray(player.inventory_api_aliases)) {
            player.inventory_api_aliases.forEach((alias) => keys.add(normalizeText(alias)));
        }

        const exact = actors.find((actor) => keys.has(normalizeText(actor.name)));
        if (exact) return exact;

        return actors.find((actor) => {
            const actorKey = normalizeText(actor.name);
            if (!actorKey) return false;
            return [...keys].some((key) => key && (actorKey.includes(key) || key.includes(actorKey)));
        }) || null;
    }

    function getPlayerCompanions(inventorySnapshot, player) {
        const companions = Array.isArray(inventorySnapshot?.companions) ? inventorySnapshot.companions : [];
        if (!companions.length || !player) return [];
        const playerId = normalizeText(player.id);
        const playerName = normalizeText(player.name);
        return companions
            .filter((companion) => {
                const ownerCharacterId = normalizeText(companion.ownerCharacterId);
                if (!ownerCharacterId) return false;
                return ownerCharacterId === playerId || ownerCharacterId === playerName;
            })
            .sort((left, right) => String(left.displayName || left.name || "").localeCompare(String(right.displayName || right.name || ""), "it"));
    }

    function buildReadableAssetSlug(...parts) {
        const seen = new Set();
        return parts
            .map((part) => slugify(part || ""))
            .filter(Boolean)
            .filter((part) => {
                if (seen.has(part)) return false;
                seen.add(part);
                return true;
            })
            .join("-");
    }

    function getCompanionReadableEntityId(ownerCharacterId, companion) {
        const companionActorId = companion?.actorId || companion?.id || "";
        const companionName = companion?.foundryName || companion?.name || companion?.displayName || "companion";
        return buildReadableAssetSlug(ownerCharacterId || "personaggio", companionName, companionActorId);
    }

    function resolveCompanionImageUrl(companion) {
        const tokenPath = companion?.token?.img || "";
        const avatarVariant = getAvatarVariantPath(tokenPath);
        const ownerCharacterId = slugify(companion?.ownerCharacterId || companion?.characterId || "");
        const syncedEntityId = ownerCharacterId ? getCompanionReadableEntityId(ownerCharacterId, companion) : "";
        const campaignId = getCurrentCampaignId();
        const companionFolder = `campaigns/${campaignId}/companions/${ownerCharacterId}`;
        const legacyCompanionFolder = campaignId === "cripta-di-sangue" ? `companions/${ownerCharacterId}` : "";
        const syncedToken = syncedEntityId ? `media/${companionFolder}/${syncedEntityId}-token.webp` : "";
        const syncedAvatar = syncedEntityId ? `media/${companionFolder}/${syncedEntityId}-avatar.webp` : "";
        const legacySyncedToken = syncedEntityId && legacyCompanionFolder ? `media/${legacyCompanionFolder}/${syncedEntityId}-token.webp` : "";
        const legacySyncedAvatar = syncedEntityId && legacyCompanionFolder ? `media/${legacyCompanionFolder}/${syncedEntityId}-avatar.webp` : "";
        return Array.from(new Set([
            resolvePublicImageUrl(syncedToken),
            resolvePublicImageUrl(syncedAvatar),
            resolvePublicImageUrl(legacySyncedToken),
            resolvePublicImageUrl(legacySyncedAvatar),
            resolvePublicImageUrl(tokenPath),
            resolvePublicImageUrl(companion?.img),
            resolvePublicImageUrl(avatarVariant),
            resolvePublicImageUrl(tokenPath)
        ].filter(Boolean)));
    }

    function renderCompanionBadge(companions) {
        if (!companions.length) return "";
        const title = companions.map((item) => item.displayName || item.name || "Companion").join(", ");
        const badges = companions.map((companion, index) => {
            const companionTitle = companion.displayName || companion.name || "Companion";
            const imageCandidates = resolveCompanionImageUrl(companion);
            const image = imageCandidates[0] || "";
            const fallbackImage = imageCandidates[1] || "";
            const imageErrorHandler = fallbackImage
                ? "if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.style.display='none';this.nextElementSibling.hidden=false;}"
                : "this.style.display='none';this.nextElementSibling.hidden=false;";
            const initials = String(companionTitle || "?").trim().charAt(0).toUpperCase() || "?";
            return `
                <span class="player-companion-badge" style="--companion-index: ${index};" aria-label="${escapeHtml(companionTitle)}">
                    ${image ? `<img src="${escapeHtml(image)}" ${fallbackImage ? `data-fallback-src="${escapeHtml(fallbackImage)}"` : ""} alt="${escapeHtml(companionTitle)}" loading="lazy" decoding="async" onerror="${imageErrorHandler}">` : ""}
                    <span ${image ? "hidden" : ""}>${escapeHtml(initials)}</span>
                </span>
            `;
        }).join("");
        return `
            <span class="player-companion-badges" title="${escapeHtml(title)}" style="--companion-count: ${companions.length};">
                ${badges}
            </span>
        `;
    }

    function formatNumber(value, fallback = "-") {
        const number = Number(value);
        return Number.isFinite(number) ? String(Math.round(number)) : fallback;
    }

    function formatDateTime(value) {
        if (!value) return "mai";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "data non valida";
        return new Intl.DateTimeFormat("it-IT", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function getHp(actor) {
        const hp = actor?.vitals?.hp || {};
        return {
            value: hp.value,
            max: hp.max,
            temp: hp.temp
        };
    }

    function getSlots(actor) {
        const totals = actor?.spellSlots?.totals || {};
        const total = Number(totals.total);
        const available = Number(totals.available);
        if (!Number.isFinite(total) || total <= 0) return null;
        return { total, available: Number.isFinite(available) ? available : 0 };
    }

    function getWeight(actor) {
        const weight = actor?.weight || {};
        const carried = Number(weight.carried);
        const capacity = Number(weight.capacity);
        if (!Number.isFinite(carried) || !Number.isFinite(capacity)) return null;
        return {
            carried,
            capacity,
            percent: capacity > 0 ? Math.min(999, (carried / capacity) * 100) : null,
            encumbered: weight.encumbered === true
        };
    }

    function renderLiveStats(actor) {
        if (!actor) {
            return `
                <div class="player-live-panel player-live-panel--empty">
                    <span><i class="fas fa-cloud-slash" aria-hidden="true"></i> Dati Foundry non sincronizzati</span>
                </div>
            `;
        }

        const hp = getHp(actor);
        const slots = getSlots(actor);
        const weight = getWeight(actor);
        const equipped = Array.isArray(actor.equippedItems) ? actor.equippedItems.filter((item) => !isHiddenInventoryItem(item)) : [];
        const attuned = Array.isArray(actor.attunementItems) ? actor.attunementItems.filter((item) => !isHiddenInventoryItem(item)) : [];
        const ac = actor?.vitals?.ac;

        return `
            <div class="player-live-panel">
                <div class="player-live-stats">
                    <span><i class="fas fa-heart-pulse" aria-hidden="true"></i> ${formatNumber(hp.value)}/${formatNumber(hp.max)} PF${Number(hp.temp) > 0 ? ` +${formatNumber(hp.temp)} temp` : ""}</span>
                    <span><i class="fas fa-shield-halved" aria-hidden="true"></i> CA ${formatNumber(ac)}</span>
                    ${slots ? `<span><i class="fas fa-wand-sparkles" aria-hidden="true"></i> Slot ${formatNumber(slots.available)}/${formatNumber(slots.total)}</span>` : ""}
                    ${weight ? `<span class="${weight.encumbered ? "is-warning" : ""}"><i class="fas fa-weight-hanging" aria-hidden="true"></i> ${formatNumber(weight.carried)}/${formatNumber(weight.capacity)} kg</span>` : ""}
                </div>
                <div class="player-live-lists">
                    ${renderCompactItemList("Equip", equipped)}
                    ${renderCompactItemList("Sintonia", attuned)}
                </div>
            </div>
        `;
    }

    function renderCompactItemList(label, items) {
        const list = (Array.isArray(items) ? items : []).slice(0, 4);
        if (!list.length) return "";
        const extra = items.length > list.length ? ` +${items.length - list.length}` : "";
        return `
            <span class="player-live-items">
                <strong>${escapeHtml(label)}</strong>
                ${list.map((item) => `<em>${escapeHtml(item.name || "Oggetto")}</em>`).join("")}
                ${extra ? `<small>${escapeHtml(extra)}</small>` : ""}
            </span>
        `;
    }

    function renderPlayerCard(player, actor, inventorySnapshot) {
        const companions = getPlayerCompanions(inventorySnapshot, player);
        const images = getPlayerImages(player);
        const isInactive = player.isActive === false;
        const cardClasses = `npc-card player-card ${isInactive ? "player-card--inactive" : ""}`.trim();
        const statusBadge = isInactive
            ? `<span class="player-status-badge">${escapeHtml(player.statusLabel || "Fuori dal gruppo")}</span>`
            : "";
        const syncInfo = inventorySnapshot?.savedAt || inventorySnapshot?.generatedAt
            ? `<span class="player-sync-stamp" title="Ultimo sync Foundry"><i class="fas fa-rotate" aria-hidden="true"></i> ${escapeHtml(formatDateTime(inventorySnapshot.savedAt || inventorySnapshot.generatedAt))}</span>`
            : "";
        const campaignId = getCurrentCampaignId();
        const hasPlayerCardAnimation = player._hasDedicatedCardImages === true
            && images.idle
            && images.cardHover
            && images.cardHover !== images.idle;
        const tokenImage = images.token || "";
        const listImage = hasPlayerCardAnimation
            ? images.idle
            : tokenImage;
        const listHoverImage = hasPlayerCardAnimation
            ? images.cardHover
            : listImage;
        const listFallbackPath = hasPlayerCardAnimation
            ? (images.idleFallback || images.tokenFallback || images.token)
            : (images.tokenFallback || images.token);
        const hoverFallbackPath = hasPlayerCardAnimation
            ? (images.cardHoverFallback || listFallbackPath)
            : listFallbackPath;
        const listFallback = resolveImageUrl(listFallbackPath);
        const hoverFallback = resolveImageUrl(hoverFallbackPath);
        const listAdjust = images.idleAdjust || images.cardAdjust || images.listAdjust || images.tokenAdjust || images.avatarAdjust;
        const listHoverAdjust = images.cardHoverAdjust || images.listHoverAdjust || images.hoverAdjust || images.tokenHoverAdjust || listAdjust;
        const shouldSwapAvatar = listHoverImage && listHoverImage !== listImage;
        const cardClassWithSwap = `${cardClasses} ${shouldSwapAvatar ? "" : "npc-card--no-avatar-swap"}`.trim();
        const campaignQuery = campaignId && campaignId !== "cripta-di-sangue"
            ? `&campaign=${encodeURIComponent(campaignId)}`
            : "";

        const rosterSearch = normalizeRosterSearch([
            player.name,
            player.role,
            player.description,
            ...(Array.isArray(actor?.equippedItems) ? actor.equippedItems.map((item) => item?.name) : []),
            ...(Array.isArray(actor?.attunementItems) ? actor.attunementItems.map((item) => item?.name) : [])
        ].filter(Boolean).join(" "));

        return `
            <a href="../pages/characters/character.html?id=${encodeURIComponent(player.id)}&type=player${campaignQuery}" class="${cardClassWithSwap}" data-roster-card="player" data-roster-state="${isInactive ? "inactive" : "active"}" data-roster-search="${escapeHtml(rosterSearch)}">
                <div class="npc-avatar-container">
                    <img src="${escapeHtml(resolveImageUrl(listImage))}" ${listFallback ? `data-fallback-src="${escapeHtml(listFallback)}"` : ""} alt="${escapeHtml(player.name)} Token" class="npc-img-pop img-main" loading="lazy" decoding="async" style="${buildImageStyle("avatar", listAdjust, listHoverAdjust)}" onerror="${buildFallbackImageErrorHandler(listFallbackPath, player.name)}">
                    <img src="${escapeHtml(resolveImageUrl(listHoverImage))}" ${hoverFallback ? `data-fallback-src="${escapeHtml(hoverFallback)}"` : ""} alt="${escapeHtml(player.name)} Token" class="npc-img-pop img-hover" loading="lazy" decoding="async" style="${buildImageStyle("hover", listHoverAdjust, listAdjust)}" onerror="${buildFallbackImageErrorHandler(hoverFallbackPath, player.name, true)}">
                    ${renderCompanionBadge(companions)}
                </div>
                <div class="npc-info">
                    <div class="npc-header">
                        <h3 class="npc-name">${escapeHtml(player.name)}</h3>
                        <div class="player-card-meta">
                            <span class="npc-role">${escapeHtml(player.role)}</span>
                            ${statusBadge}
                            ${syncInfo}
                        </div>
                    </div>
                    <p class="npc-desc">${escapeHtml(player.description)}</p>
                    ${renderLiveStats(actor)}
                </div>
                <i class="fas fa-chevron-right arrow-icon"></i>
            </a>
        `;
    }

    function initPlayerRosterControls(root) {
        const search = document.getElementById("players-search");
        const filters = document.getElementById("players-state-filters");
        const countTargets = [document.getElementById("players-count"), document.getElementById("players-section-count")].filter(Boolean);
        const collection = root.closest(".roster-collection");
        const empty = document.getElementById("players-filter-empty");
        const state = { query: "", status: "all" };

        const apply = () => {
            const query = normalizeRosterSearch(state.query);
            const cards = Array.from(root.querySelectorAll('[data-roster-card="player"]'));
            let visibleTotal = 0;
            cards.forEach((card) => {
                const matchesQuery = !query || String(card.dataset.rosterSearch || "").includes(query);
                const matchesStatus = state.status === "all" || card.dataset.rosterState === state.status;
                card.hidden = !(matchesQuery && matchesStatus);
                if (!card.hidden) visibleTotal += 1;
            });
            const label = `${visibleTotal} ${visibleTotal === 1 ? "personaggio" : "personaggi"}`;
            countTargets.forEach((target) => { target.textContent = label; });
            if (collection) collection.hidden = visibleTotal === 0;
            if (empty) empty.hidden = visibleTotal !== 0;
        };

        search?.addEventListener("input", (event) => {
            state.query = event.target.value;
            apply();
        });
        filters?.addEventListener("click", (event) => {
            const button = event.target.closest("[data-roster-filter]");
            if (!button) return;
            state.status = button.dataset.rosterFilter || "all";
            filters.querySelectorAll("[data-roster-filter]").forEach((entry) => {
                const active = entry === button;
                entry.classList.toggle("is-active", active);
                entry.setAttribute("aria-pressed", active ? "true" : "false");
            });
            apply();
        });
        apply();
    }

    try {
        const [players, inventorySnapshot, managedPlayers] = await Promise.all([
            fetchJson(dataUrl("players.json"), []),
            loadInventorySnapshot(),
            loadManagedPlayerIndex()
        ]);
        attachManagedPlayers(players, managedPlayers);
        const visiblePlayers = window.WikiSpoiler ? window.WikiSpoiler.filterVisible(players) : players;

        if (!visiblePlayers.length) {
            container.innerHTML = "<p>Nessun giocatore trovato.</p>";
            return;
        }

        visiblePlayers.sort((a, b) => {
            const aInactive = a.isActive === false ? 1 : 0;
            const bInactive = b.isActive === false ? 1 : 0;
            if (aInactive !== bInactive) return aInactive - bInactive;
            return String(a.name || "").localeCompare(String(b.name || ""), "it");
        });

        await resolvePlayerCardImageAvailability(visiblePlayers);

        container.innerHTML = visiblePlayers
            .map((player) => renderPlayerCard(player, findPlayerActor(inventorySnapshot, player), inventorySnapshot))
            .join("");
        applyManagedPlayerFrameCircles(container, visiblePlayers);
        initPlayerRosterControls(container);
    } catch (error) {
        console.error("Errore nel caricamento dei dati dei giocatori:", error);
        container.innerHTML = '<p style="color: var(--status-dead);">Impossibile caricare i dati dei giocatori. Controlla la console per maggiori dettagli.</p>';
    }
});
