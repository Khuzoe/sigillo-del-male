window.CriptaApp.onPageReady("giocatori", async function() {
    const container = document.getElementById("player-list-container");
    const basePath = "../assets/";
    const dataUrl = (pathname) => window.CriptaApp?.urls?.data?.(pathname) || `../assets/data/${String(pathname || "").replace(/^\/+/, "")}`;
    if (!container) return;

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeText(value) {
        return String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
    }

    function normalizeImageAdjust(adjust) {
        const x = Number(adjust?.x);
        const y = Number(adjust?.y);
        const size = Number(adjust?.size);
        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            size: Number.isFinite(size) && size > 0 ? size : null
        };
    }

    function buildImageStyle(kind, adjust, counterpartAdjust) {
        const normalized = normalizeImageAdjust(adjust);
        const counterpart = normalizeImageAdjust(counterpartAdjust);
        const isHover = kind === "hover";
        const restScale = isHover ? (counterpart.size || 1) : (normalized.size || 1);
        const hoverScale = isHover
            ? (normalized.size || 1.20)
            : (counterpart.size || (normalized.size ? normalized.size * 1.20 : 1.20));
        return `--img-x:${normalized.x}px; --img-y:${normalized.y}px; --img-scale-rest:${restScale}; --img-scale-hover:${hoverScale};`;
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

    function getAvatarVariantPath(path) {
        const value = String(path || "").trim();
        if (!value || !/\.webp(?:[?#].*)?$/i.test(value)) return "";
        return value.replace(/\.webp(?=([?#].*)?$)/i, "-avatar.webp");
    }

    async function fetchJson(url, fallback) {
        try {
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

    function findPlayerActor(inventorySnapshot, player) {
        const actors = Array.isArray(inventorySnapshot?.actors) ? inventorySnapshot.actors : [];
        if (!actors.length) return null;

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
        const accountId = normalizeText(player.accountId);
        const discordId = normalizeText(player.discordId);
        const playerName = normalizeText(player.name);
        return companions
            .filter((companion) => {
                const ownerCharacterId = normalizeText(companion.ownerCharacterId);
                const ownerAccountId = normalizeText(companion.ownerAccountId);
                const ownerDiscordId = normalizeText(companion.ownerDiscordId);
                return Boolean(ownerCharacterId && (ownerCharacterId === playerId || ownerCharacterId === playerName))
                    || Boolean(ownerAccountId && ownerAccountId === accountId)
                    || Boolean(ownerDiscordId && ownerDiscordId === discordId);
            })
            .sort((left, right) => String(left.displayName || left.name || "").localeCompare(String(right.displayName || right.name || ""), "it"));
    }

    function resolveCompanionImageUrl(companion) {
        const tokenPath = companion?.token?.img || "";
        const avatarVariant = getAvatarVariantPath(tokenPath);
        return Array.from(new Set([
            resolvePublicImageUrl(avatarVariant),
            resolvePublicImageUrl(companion?.img),
            resolvePublicImageUrl(tokenPath)
        ].filter(Boolean)));
    }

    function renderCompanionBadge(companions) {
        if (!companions.length) return "";
        const companion = companions[0];
        const title = companion.displayName || companion.name || "Companion";
        const imageCandidates = resolveCompanionImageUrl(companion);
        const image = imageCandidates[0] || "";
        const fallbackImage = imageCandidates[1] || "";
        const imageErrorHandler = fallbackImage
            ? "if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.style.display='none';this.nextElementSibling.hidden=false;}"
            : "this.style.display='none';this.nextElementSibling.hidden=false;";
        const initials = String(title || "?").trim().charAt(0).toUpperCase() || "?";
        const extra = companions.length > 1 ? companions.length - 1 : 0;
        return `
            <span class="player-companion-badge" title="${escapeHtml(companions.map((item) => item.displayName || item.name || "Companion").join(", "))}">
                ${image ? `<img src="${escapeHtml(image)}" ${fallbackImage ? `data-fallback-src="${escapeHtml(fallbackImage)}"` : ""} alt="${escapeHtml(title)}" onerror="${imageErrorHandler}">` : ""}
                <span ${image ? "hidden" : ""}>${escapeHtml(initials)}</span>
                ${extra ? `<small>+${extra}</small>` : ""}
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
        const equipped = Array.isArray(actor.equippedItems) ? actor.equippedItems : [];
        const attuned = Array.isArray(actor.attunementItems) ? actor.attunementItems : [];
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
        const isInactive = player.isActive === false;
        const cardClasses = `npc-card player-card ${isInactive ? "player-card--inactive" : ""}`.trim();
        const statusBadge = isInactive
            ? `<span class="player-status-badge">${escapeHtml(player.statusLabel || "Fuori dal gruppo")}</span>`
            : "";
        const syncInfo = inventorySnapshot?.savedAt || inventorySnapshot?.generatedAt
            ? `<span class="player-sync-stamp" title="Ultimo sync Foundry"><i class="fas fa-rotate" aria-hidden="true"></i> ${escapeHtml(formatDateTime(inventorySnapshot.savedAt || inventorySnapshot.generatedAt))}</span>`
            : "";

        return `
            <a href="../pages/characters/character.html?id=${encodeURIComponent(player.id)}&type=player" class="${cardClasses}">
                <div class="npc-avatar-container">
                    <img src="${escapeHtml(resolveImageUrl(player.images?.avatar))}" alt="${escapeHtml(player.name)}" class="npc-img-pop img-main" style="${buildImageStyle("avatar", player.images?.avatarAdjust, player.images?.hoverAdjust)}" onerror="this.src='https://placehold.co/200x200/1a1a1a/gold?text=${encodeURIComponent(String(player.name || "?").charAt(0))}'">
                    <img src="${escapeHtml(resolveImageUrl(player.images?.hover))}" alt="${escapeHtml(player.name)} Full" class="npc-img-pop img-hover" style="${buildImageStyle("hover", player.images?.hoverAdjust, player.images?.avatarAdjust)}" onerror="this.style.display='none'">
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

    try {
        const [players, inventorySnapshot] = await Promise.all([
            fetchJson(dataUrl("players.json"), []),
            loadInventorySnapshot()
        ]);
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

        container.innerHTML = visiblePlayers
            .map((player) => renderPlayerCard(player, findPlayerActor(inventorySnapshot, player), inventorySnapshot))
            .join("");
    } catch (error) {
        console.error("Errore nel caricamento dei dati dei giocatori:", error);
        container.innerHTML = '<p style="color: var(--status-dead);">Impossibile caricare i dati dei giocatori. Controlla la console per maggiori dettagli.</p>';
    }
});
