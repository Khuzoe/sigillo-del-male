(() => {
    let currentDocument = null;
    let currentCanEdit = false;
    let currentCanManageActor = false;
    let managedEditMode = false;
    let currentProfile = null;
    let currentProfilePermissions = { canEdit: false, isEditor: false };
    let campaignItemCatalog = [];
    let npcCategoryRegistry = { revision: 0, categories: [] };
    let managedProfileDirty = false;
    let managedProfileSource = "empty";
    const managedPreviewUrls = new Map();
    const managedProfileFiles = new Map();
    const managedProfilePreviewUrls = new Map();

    window.CriptaApp.onPageReady("managed-actor", async () => {
        const root = document.querySelector("[data-managed-actor-root]");
        if (!root) return;
        const params = new URLSearchParams(window.location.search);
        const worldId = params.get("world") || "";
        const actorId = params.get("actor") || "";
        if (!worldId || !actorId) {
            root.innerHTML = '<div class="managed-load-state"><i class="fas fa-triangle-exclamation"></i><strong>Identità Actor mancante</strong><span>Apri la scheda dal collegamento presente nella wiki.</span></div>';
            return;
        }
        if (params.get("profile") === "1") {
            try {
                const token = getToken();
                const profilePayload = await window.CriptaApp.api.get(`api/managed-actors/${encodeURIComponent(worldId)}/${encodeURIComponent(actorId)}/profile`, {
                    cache: false,
                    ...(token ? { token } : {})
                });
                currentProfile = normalizeManagedProfile(profilePayload.data, { worldId, actorId });
                currentProfilePermissions = profilePayload.permissions || { canEdit: false, isEditor: false };
                managedProfileSource = profilePayload.source || "profile";
                syncManagedActorNavigation(null);
                renderManagedProfileOnly(root, currentProfile);
                return;
            } catch (error) {
                console.warn("Vista dossier non disponibile, provo la scheda completa.", error);
            }
        }
        try {
            const token = getToken();
            const payload = await window.CriptaApp.api.get(`api/managed-actors/${encodeURIComponent(worldId)}/${encodeURIComponent(actorId)}`, {
                cache: false,
                ...(token ? { token } : {})
            });
            currentDocument = payload.data;
            syncManagedActorNavigation(currentDocument);
            const permissions = currentDocument?.permissions || {};
            currentCanManageActor = permissions.canEdit === true;
            currentCanEdit = permissions.canEditStats === true || currentCanManageActor;
            managedEditMode = false;
            await Promise.all([
                loadManagedActorProfile(currentDocument, token),
                currentCanEdit ? loadCampaignItemCatalog(token) : Promise.resolve([])
            ]);
            renderManagedActor(root, currentDocument, currentCanEdit, managedEditMode, currentCanManageActor);
        } catch (error) {
            console.error("Managed Actor non disponibile", error);
            root.innerHTML = `<div class="managed-load-state"><i class="fas fa-lock"></i><strong>Scheda non disponibile</strong><span>${escapeHtml(error.message || "Non è stato possibile caricare questo Actor.")}</span></div>`;
            try {
                const token = getToken();
                const profilePayload = await window.CriptaApp.api.get(`api/managed-actors/${encodeURIComponent(worldId)}/${encodeURIComponent(actorId)}/profile`, {
                    cache: false,
                    ...(token ? { token } : {})
                });
                currentProfile = normalizeManagedProfile(profilePayload.data, { worldId, actorId });
                currentProfilePermissions = profilePayload.permissions || { canEdit: false, isEditor: false };
                managedProfileSource = profilePayload.source || "profile";
                syncManagedActorNavigation(null);
                renderManagedProfileOnly(root, currentProfile);
                return;
            } catch (profileError) {
                console.warn("Dossier NPC non disponibile", profileError);
            }
        }
    });

    function getManagedActorRelationshipType(actor) {
        const requested = String(actor?.relationshipType || "").trim().toLowerCase();
        if (requested === "player" || requested === "companion") return requested;
        const actorType = String(actor?.actorType || "").trim().toLowerCase();
        if (actor?.ownerCharacterId && (actorType === "character" || actorType === "player")) return "player";
        if (actor?.ownerCharacterId && actorType === "npc") return "companion";
        return "";
    }

    function syncManagedActorNavigation(actor, fallback = "") {
        const defaultSection = fallback || (new URLSearchParams(window.location.search).has("character") ? "giocatori" : "npcs");
        const relationshipType = getManagedActorRelationshipType(actor);
        const actorType = String(actor?.actorType || "").trim().toLowerCase();
        const playerContext = relationshipType === "player"
            || relationshipType === "companion"
            || actorType === "character"
            || actorType === "player";
        window.CriptaApp?.navigation?.setActiveSection(playerContext ? "giocatori" : defaultSection);
    }

    function isPrimaryManagedPlayer(actor) {
        return getManagedActorRelationshipType(actor) === "player";
    }

    function renderManagedActor(root, actor, canEdit, editing = false, canManageActor = false) {
        const editMode = Boolean(canEdit && editing);
        const primaryPlayer = isPrimaryManagedPlayer(actor);
        clearManagedImagePreviews();
        root.classList.toggle("is-editing", editMode);
        root.classList.toggle("is-viewing", !editMode);
        root.dataset.managedDirty = "false";
        document.querySelectorAll("body > [data-managed-image-lightbox]").forEach((lightbox) => lightbox.remove());
        document.querySelectorAll("body > [data-managed-frame-circle-dialog]").forEach((entry) => {
            if (entry._managedFrameCircleResizeHandler) {
                window.removeEventListener("resize", entry._managedFrameCircleResizeHandler);
            }
            entry._managedFrameCircleResizeObserver?.disconnect?.();
            entry.remove();
        });
        document.body.classList.remove("managed-frame-circle-open");
        document.body.classList.remove("managed-image-lightbox-open");
        document.title = `${actor.name || "Actor"} - Cripta di Sangue`;
        const definition = actor.definition || {};
        const attributes = definition.attributes || {};
        const details = definition.details || {};
        const actorDetailsLabel = formatDetails(details);
        const media = actor.media || {};
        const avatarPath = media.avatar?.path || media.token?.path || "";
        const tokenPath = media.token?.path || avatarPath;
        const hasSiteAnimation = Boolean(media.idle?.path || media.hover?.path);
        const entries = Array.isArray(definition.items) ? definition.items : [];
        const abilities = definition.abilities || {};
        const skills = definition.skills || {};
        const traits = definition.traits || {};
        const effects = Array.isArray(definition.effects) ? definition.effects : [];
        const merchant = definition.merchant?.enabled ? definition.merchant : null;
        const variants = Array.isArray(media.variants) ? media.variants : [];
        const attackEntries = entries.filter((entry) => ["weapon", "feat"].includes(entry.type));
        const spellEntries = entries.filter((entry) => entry.type === "spell");
        const inventoryEntries = entries.filter((entry) => !["weapon", "feat", "spell", "class", "subclass"].includes(entry.type));

        root.innerHTML = `
            <nav class="managed-actor-breadcrumb" aria-label="Navigazione scheda">
                <a href="${escapeAttr(buildActorBackLink(actor))}"><i class="fas fa-arrow-left"></i> Torna alla wiki</a>
                <span><i class="fas fa-cloud"></i> Sincronizzato con Foundry</span>
            </nav>
            <section class="managed-actor-hero">
                <div class="managed-actor-art">
                    <div class="managed-actor-aura" aria-hidden="true"></div>
                    <div class="managed-actor-avatar">${renderManagedAvatarArtwork(media, avatarPath, actor.name || "Actor")}</div>
                    ${renderManagedTokenArtwork(tokenPath, actor.name || "Actor")}
                </div>
                <div class="managed-actor-title">
                    <h1>${editMode ? renderManagedActorControl("name", "text", actor.name || "Actor", { className: "managed-actor-name-input" }) : escapeHtml(actor.name || "Actor")}</h1>
                    ${currentProfile?.role ? `<p class="managed-profile-role">${escapeHtml(currentProfile.role)}</p>` : ""}
                    ${currentProfile?.quote ? `<blockquote class="managed-profile-quote">${escapeHtml(currentProfile.quote)}</blockquote>` : ""}
                    ${renderManagedHeroVitals(attributes, details, actor.runtime || {}, actor.actorType)}
                    ${hasSiteAnimation ? renderManagedMediaDock(media, actor.name || "Actor") : ""}
                    <div class="managed-actor-chips">
                        ${actorDetailsLabel ? `<span class="managed-chip"><i class="fas fa-dna"></i> ${escapeHtml(actorDetailsLabel)}</span>` : ""}
                        <span class="managed-chip"><i class="fas fa-eye"></i> ${escapeHtml(formatVisibility(actor.visibility))}</span>
                        <span class="managed-chip"><i class="fas fa-code-branch"></i> revisione ${Number(actor.revision || 0)}</span>
                        <span class="managed-chip"><i class="fas fa-clock"></i> ${escapeHtml(formatUpdatedAt(actor.updatedAt))}</span>
                    </div>
                </div>
            </section>
            ${renderManagedCommandBar({ abilities, skills, traits, variants, effects, merchant, attackEntries, spellEntries, inventoryEntries, canEdit, editMode, actor, canManageActor })}
            <div class="managed-actor-panels">
                ${renderManagedProfileSection(currentProfile, editMode, Boolean(canEdit && currentProfilePermissions.canEdit))}
                ${merchant ? renderManagedMerchantShop(merchant) : ""}
                ${editMode && canManageActor ? renderAdmin(actor) : ""}
                ${renderCoreStats(attributes, details, actor.runtime || {}, actor.actorType, traits, definition.spellSlots || {}, editMode)}
                ${renderAbilities(abilities, editMode)}
                ${primaryPlayer ? `<div class="managed-player-extensions managed-player-extensions--companions" data-managed-player-companions></div>` : ""}
                ${primaryPlayer ? `<div class="managed-player-extensions managed-player-extensions--skill-trees" data-managed-player-skill-trees></div>` : ""}
                ${renderSkills(skills, editMode)}
                ${renderTraits(traits, editMode)}
                ${renderEntries("Attacchi e capacità", attackEntries, editMode, "managed-capabilities")}
                ${renderEntries("Incantesimi", spellEntries, editMode, "managed-spells")}
                ${renderEntries("Inventario", inventoryEntries, editMode, "managed-inventory")}
                ${variants.length || (editMode && canManageActor) ? renderManagedVariantsEditor(variants, editMode && canManageActor) : ""}
                ${effects.length || editMode ? renderManagedEffects(effects, editMode) : ""}
            </div>
            ${editMode && canManageActor ? renderManagedFrameCircleDialog() : ""}
            ${renderManagedImageLightbox()}
        `;

        root.querySelector("[data-managed-save]")?.addEventListener("click", () => saveManagedActorPage(root));
        root.querySelectorAll("[data-managed-edit-toggle]").forEach((button) => button.addEventListener("click", () => toggleManagedEditMode(root, button.dataset.managedEditToggle === "edit")));
        root.querySelectorAll("[data-managed-item-save]").forEach((button) => button.addEventListener("click", () => enqueueManagedItemUpdate(button)));
        root.querySelectorAll("[data-managed-item-delete]").forEach((button) => button.addEventListener("click", () => enqueueManagedItemDelete(button)));
        root.querySelectorAll("[data-managed-item-create]").forEach((button) => button.addEventListener("click", () => enqueueManagedItemCreate(button)));
        root.querySelectorAll("[data-managed-catalog-add]").forEach((button) => button.addEventListener("click", () => enqueueManagedCatalogItem(button)));
        root.querySelectorAll("[data-managed-effect-save]").forEach((button) => button.addEventListener("click", () => enqueueManagedEffectUpdate(button)));
        root.querySelectorAll("[data-managed-effect-delete]").forEach((button) => button.addEventListener("click", () => enqueueManagedEffectDelete(button)));
        root.querySelector("[data-managed-effect-create]")?.addEventListener("click", (event) => enqueueManagedEffectCreate(event.currentTarget));
        root.querySelectorAll('[data-managed-item-type="richtext"]').forEach((editor) => editor.addEventListener("input", () => { editor.dataset.managedDescriptionDirty = "true"; }));
        setupManagedImagePreviews(root);
        setupManagedListAdjustPreviews(root);
        setupManagedFrameCircleEditor(root);
        applyManagedFrameCircleBindings(root, media);
        window.CriptaImageAdjust?.initFrameCircleImages?.(root);
        setupManagedMediaDropZones(root);
        setupManagedDamageMagicControls(root);
        setupManagedCollectionControls(root);
        setupManagedSectionNavigation(root);
        setupManagedGuidedMechanics(root);
        setupManagedImageLightbox(root);
        setupManagedAvatarFallback(root, actor.media);
        if (editMode) root.addEventListener("input", () => { root.dataset.managedDirty = "true"; });
        setupManagedProfileEditor(root, editMode);
        if (editMode) root.addEventListener("change", () => { root.dataset.managedDirty = "true"; });
        if (primaryPlayer) {
            window.CriptaManagedPlayerExtensions?.mount?.({
                companions: root.querySelector("[data-managed-player-companions]"),
                skillTrees: root.querySelector("[data-managed-player-skill-trees]")
            }, actor, { canEdit, editMode, canManageCompanions: Boolean(editMode && actor.permissions?.isEditor) })
                .catch((error) => console.warn("Estensioni giocatore non disponibili.", error));
        }
    }

    async function loadCampaignItemCatalog(token = "") {
        try {
            const payload = await window.CriptaApp.api.get("api/data/items", { cache: false, ...(token ? { token } : {}) });
            const includeHidden = currentDocument?.permissions?.isEditor === true;
            campaignItemCatalog = (Array.isArray(payload?.data) ? payload.data : [])
                .filter((item) => item && typeof item === "object" && (item.id || item.name) && (includeHidden || item.hidden !== true))
                .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "it"));
        } catch (error) {
            campaignItemCatalog = [];
            console.warn("Catalogo oggetti di campagna non disponibile.", error);
        }
        return campaignItemCatalog;
    }
    async function loadNpcCategoryRegistry(token = "", force = false) {
        if (!window.CriptaNpcCategories?.load) return npcCategoryRegistry;
        try {
            npcCategoryRegistry = await window.CriptaNpcCategories.load({ token, force });
        } catch (error) {
            console.warn("Registro categorie NPC non disponibile.", error);
            npcCategoryRegistry = { revision: 0, categories: [] };
        }
        return npcCategoryRegistry;
    }

    async function loadManagedActorProfile(actor, token = "") {
        managedProfileDirty = false;
        managedProfileFiles.clear();
        clearManagedProfilePreviews();
        try {
            const payload = await window.CriptaApp.api.get(`api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/profile`, {
                cache: false,
                ...(token ? { token } : {})
            });
            currentProfile = normalizeManagedProfile(payload.data, actor);
            currentProfilePermissions = payload.permissions || { canEdit: false, isEditor: false };
            if (currentProfilePermissions.isEditor === true) {
                try {
                    await loadNpcCategoryRegistry(token);
                } catch (categoryError) {
                    console.warn("Categorie NPC non disponibili; il dossier resta utilizzabile.", categoryError);
                    npcCategoryRegistry = { revision: 0, categories: [] };
                }
            }
            managedProfileSource = payload.source || "profile";
            return currentProfile;
        } catch (error) {
            console.warn("Dossier non accessibile per questa sessione.", error);
            currentProfile = null;
            currentProfilePermissions = { canEdit: false, isEditor: false };
            managedProfileSource = "unavailable";
            return null;
        }
    }

    function normalizeManagedMerchantClient(value) {
        const merchant = value && typeof value === "object" ? value : null;
        if (!merchant?.enabled) return null;
        return {
            enabled: true,
            subtitle: String(merchant.subtitle || "").slice(0, 240),
            inventory: (Array.isArray(merchant.inventory) ? merchant.inventory : []).slice(0, 200).map((entry, index) => ({
                id: String(entry?.id || `item-${index + 1}`),
                name: String(entry?.name || "Oggetto"),
                type: String(entry?.type || "item"),
                description: normalizeManagedMerchantDescription(entry?.description),
                price: entry?.price && typeof entry.price === "object" ? entry.price : { value: 0, denomination: "gp" },
                stock: entry?.stock,
                definition: entry?.definition && typeof entry.definition === "object" ? entry.definition : {}
            }))
        };
    }

    function normalizeManagedProfile(value, actor = {}) {
        const input = value && typeof value === "object" ? value : {};
        const blocks = Array.isArray(input.blocks) ? input.blocks : [];
        const mediaInput = input.media && typeof input.media === "object" ? input.media : {};
        const actorMedia = actor?.media || {};
        const normalizeSlot = (slot) => {
            const source = typeof slot === "string" ? { path: slot } : (slot && typeof slot === "object" ? slot : null);
            return source?.path ? { path: String(source.path), ...(source.presentation ? { presentation: source.presentation } : {}) } : null;
        };
        return {
            schemaVersion: 1,
            id: String(input.id || `${actor.worldId || "world"}:${actor.actorId || "actor"}:profile`),
            campaignId: input.campaignId || window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue",
            worldId: input.worldId || actor.worldId || "",
            actorId: input.actorId || actor.actorId || "",
            legacyCharacterId: sanitizeId(input.legacyCharacterId || ""),
            categoryId: window.CriptaNpcCategories?.normalizeId?.(input.categoryId || input.category || "") || "",
            category: String(input.category || ""),
            name: String(input.name || actor.name || "NPC"),
            role: String(input.role || ""),
            quote: String(input.quote || ""),
            lifeState: normalizeManagedNpcLifeState(input.lifeState, input.status),
            status: String(input.status || ""),
            visibility: { state: normalizeManagedProfileVisibility(input.visibility?.state || input.visibility || "dm") },
            summary: {
                race: String(input.summary?.race || ""),
                birthYear: String(input.summary?.birthYear || input.summary?.birth_year || ""),
                age: String(input.summary?.age || ""),
                height: String(input.summary?.height || ""),
                weight: String(input.summary?.weight || "")
            },
            media: {
                avatar: normalizeSlot(mediaInput.avatar) || normalizeSlot(actorMedia.avatar),
                idle: normalizeSlot(mediaInput.idle) || normalizeSlot(actorMedia.idle),
                hover: normalizeSlot(mediaInput.hover) || normalizeSlot(actorMedia.hover)
            },
            merchant: normalizeManagedMerchantClient(input.merchant),
            blocks: blocks.map((block, index) => normalizeManagedProfileBlockClient(block, index)),
            revision: Math.max(0, Number(input.revision || 0)),
            createdAt: input.createdAt || null,
            updatedAt: input.updatedAt || null,
            updatedBy: input.updatedBy || "site"
        };
    }

    function managedProfileFromLegacyClient(character, actor) {
        const legacyBlocks = Array.isArray(character.content_blocks) ? character.content_blocks : (Array.isArray(character.blocks) ? character.blocks : []);
        const images = character.images || {};
        return normalizeManagedProfile({
            legacyCharacterId: character.id || sanitizeId(character.name || ""),
            name: character.name || actor.name,
            role: character.role || character.subtitle || "",
            quote: character.quote || "",
            lifeState: normalizeManagedNpcLifeState(character.lifeState, character.status),
            status: character.status || "",
            category: character.category || character.group || character.faction || "",
            visibility: { state: character.hidden === true ? "dm" : "public" },
            summary: character.summary || {},
            media: { avatar: images.avatar || images.portrait || actor.media?.avatar, idle: images.idle || actor.media?.idle, hover: images.hover || actor.media?.hover },
            blocks: legacyBlocks,
            revision: 0,
            updatedAt: character.updatedAt || null,
            updatedBy: "legacy"
        }, actor);
    }

    function normalizeManagedProfileBlockClient(value, index = 0) {
        const block = value && typeof value === "object" ? value : {};
        const allowedTypes = ["lore", "image_box", "banner_box", "custom_box", "secret_dossier"];
        const type = allowedTypes.includes(block.type) ? block.type : (block.image ? "image_box" : "lore");
        let text = String(block.markdownText ?? block.text ?? block.content ?? "");
        if (!text && block.markdownHtml) {
            const scratch = document.createElement("div");
            scratch.innerHTML = String(block.markdownHtml);
            text = scratch.innerText || "";
        }
        return {
            id: sanitizeId(block.id || block.title || `blocco-${index + 1}`) || `blocco-${index + 1}`,
            type,
            title: String(block.title || "Informazioni"),
            icon: String(block.icon || (type === "image_box" ? "fa-book-open" : "fa-scroll")),
            text,
            visibility: normalizeManagedProfileVisibility(block.hidden === true ? "dm" : (block.visibility?.state || block.visibility || "public")),
            image: String(block.image || ""),
            banner: String(block.banner || ""),
            imageCaption: String(block.imageCaption || block.image_caption || ""),
            borderColor: String(block.borderColor || ""),
            tags: Array.isArray(block.tags) ? block.tags.slice() : []
        };
    }

    function normalizeManagedProfileVisibility(value) {
        return String(value || "dm").toLowerCase() === "dm" ? "dm" : "public";
    }

    function normalizeManagedNpcLifeState(value, fallback = "") {
        const state = String(value || fallback || "").trim().toLowerCase();
        if (["alive", "vivo", "viva"].includes(state) || state.includes("viv")) return "alive";
        if (["dead", "morto", "morta"].includes(state) || state.includes("mort")) return "dead";
        return "unknown";
    }

    function renderManagedAccessEditor(profile) {
        if (currentProfilePermissions.isEditor !== true) return "";
        const statsState = String(currentDocument?.visibility?.state || "dm");
        const canManageStats = currentDocument?.permissions?.canManageVisibility === true
            || (currentDocument?.permissions?.canManageVisibility === undefined && currentDocument?.permissions?.isEditor === true);
        return `<div class="managed-profile-access-editor">
            <label><span><i class="fas fa-book-open"></i><b>Informazioni</b><small>Dossier, ruolo, contenuti narrativi e negozio</small></span><select data-managed-profile-field="visibility" aria-label="Visibilita informazioni"><option value="public" ${profile.visibility?.state !== "dm" ? "selected" : ""}>Tutti, anche senza login</option><option value="dm" ${profile.visibility?.state === "dm" ? "selected" : ""}>Solo DM</option></select></label>
            ${canManageStats ? `<label><span><i class="fas fa-shield-halved"></i><b>Statistiche</b><small>Statblock, attacchi, incantesimi e inventario</small></span><select data-managed-visibility aria-label="Visibilita statistiche"><option value="dm" ${statsState === "dm" ? "selected" : ""}>Solo DM</option><option value="owners" ${statsState === "owners" ? "selected" : ""}>Proprietari</option><option value="players" ${statsState === "players" ? "selected" : ""}>Giocatori con login</option><option value="public" ${statsState === "public" ? "selected" : ""}>Tutti, anche senza login</option></select></label>` : ""}
        </div>`;
    }

    function renderManagedProfileOnly(root, profile) {
        const media = profile.media || {};
        const avatarPath = media.avatar?.path || media.idle?.path || "";
        const hasAnimation = Boolean(media.idle?.path || media.hover?.path);
        root.classList.add("is-viewing", "is-profile-only");
        document.title = `${profile.name || "NPC"} - Cripta di Sangue`;
        root.innerHTML = `<nav class="managed-actor-breadcrumb" aria-label="Navigazione scheda"><a href="../npcs.html"><i class="fas fa-arrow-left"></i> Torna agli NPC</a></nav>
            <section class="managed-actor-hero managed-actor-hero--profile-only"><div class="managed-actor-art"><div class="managed-actor-aura" aria-hidden="true"></div><div class="managed-actor-avatar">${renderManagedAvatarArtwork(media, avatarPath, profile.name)}</div></div><div class="managed-actor-title"><h1>${escapeHtml(profile.name)}</h1>${profile.role ? `<p class="managed-profile-role">${escapeHtml(profile.role)}</p>` : ""}${profile.quote ? `<blockquote class="managed-profile-quote">${escapeHtml(profile.quote)}</blockquote>` : ""}${hasAnimation ? renderManagedSiteAnimation(media, profile.name) : ""}</div></section>
            <div class="managed-actor-panels">${renderManagedProfileSection(profile, false, false)}${profile.merchant?.enabled ? renderManagedMerchantShop(profile.merchant) : ""}</div>${renderManagedImageLightbox()}`;
        setupManagedImageLightbox(root);
        setupManagedAvatarFallback(root, media);
    }

    function renderManagedProfileSummaryInput(key, label, value) {
        return `<label><span>${escapeHtml(label)}</span><input type="text" data-managed-profile-summary="${escapeAttr(key)}" value="${escapeAttr(value || "")}"></label>`;
    }

    function renderManagedProfileViewBlock(block) {
        const type = block.type || "lore";
        const imagePath = type === "banner_box" ? (block.banner || block.image) : block.image;
        const image = imagePath ? `<button type="button" class="managed-profile-block-image" data-managed-image-open="${escapeAttr(resolveMedia(imagePath))}" data-managed-image-title="${escapeAttr(block.title)}"><img src="${escapeAttr(resolveMedia(imagePath))}" alt="${escapeAttr(block.title)}" loading="lazy" decoding="async"><span><i class="fas fa-expand"></i></span></button>` : "";
        const html = window.CriptaMarkdown?.render?.(block.text || "", { context: type, preserveLineBreaks: true, preserveBlankLines: true, showInlineSecrets: currentProfilePermissions.isEditor === true }) || `<p>${escapeHtml(block.text || "").replace(/\n/g, "<br>")}</p>`;
        const hiddenBadge = block.visibility === "dm" && currentProfilePermissions.isEditor ? `<span class="managed-profile-hidden"><i class="fas fa-eye-slash"></i> Solo DM</span>` : "";
        return `<article class="managed-profile-block managed-profile-block--${escapeAttr(type)}">${type === "banner_box" ? image : ""}<div class="managed-profile-block-body">${hiddenBadge}<h3><i class="fas ${escapeAttr(block.icon || "fa-scroll")}"></i>${escapeHtml(block.title)}</h3>${type !== "banner_box" ? image : ""}<div class="managed-profile-markdown">${html}</div></div></article>`;
    }

    function renderManagedNpcCategoryField(profile) {
        const normalizeId = window.CriptaNpcCategories?.normalizeId || sanitizeId;
        const requestedId = normalizeId(profile.categoryId || profile.category || "");
        const resolved = window.CriptaNpcCategories?.resolve?.(npcCategoryRegistry, requestedId, profile.category);
        const selectedId = resolved?.id || requestedId;
        const categories = (Array.isArray(npcCategoryRegistry?.categories) ? npcCategoryRegistry.categories : [])
            .filter((category) => (!category.archived && !category.mergedInto) || category.id === selectedId)
            .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "it"));
        const hasSelected = categories.some((category) => category.id === selectedId);
        const fallbackOption = selectedId && !hasSelected
            ? `<option value="${escapeAttr(selectedId)}" selected>${escapeHtml(profile.category || selectedId)}</option>`
            : "";
        return `<div class="managed-profile-category-picker">
            <label><span>Categoria nella lista NPC</span><select data-managed-profile-field="categoryId"><option value="">Senza categoria</option>${fallbackOption}${categories.map((category) => `<option value="${escapeAttr(category.id)}" ${category.id === selectedId ? "selected" : ""}>${escapeHtml(category.name)}${category.archived ? " (archiviata)" : ""}</option>`).join("")}</select></label>
            <button type="button" data-managed-category-create><i class="fas fa-plus"></i><span>Nuova</span></button>
            <a href="../npcs.html?manageCategories=1"><i class="fas fa-folder-tree"></i><span>Gestisci</span></a>
        </div>`;
    }

    function renderManagedProfileSection(profile, editMode = false, canEdit = false) {
        if (!profile) return "";
        const blocks = Array.isArray(profile.blocks) ? profile.blocks : [];
        const canManageProfileLink = currentProfilePermissions.isEditor === true && !isPrimaryManagedPlayer(currentDocument);
        const summaryEntries = [["Razza", profile.summary?.race], ["Anno di nascita", profile.summary?.birthYear], ["Eta", profile.summary?.age], ["Altezza", profile.summary?.height], ["Peso", profile.summary?.weight]].filter(([, value]) => String(value || "").trim());
        const legacyLink = !isPrimaryManagedPlayer(currentDocument) && profile.legacyCharacterId ? `./character.html?id=${encodeURIComponent(profile.legacyCharacterId)}&type=npc&legacy=1` : "";
        if (editMode && canEdit) {
            return `<section id="managed-profile" class="managed-panel managed-panel--wide managed-profile-panel is-editing-profile" data-managed-profile>
                <header class="managed-profile-header"><div><span class="managed-panel-kicker">Dossier narrativo</span><h2><i class="fas fa-book-open"></i> Storia e informazioni</h2></div>${legacyLink ? `<a class="managed-profile-legacy-link" href="${escapeAttr(legacyLink)}"><i class="fas fa-clock-rotate-left"></i> Versione precedente</a>` : ""}</header>
                ${renderManagedAccessEditor(profile)}
                <div class="managed-profile-meta-editor">
                    <label><span>Ruolo o soprannome</span><input type="text" data-managed-profile-field="role" value="${escapeAttr(profile.role)}" placeholder="Es. La Giullare"></label>
                    <label><span>Stato</span><select data-managed-profile-field="lifeState"><option value="alive" ${profile.lifeState === "alive" ? "selected" : ""}>Vivo</option><option value="dead" ${profile.lifeState === "dead" ? "selected" : ""}>Morto</option><option value="unknown" ${profile.lifeState === "unknown" ? "selected" : ""}>Ignoto</option></select></label>
                    <label><span>Nota sullo stato</span><input type="text" data-managed-profile-field="status" value="${escapeAttr(profile.status)}" placeholder="Facoltativa, es. disperso"></label>
                    ${canManageProfileLink ? renderManagedNpcCategoryField(profile) : ""}
                    ${canManageProfileLink ? '<label><span>ID wiki collegato</span><input type="text" data-managed-profile-field="legacyCharacterId" value="' + escapeAttr(profile.legacyCharacterId) + '" placeholder="zara"></label>' : ""}
                    <label class="managed-profile-field-wide"><span>Citazione</span><textarea rows="2" data-managed-profile-field="quote" placeholder="Una frase rappresentativa">${escapeHtml(profile.quote)}</textarea></label>
                </div>
                <div class="managed-profile-summary-editor">${renderManagedProfileSummaryInput("race", "Razza", profile.summary?.race)}${renderManagedProfileSummaryInput("birthYear", "Anno di nascita", profile.summary?.birthYear)}${renderManagedProfileSummaryInput("age", "Eta", profile.summary?.age)}${renderManagedProfileSummaryInput("height", "Altezza", profile.summary?.height)}${renderManagedProfileSummaryInput("weight", "Peso", profile.summary?.weight)}</div>
                <div class="managed-profile-editor-toolbar"><div><strong>Blocchi del dossier</strong><span>Trascina per riordinare o usa le frecce.</span></div><div><button type="button" data-managed-profile-add="lore"><i class="fas fa-align-left"></i> Testo</button><button type="button" data-managed-profile-add="image_box"><i class="fas fa-image"></i> Immagine</button><button type="button" data-managed-profile-add="custom_box"><i class="fas fa-message"></i> Riquadro</button><button type="button" data-managed-profile-add="banner_box"><i class="fas fa-panorama"></i> Banner</button></div></div>
                <div class="managed-profile-block-editor" data-managed-profile-blocks>${blocks.map(renderManagedProfileEditorBlock).join("") || `<div class="managed-profile-empty"><i class="fas fa-feather-pointed"></i><strong>Nessun blocco</strong><span>Aggiungi il primo capitolo del dossier.</span></div>`}</div>
            </section>`;
        }
        const content = blocks.length ? `<div class="managed-profile-block-grid">${blocks.map(renderManagedProfileViewBlock).join("")}</div>` : `<div class="managed-profile-empty"><i class="fas fa-book"></i><strong>Dossier ancora vuoto</strong><span>Le informazioni narrative verranno aggiunte qui.</span></div>`;
        return `<section id="managed-profile" class="managed-panel managed-panel--wide managed-profile-panel" data-managed-profile>
            <header class="managed-profile-header"><div><span class="managed-panel-kicker">Dossier</span><h2><i class="fas fa-book-open"></i> Storia e informazioni</h2></div>${canEdit && legacyLink ? `<a class="managed-profile-legacy-link" href="${escapeAttr(legacyLink)}"><i class="fas fa-clock-rotate-left"></i> Versione precedente</a>` : ""}</header>
            ${summaryEntries.length ? `<dl class="managed-profile-summary">${summaryEntries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}${content}
        </section>`;
    }

    function renderManagedProfileEditorBlock(block, index) {
        const needsImage = ["image_box", "banner_box", "secret_dossier"].includes(block.type);
        const imageValue = block.type === "banner_box" ? (block.banner || block.image || "") : (block.image || "");
        const preview = getManagedProfilePreview(block) || (imageValue ? resolveMedia(imageValue) : "");
        const richTextHtml = window.CriptaRichTextEditor?.markdownToHtml?.(block.text || "", { context: block.type, preserveBlankLines: true, showInlineSecrets: true }) || window.CriptaMarkdown?.render?.(block.text || "", { context: block.type, preserveLineBreaks: true, preserveBlankLines: true, showInlineSecrets: true }) || `<p>${escapeHtml(block.text || "").replace(/\n/g, "<br>")}</p>`;
        const richTextToolbar = window.CriptaRichTextEditor?.toolbarHtml?.() || "";
        return `<article class="managed-profile-edit-block" data-managed-profile-block data-managed-profile-block-id="${escapeAttr(block.id)}">
            <div class="managed-profile-edit-block-head"><button type="button" class="managed-profile-drag" draggable="true" data-managed-profile-drag="${escapeAttr(block.id)}" aria-label="Trascina ${escapeAttr(block.title)}"><i class="fas fa-grip-vertical"></i></button><strong>${escapeHtml(block.title || `Blocco ${index + 1}`)}</strong><div><button type="button" data-managed-profile-move="up" aria-label="Sposta su"><i class="fas fa-arrow-up"></i></button><button type="button" data-managed-profile-move="down" aria-label="Sposta giu"><i class="fas fa-arrow-down"></i></button><button type="button" class="is-danger" data-managed-profile-delete aria-label="Elimina blocco"><i class="fas fa-trash"></i></button></div></div>
            <input type="hidden" data-managed-profile-block-field="id" value="${escapeAttr(block.id)}">
            <div class="managed-profile-block-fields">
                <label><span>Tipo</span><select data-managed-profile-block-field="type"><option value="lore" ${block.type === "lore" ? "selected" : ""}>Testo</option><option value="image_box" ${block.type === "image_box" ? "selected" : ""}>Immagine e testo</option><option value="custom_box" ${block.type === "custom_box" ? "selected" : ""}>Riquadro</option><option value="banner_box" ${block.type === "banner_box" ? "selected" : ""}>Banner</option><option value="secret_dossier" ${block.type === "secret_dossier" ? "selected" : ""}>Dossier segreto</option></select></label>
                <label><span>Visibilita</span><select data-managed-profile-block-field="visibility" ${currentProfilePermissions.isEditor === true ? "" : "disabled"}><option value="public" ${block.visibility !== "dm" ? "selected" : ""}>Tutti</option><option value="dm" ${block.visibility === "dm" ? "selected" : ""}>Solo DM</option></select></label>
                <label class="managed-profile-field-grow"><span>Titolo</span><input type="text" data-managed-profile-block-field="title" value="${escapeAttr(block.title)}"></label>
                <label><span>Icona</span><input type="text" data-managed-profile-block-field="icon" value="${escapeAttr(block.icon)}" placeholder="fa-scroll"></label>
            </div>
            ${needsImage ? `<div class="managed-profile-image-editor"><div class="managed-profile-image-drop" data-managed-profile-image-drop="${escapeAttr(block.id)}">${preview ? `<img data-managed-profile-image-preview src="${escapeAttr(preview)}" alt="">` : `<i class="fas fa-image"></i><span>Trascina immagine</span>`}</div><div><label><span>Percorso immagine</span><input type="text" data-managed-profile-block-field="image" value="${escapeAttr(imageValue)}"></label><label class="managed-profile-file-button"><i class="fas fa-cloud-arrow-up"></i><span>Scegli immagine</span><input type="file" accept="image/*" data-managed-profile-image-file="${escapeAttr(block.id)}"></label></div></div>` : ""}
            <div class="managed-profile-text-editor"><span>Testo del blocco</span><div class="managed-profile-rich-text" data-managed-profile-rich-text>${richTextToolbar}<textarea hidden data-rich-text-source data-managed-profile-block-field="text">${escapeHtml(block.text)}</textarea><div class="managed-profile-markdown managed-profile-rich-text-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" data-rich-text-editor>${richTextHtml || "<p><br></p>"}</div><div class="managed-rich-text-hint"><span><i class="fas fa-turn-down"></i> Invio crea un nuovo paragrafo; Maiusc + Invio va a capo.</span><span>Incolla testo senza trascinarti dietro stili estranei.</span></div></div></div>
        </article>`;
    }

    function getManagedProfilePreview(block) {
        const file = managedProfileFiles.get(block.id);
        if (!file) return "";
        if (!managedProfilePreviewUrls.has(block.id)) managedProfilePreviewUrls.set(block.id, URL.createObjectURL(file));
        return managedProfilePreviewUrls.get(block.id);
    }

    function clearManagedProfilePreviews() {
        managedProfilePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        managedProfilePreviewUrls.clear();
    }

    async function createManagedNpcCategory(root, markDirty) {
        const name = String(window.prompt("Nome della nuova categoria NPC:", "") || "").trim();
        if (!name) return;
        const id = window.CriptaNpcCategories?.normalizeId?.(name) || sanitizeId(name);
        if (!id) return;
        let category = (npcCategoryRegistry.categories || []).find((entry) => entry.id === id);
        if (category?.archived) {
            window.alert("Questa categoria e archiviata. Riattivala dal gestore categorie.");
            return;
        }
        if (!category) {
            const maxOrder = Math.max(0, ...(npcCategoryRegistry.categories || []).map((entry) => Number(entry.order) || 0));
            const nextCategories = [...(npcCategoryRegistry.categories || []), { id, name, order: maxOrder + 10, color: "#b99a45", icon: "fa-folder-open", archived: false, mergedInto: "" }];
            try {
                npcCategoryRegistry = await window.CriptaNpcCategories.save(nextCategories, npcCategoryRegistry.revision, { token: getToken() });
                category = npcCategoryRegistry.categories.find((entry) => entry.id === id);
            } catch (error) {
                await loadNpcCategoryRegistry(getToken(), true);
                window.alert(error.message || "Creazione categoria fallita.");
                return;
            }
        }
        const select = root.querySelector('[data-managed-profile-field="categoryId"]');
        if (!select || !category) return;
        if (!Array.from(select.options).some((option) => option.value === category.id)) select.add(new Option(category.name, category.id));
        select.value = category.id;
        markDirty();
    }

    function setupManagedProfileEditor(root, editMode) {
        const section = root.querySelector("[data-managed-profile]");
        if (!section || !editMode || !currentProfilePermissions.canEdit) return;
        const markDirty = () => { managedProfileDirty = true; root.dataset.managedDirty = "true"; };
        const actorNameControl = root.querySelector('[data-managed-actor-path="name"]');
        if (actorNameControl && actorNameControl.dataset.managedProfileNameBound !== "true") {
            actorNameControl.dataset.managedProfileNameBound = "true";
            actorNameControl.addEventListener("input", markDirty);
        }
        section.querySelectorAll("input:not([data-managed-visibility]), textarea, select:not([data-managed-visibility])").forEach((control) => control.addEventListener("input", markDirty));
        section.querySelectorAll("select:not([data-managed-visibility])").forEach((control) => control.addEventListener("change", markDirty));
        section.querySelector("[data-managed-category-create]")?.addEventListener("click", () => {
            createManagedNpcCategory(root, markDirty);
        });
        section.querySelectorAll("[data-managed-profile-rich-text]").forEach((shell) => {
            window.CriptaRichTextEditor?.mount?.(shell, { onChange: markDirty });
        });
        section.querySelectorAll('[data-managed-profile-block-field="type"]').forEach((select) => select.addEventListener("change", () => {
            currentProfile = collectManagedProfileFromRoot(root);
            rerenderManagedProfileSection(root);
        }));
        section.querySelectorAll("[data-managed-profile-add]").forEach((button) => button.addEventListener("click", () => {
            currentProfile = collectManagedProfileFromRoot(root);
            const type = button.dataset.managedProfileAdd || "lore";
            const id = uniqueManagedProfileBlockId(type === "image_box" ? "immagine" : "informazioni");
            currentProfile.blocks.push(normalizeManagedProfileBlockClient({ id, type, title: type === "image_box" ? "Nuova immagine" : "Nuove informazioni", visibility: "public", text: "" }, currentProfile.blocks.length));
            markDirty();
            rerenderManagedProfileSection(root);
        }));
        section.querySelectorAll("[data-managed-profile-delete]").forEach((button) => button.addEventListener("click", () => {
            if (!window.confirm("Eliminare questo blocco dal dossier?")) return;
            const id = button.closest("[data-managed-profile-block]")?.dataset.managedProfileBlockId;
            currentProfile = collectManagedProfileFromRoot(root);
            currentProfile.blocks = currentProfile.blocks.filter((block) => block.id !== id);
            managedProfileFiles.delete(id);
            const previewUrl = managedProfilePreviewUrls.get(id);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            managedProfilePreviewUrls.delete(id);
            markDirty();
            rerenderManagedProfileSection(root);
        }));
        section.querySelectorAll("[data-managed-profile-move]").forEach((button) => button.addEventListener("click", () => {
            const id = button.closest("[data-managed-profile-block]")?.dataset.managedProfileBlockId;
            moveManagedProfileBlock(root, id, button.dataset.managedProfileMove === "up" ? -1 : 1);
        }));
        section.querySelectorAll("[data-managed-profile-image-file]").forEach((input) => input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) assignManagedProfileFile(root, input.dataset.managedProfileImageFile, file);
        }));
        section.querySelectorAll("[data-managed-profile-image-drop]").forEach((drop) => {
            drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-dragover"); });
            drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
            drop.addEventListener("drop", (event) => {
                event.preventDefault();
                drop.classList.remove("is-dragover");
                const file = Array.from(event.dataTransfer?.files || []).find((entry) => entry.type.startsWith("image/"));
                if (file) assignManagedProfileFile(root, drop.dataset.managedProfileImageDrop, file);
            });
        });
        let draggedId = "";
        section.querySelectorAll("[data-managed-profile-drag]").forEach((handle) => handle.addEventListener("dragstart", (event) => {
            draggedId = handle.dataset.managedProfileDrag || "";
            event.dataTransfer.effectAllowed = "move";
        }));
        section.querySelectorAll("[data-managed-profile-block]").forEach((blockNode) => {
            blockNode.addEventListener("dragover", (event) => { if (draggedId) event.preventDefault(); });
            blockNode.addEventListener("drop", (event) => {
                event.preventDefault();
                const targetId = blockNode.dataset.managedProfileBlockId || "";
                if (!draggedId || !targetId || draggedId === targetId) return;
                currentProfile = collectManagedProfileFromRoot(root);
                const from = currentProfile.blocks.findIndex((block) => block.id === draggedId);
                const to = currentProfile.blocks.findIndex((block) => block.id === targetId);
                if (from < 0 || to < 0) return;
                const [moved] = currentProfile.blocks.splice(from, 1);
                currentProfile.blocks.splice(to, 0, moved);
                markDirty();
                rerenderManagedProfileSection(root);
            });
        });
    }

    function assignManagedProfileFile(root, id, file) {
        if (!id || !file) return;
        const previousUrl = managedProfilePreviewUrls.get(id);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        managedProfilePreviewUrls.delete(id);
        managedProfileFiles.set(id, file);
        managedProfileDirty = true;
        root.dataset.managedDirty = "true";
        rerenderManagedProfileSection(root);
    }

    function moveManagedProfileBlock(root, id, direction) {
        currentProfile = collectManagedProfileFromRoot(root);
        const index = currentProfile.blocks.findIndex((block) => block.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= currentProfile.blocks.length) return;
        [currentProfile.blocks[index], currentProfile.blocks[target]] = [currentProfile.blocks[target], currentProfile.blocks[index]];
        managedProfileDirty = true;
        root.dataset.managedDirty = "true";
        rerenderManagedProfileSection(root);
    }

    function uniqueManagedProfileBlockId(base) {
        const used = new Set((currentProfile?.blocks || []).map((block) => block.id));
        const root = sanitizeId(base || "blocco") || "blocco";
        let candidate = root;
        let suffix = 2;
        while (used.has(candidate)) candidate = `${root}-${suffix++}`;
        return candidate;
    }

    function collectManagedProfileFromRoot(root) {
        const section = root.querySelector("[data-managed-profile]");
        if (!section || !currentProfile) return structuredClone(currentProfile || {});
        const next = structuredClone(currentProfile);
        const field = (name, fallback = "") => section.querySelector(`[data-managed-profile-field="${CSS.escape(name)}"]`)?.value ?? fallback;
        next.role = field("role");
        next.lifeState = normalizeManagedNpcLifeState(field("lifeState", currentProfile.lifeState || "unknown"));
        const actorName = String(root.querySelector('[data-managed-actor-path="name"]')?.value || "").trim();
        if (actorName) next.name = actorName;
        next.status = field("status", currentProfile.status || "");
        next.categoryId = window.CriptaNpcCategories?.normalizeId?.(field("categoryId", currentProfile.categoryId || "")) || "";
        const selectedCategory = window.CriptaNpcCategories?.resolve?.(npcCategoryRegistry, next.categoryId, currentProfile.category);
        next.category = next.categoryId ? String(selectedCategory?.name || currentProfile.category || "").trim() : "";
        next.quote = field("quote");
        next.legacyCharacterId = sanitizeId(field("legacyCharacterId", currentProfile.legacyCharacterId || ""));
        next.visibility = { state: normalizeManagedProfileVisibility(field("visibility", currentProfile.visibility?.state || "dm")) };
        next.summary = {};
        section.querySelectorAll("[data-managed-profile-summary]").forEach((input) => { next.summary[input.dataset.managedProfileSummary] = input.value; });
        const previousBlocks = new Map((currentProfile.blocks || []).map((block) => [block.id, block]));
        next.blocks = Array.from(section.querySelectorAll("[data-managed-profile-block]")).map((node, index) => {
            const value = (name) => node.querySelector(`[data-managed-profile-block-field="${CSS.escape(name)}"]`)?.value ?? "";
            const type = value("type") || "lore";
            const imageValue = value("image");
            return normalizeManagedProfileBlockClient({ ...(previousBlocks.get(value("id")) || {}), id: value("id") || `blocco-${index + 1}`, type, title: value("title") || "Informazioni", icon: value("icon") || "fa-scroll", visibility: value("visibility") || "public", text: value("text"), ...(type === "banner_box" ? { banner: imageValue } : { image: imageValue }) }, index);
        });
        if (currentDocument?.media) next.media = { avatar: currentDocument.media.avatar || next.media?.avatar || null, idle: currentDocument.media.idle || next.media?.idle || null, hover: currentDocument.media.hover || next.media?.hover || null };
        return next;
    }

    function rerenderManagedProfileSection(root) {
        const previous = root.querySelector("[data-managed-profile]");
        if (!previous) return;
        const template = document.createElement("template");
        template.innerHTML = renderManagedProfileSection(currentProfile, managedEditMode, Boolean(currentCanEdit && currentProfilePermissions.canEdit)).trim();
        const replacement = template.content.firstElementChild;
        if (!replacement) return;
        previous.replaceWith(replacement);
        setupManagedProfileEditor(root, managedEditMode);
        setupManagedImageLightbox(root);
    }

    async function saveManagedActorPage(root) {
        const status = root.querySelector("[data-managed-status]");
        const button = root.querySelector("[data-managed-save]");
        const token = getToken();
        if (!token) return;
        const actorHasChanges = collectManagedActorPatches(root).length > 0 || hasManagedPresentationChanges(root, currentDocument);
        let profileSaved = false;
        if (currentProfilePermissions.canEdit === true && (managedProfileDirty || managedProfileSource === "legacy")) {
            button.disabled = true;
            if (status) status.textContent = "Salvataggio dossier...";
            try {
                await saveManagedActorProfile(root, token);
                profileSaved = true;
            } catch (error) {
                console.error("Salvataggio dossier fallito", error);
                if (status) status.textContent = error.message || "Salvataggio dossier fallito";
                button.disabled = false;
                return;
            }
            button.disabled = false;
        }
        if (actorHasChanges) {
            await saveManagedActorPresentation(root);
            return;
        }
        if (status) status.textContent = profileSaved ? `Dossier salvato - revisione ${currentProfile.revision}` : "Nessuna modifica da salvare.";
        if (profileSaved) {
            root.dataset.managedDirty = "false";
            rerenderManagedProfileSection(root);
        }
    }

    async function saveManagedActorProfile(root, token) {
        const next = collectManagedProfileFromRoot(root);
        const nextRevision = Number(currentProfile?.revision || 0) + 1;
        for (const block of next.blocks) {
            const file = managedProfileFiles.get(block.id);
            if (!file) continue;
            const path = await uploadManagedProfileImage(file, block.id, nextRevision, token);
            if (block.type === "banner_box") block.banner = path;
            else block.image = path;
        }
        const payload = await window.CriptaApp.api.post(`api/managed-actors/${encodeURIComponent(next.worldId)}/${encodeURIComponent(next.actorId)}/profile`, {
            expectedRevision: Number(currentProfile?.revision || 0),
            data: next
        }, { token });
        currentProfile = normalizeManagedProfile(payload.data, currentDocument || next);
        currentProfilePermissions = { ...currentProfilePermissions, canEdit: true, isEditor: true };
        managedProfileSource = "profile";
        managedProfileDirty = false;
        managedProfileFiles.clear();
        clearManagedProfilePreviews();
    }

    async function uploadManagedProfileImage(file, blockId, revision, token) {
        const blob = await fileToWebp(file, 1800);
        const folder = `managed-actors/${sanitizeId(currentProfile.worldId)}/${sanitizeId(currentProfile.actorId)}/lore`;
        const filename = `${sanitizeId(blockId)}-r${Math.max(1, Math.floor(Number(revision) || 1))}.webp`;
        const form = new FormData();
        form.set("campaignId", window.CriptaApp.campaigns.currentId());
        form.set("folder", folder);
        form.set("filename", filename);
        form.set("file", new File([blob], filename, { type: "image/webp" }));
        const url = new URL(window.CriptaApp.urls.api("media/upload"));
        url.searchParams.set("folder", folder);
        url.searchParams.set("campaign", window.CriptaApp.campaigns.currentId());
        const response = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "Upload immagine dossier fallito");
        return payload.path || `media/${payload.key}`;
    }
    function renderManagedAvatarArtwork(media, avatarPath, actorName) {
        if (!avatarPath) return renderImage("", actorName);
        return `
            <button type="button" class="managed-avatar-button" data-managed-image-open="${escapeAttr(resolveMedia(avatarPath))}" data-managed-image-title="Avatar · ${escapeAttr(actorName)}" aria-label="Apri l'avatar di ${escapeAttr(actorName)} a schermo intero">
                <span class="managed-avatar-stack">
                    <img class="managed-actor-avatar-layer is-base" data-managed-avatar-layer src="${escapeAttr(resolveMedia(avatarPath))}" alt="Avatar di ${escapeAttr(actorName)}" loading="eager" decoding="async" draggable="false">
                </span>
                <span class="managed-image-zoom-hint" aria-hidden="true"><i class="fas fa-expand"></i></span>
            </button>`;
    }

    function setupManagedAvatarFallback(root, media) {
        const image = root.querySelector(".managed-avatar-button [data-managed-avatar-layer]");
        const trigger = root.querySelector(".managed-avatar-button");
        if (!image || !trigger) return;
        const originalPath = String(media?.avatar?.path || "");
        const fallbackPaths = [media?.idle?.path, media?.hover?.path, media?.token?.path]
            .map((path) => String(path || "").trim())
            .filter((path, index, paths) => path && path !== originalPath && paths.indexOf(path) === index);
        if (!fallbackPaths.length) return;
        let cursor = 0;
        const useNextFallback = () => {
            const path = fallbackPaths[cursor++];
            if (!path) return;
            const url = resolveMedia(path);
            image.dataset.managedAvatarFallback = path;
            image.src = url;
            trigger.dataset.managedImageOpen = url;
            trigger.dataset.managedImageTitle = "Immagine alternativa";
        };
        image.addEventListener("error", useNextFallback);
        if (image.complete && image.naturalWidth === 0) queueMicrotask(useNextFallback);
    }

    function renderManagedMediaDock(media, actorName) {
        const animation = renderManagedSiteAnimation(media, actorName);
        return animation ? `<div class="managed-actor-media-dock" aria-label="Ritratto animato">${animation}</div>` : "";
    }
    function renderManagedSiteAnimation(media, actorName) {
        const idleDescriptor = media?.idle?.path ? media.idle : null;
        const hoverDescriptor = media?.hover?.path ? media.hover : null;
        if (!idleDescriptor && !hoverDescriptor) return "";
        const restDescriptor = idleDescriptor || (media?.token?.path ? media.token : null) || (media?.avatar?.path ? media.avatar : null) || hoverDescriptor;
        const restPath = restDescriptor?.path || "";
        const hoverPath = hoverDescriptor?.path || "";
        const hasHover = Boolean(hoverPath && hoverPath !== restPath);
        if (!restPath) return "";
        const hoverData = hasHover ? ` data-managed-image-hover="${escapeAttr(resolveMedia(hoverPath))}"` : "";
        return `<figure class="managed-actor-site-animation ${hasHover ? "has-hover" : ""}"><button type="button" class="managed-site-animation-button" data-managed-image-open="${escapeAttr(resolveMedia(restPath))}"${hoverData} data-managed-image-title="Animazione sito · ${escapeAttr(actorName)}" aria-label="Apri l'animazione sito di ${escapeAttr(actorName)} a schermo intero"><span class="managed-site-animation-stack"><img class="managed-site-animation-layer is-rest" src="${escapeAttr(resolveMedia(restPath))}" alt="Animazione sito di ${escapeAttr(actorName)}" loading="eager" decoding="async" draggable="false" style="${renderManagedPresentationStyle(restDescriptor)}">${hasHover ? `<img class="managed-site-animation-layer is-hover" src="${escapeAttr(resolveMedia(hoverPath))}" alt="" aria-hidden="true" loading="eager" decoding="async" draggable="false" style="${renderManagedPresentationStyle(hoverDescriptor)}">` : ""}</span><span class="managed-image-zoom-hint" aria-hidden="true"><i class="fas fa-expand"></i></span></button><figcaption><i class="fas fa-wand-magic-sparkles"></i> Ritratto vivo</figcaption></figure>`;
    }
    function renderManagedTokenArtwork(tokenPath, actorName) {
        if (!tokenPath) return "";
        const tokenUrl = resolveMedia(tokenPath);
        return `<figure class="managed-actor-token"><button type="button" class="managed-token-button" data-managed-image-open="${escapeAttr(tokenUrl)}" data-managed-image-title="Token · ${escapeAttr(actorName)}" aria-label="Apri il token di ${escapeAttr(actorName)} a schermo intero"><img src="${escapeAttr(tokenUrl)}" alt="Token di ${escapeAttr(actorName)}" loading="eager" decoding="async" draggable="false"><span class="managed-image-zoom-hint" aria-hidden="true"><i class="fas fa-expand"></i></span></button><figcaption>Token mappa</figcaption></figure>`;
    }


    function normalizeManagedFrameCircle(descriptor) {
        return window.CriptaImageAdjust?.normalizeFrameCircle?.(descriptor?.presentation?.frameCircle) || null;
    }

    function applyManagedFrameCircleBindings(root, media) {
        const idleDescriptor = media?.idle?.path ? media.idle : null;
        const hoverDescriptor = media?.hover?.path ? media.hover : null;
        const restDescriptor = idleDescriptor || (media?.token?.path ? media.token : null) || (media?.avatar?.path ? media.avatar : null) || hoverDescriptor;
        const bindings = [
            [root.querySelector(".managed-site-animation-layer.is-rest"), restDescriptor],
            [root.querySelector(".managed-site-animation-layer.is-hover"), hoverDescriptor]
        ];
        const host = root.querySelector(".managed-site-animation-stack");
        if (host) host.dataset.frameCircleHost = "true";
        bindings.forEach(([image, descriptor]) => {
            if (!image) return;
            window.CriptaImageAdjust?.setFrameCircleDataset?.(image, normalizeManagedFrameCircle(descriptor));
        });
    }
    function renderManagedPresentationStyle(descriptor) {
        const presentation = descriptor?.presentation || {};
        const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const x = Math.min(100, Math.max(0, finiteOr(presentation.x, 50)));
        const y = Math.min(100, Math.max(0, finiteOr(presentation.y, 50)));
        const scale = Math.min(3, Math.max(.5, finiteOr(presentation.scale, 1)));
        return `--managed-layer-x:${x}%;--managed-layer-y:${y}%;--managed-layer-scale:${scale};`;
    }

    function renderManagedImageLightbox() {
        return `<div class="managed-image-lightbox" data-managed-image-lightbox hidden role="dialog" aria-modal="true" aria-label="Anteprima immagine"><button type="button" class="managed-image-lightbox-backdrop" data-managed-image-close aria-label="Chiudi anteprima"></button><figure><button type="button" class="managed-image-lightbox-close" data-managed-image-close aria-label="Chiudi"><i class="fas fa-xmark"></i></button><span class="managed-image-lightbox-stage"><img class="managed-image-lightbox-layer is-rest" data-managed-image-lightbox-image src="" alt=""><img class="managed-image-lightbox-layer is-hover" data-managed-image-lightbox-hover src="" alt="" hidden></span><figcaption data-managed-image-lightbox-title></figcaption></figure></div>`;
    }

    function setupManagedImageLightbox(root) {
        const lightbox = root.querySelector("[data-managed-image-lightbox]");
        const image = lightbox?.querySelector("[data-managed-image-lightbox-image]");
        const hoverImage = lightbox?.querySelector("[data-managed-image-lightbox-hover]");
        const stage = lightbox?.querySelector(".managed-image-lightbox-stage");
        const title = lightbox?.querySelector("[data-managed-image-lightbox-title]");
        if (!lightbox || !image || !hoverImage || !stage || !title) return;
        document.body.append(lightbox);
        let previousFocus = null;
        const close = () => {
            if (lightbox.hidden) return;
            lightbox.classList.remove("is-visible", "has-hover", "is-pointer-hover");
            lightbox.hidden = true;
            document.body.classList.remove("managed-image-lightbox-open");
            image.removeAttribute("src");
            hoverImage.removeAttribute("src");
            hoverImage.hidden = true;
            previousFocus?.focus?.();
        };
        const open = (trigger) => {
            const src = String(trigger.dataset.managedImageOpen || "").trim();
            if (!src) return;
            const hoverSrc = String(trigger.dataset.managedImageHover || "").trim();
            const hasHover = Boolean(hoverSrc && hoverSrc !== src);
            previousFocus = trigger;
            const label = String(trigger.dataset.managedImageTitle || "Immagine");
            image.src = src;
            image.alt = label;
            hoverImage.hidden = !hasHover;
            if (hasHover) {
                hoverImage.src = hoverSrc;
                hoverImage.alt = `${label} - hover`;
            } else {
                hoverImage.removeAttribute("src");
                hoverImage.alt = "";
            }
            lightbox.classList.remove("is-pointer-hover");
            lightbox.classList.toggle("has-hover", hasHover);
            title.textContent = label;
            lightbox.hidden = false;
            document.body.classList.add("managed-image-lightbox-open");
            requestAnimationFrame(() => lightbox.classList.add("is-visible"));
            lightbox.focus({ preventScroll: true });
        };
        const clickHandler = (event) => {
            const trigger = event.target.closest?.("[data-managed-image-open]");
            if (!trigger || !root.contains(trigger)) return;
            open(trigger);
        };
        if (root._managedImageLightboxClickHandler) root.removeEventListener("click", root._managedImageLightboxClickHandler);
        root._managedImageLightboxClickHandler = clickHandler;
        root.addEventListener("click", clickHandler);
        stage.addEventListener("pointerenter", () => lightbox.classList.toggle("is-pointer-hover", lightbox.classList.contains("has-hover")));
        stage.addEventListener("pointerleave", () => lightbox.classList.remove("is-pointer-hover"));
        lightbox.querySelectorAll("[data-managed-image-close]").forEach((button) => button.addEventListener("click", close));
        lightbox.tabIndex = -1;
        lightbox.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close();
        });
    }
    function clearManagedImagePreviews() {
        managedPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        managedPreviewUrls.clear();
    }

    function setupManagedImagePreviews(root) {
        root.querySelectorAll("[data-managed-item-icon]").forEach((input) => input.addEventListener("change", () => {
            const file = input.files?.[0];
            const form = input.closest("[data-managed-item-form]");
            const key = `item:${form?.dataset.managedTransferId || form?.dataset.managedItemId || "preview"}`;
            if (!file) return;
            const previousUrl = managedPreviewUrls.get(key);
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            const previewUrl = URL.createObjectURL(file);
            managedPreviewUrls.set(key, previewUrl);
            const box = input.closest(".managed-item-icon-editor")?.querySelector(":scope > div");
            if (!box) return;
            let image = box.querySelector("img");
            if (!image) { image = document.createElement("img"); box.replaceChildren(image); }
            image.src = previewUrl;
            form?.classList.add("managed-media-pending");
        }));
        root.querySelectorAll("[data-managed-file]").forEach((input) => input.addEventListener("change", () => {
            const file = input.files?.[0];
            const slot = String(input.dataset.managedFile || "");
            if (!file || !slot) return;
            const previousUrl = managedPreviewUrls.get(slot);
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            const previewUrl = URL.createObjectURL(file);
            managedPreviewUrls.set(slot, previewUrl);

            const card = input.closest("fieldset");
            card?.classList.add("managed-media-pending");
            const circleButton = card?.querySelector(`[data-managed-frame-circle-open="${slot}"]`);
            if (circleButton) circleButton.disabled = false;
            if (["avatar", "token"].includes(slot)) {
                const preview = card?.querySelector(".managed-base-media-preview");
                let image = preview?.querySelector("img");
                if (!image && preview) {
                    image = document.createElement("img");
                    image.alt = slot === "avatar" ? "Nuovo avatar" : "Nuovo token";
                    preview.querySelector(".managed-slot-placeholder")?.replaceWith(image);
                }
                if (image) image.src = previewUrl;
                const listPreview = root.querySelector(`[data-managed-list-adjust-image="${slot}"]`);
                if (listPreview) {
                    listPreview.src = previewUrl;
                    if (root.querySelector(`[data-managed-frame-circle-enabled="${slot}"]`)?.value !== "1") window.CriptaImageAdjust?.setFrameCircleDataset?.(listPreview, null);
                }
                const heroImages = root.querySelectorAll(slot === "avatar" ? "[data-managed-avatar-layer]" : ".managed-actor-token img");
                heroImages.forEach((heroImage) => { heroImage.src = previewUrl; });
                const heroTrigger = root.querySelector(slot === "avatar" ? ".managed-avatar-button" : ".managed-token-button");
                if (heroTrigger) heroTrigger.dataset.managedImageOpen = previewUrl;
                return;
            }

            if (["idle", "hover"].includes(slot)) {
                const livingLayer = root.querySelector(slot === "idle" ? ".managed-site-animation-layer.is-rest" : ".managed-site-animation-layer.is-hover");
                if (livingLayer) livingLayer.src = previewUrl;
                const livingTrigger = root.querySelector(".managed-site-animation-button");
                if (slot === "idle" && livingTrigger) livingTrigger.dataset.managedImageOpen = previewUrl;
                if (slot === "hover" && livingTrigger) livingTrigger.dataset.managedImageHover = previewUrl;
                const listPreview = root.querySelector(`[data-managed-list-adjust-image="${slot}"]`);
                if (listPreview) {
                    listPreview.src = previewUrl;
                    if (root.querySelector(`[data-managed-frame-circle-enabled="${slot}"]`)?.value !== "1") window.CriptaImageAdjust?.setFrameCircleDataset?.(listPreview, null);
                }
            }

            let image = card?.querySelector(":scope > img");
            if (!image && card) {
                image = document.createElement("img");
                image.alt = `Nuova immagine ${slot}`;
                card.querySelector(":scope > .managed-slot-placeholder")?.replaceWith(image);
            }
            if (image) image.src = previewUrl;
            card?.classList.add("has-image");
            const remove = card?.querySelector(`[data-managed-remove="${slot}"]`);
            if (remove) remove.checked = false;
        }));
    }
    function setupManagedMediaDropZones(root) {
        root.querySelectorAll("[data-managed-media-drop]").forEach((zone) => {
            const input = zone.querySelector("[data-managed-file]");
            if (!input) return;
            let dragDepth = 0;
            const reset = () => {
                dragDepth = 0;
                zone.classList.remove("managed-drop-active");
            };
            zone.addEventListener("dragenter", (event) => {
                if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
                event.preventDefault();
                dragDepth += 1;
                zone.classList.add("managed-drop-active");
            });
            zone.addEventListener("dragover", (event) => {
                if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            });
            zone.addEventListener("dragleave", () => {
                dragDepth = Math.max(0, dragDepth - 1);
                if (!dragDepth) zone.classList.remove("managed-drop-active");
            });
            zone.addEventListener("drop", (event) => {
                event.preventDefault();
                reset();
                const file = Array.from(event.dataTransfer?.files || []).find((candidate) => String(candidate.type || "").startsWith("image/"));
                if (!file) {
                    zone.classList.add("managed-drop-invalid");
                    window.setTimeout(() => zone.classList.remove("managed-drop-invalid"), 900);
                    return;
                }
                const transfer = new DataTransfer();
                transfer.items.add(file);
                input.files = transfer.files;
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
        });
    }
    function setupManagedGuidedMechanics(root) {
        const bindControl = (control) => {
            const sync = () => syncManagedGuidedControl(control);
            control.addEventListener("input", sync);
            control.addEventListener("change", sync);
        };
        root.querySelectorAll("[data-managed-guided-object]").forEach(bindControl);
        root.querySelectorAll("[data-managed-guided-list]").forEach((group) => group.querySelectorAll('input[type="checkbox"]').forEach((input) => input.addEventListener("change", () => syncManagedGuidedList(group))));
        root.querySelectorAll("[data-managed-damage-parts]").forEach((list) => {
            list.querySelectorAll("[data-managed-damage-formula], [data-managed-damage-type]").forEach((control) => {
                control.addEventListener("input", () => syncManagedDamageRows(list));
                control.addEventListener("change", () => syncManagedDamageRows(list));
            });
            list.querySelectorAll("[data-managed-damage-remove]").forEach((button) => button.addEventListener("click", () => {
                button.closest("[data-managed-damage-row]")?.remove();
                syncManagedDamageRows(list);
            }));
        });
        root.querySelectorAll("[data-managed-damage-add]").forEach((button) => button.addEventListener("click", () => {
            const card = button.closest(".managed-damage-guide");
            const list = card?.querySelector("[data-managed-damage-parts]");
            if (!list) return;
            list.insertAdjacentHTML("beforeend", renderManagedDamagePartRow(list.querySelectorAll("[data-managed-damage-row]").length, ["", ""]));
            const row = list.querySelector("[data-managed-damage-row]:last-child");
            row?.querySelectorAll("[data-managed-damage-formula], [data-managed-damage-type]").forEach((control) => {
                control.addEventListener("input", () => syncManagedDamageRows(list));
                control.addEventListener("change", () => syncManagedDamageRows(list));
            });
            row?.querySelector("[data-managed-damage-remove]")?.addEventListener("click", (event) => {
                event.currentTarget.closest("[data-managed-damage-row]")?.remove();
                syncManagedDamageRows(list);
            });
            row?.querySelector("[data-managed-damage-formula]")?.focus();
        }));
    }

    function syncManagedGuidedControl(control) {
        const objectPath = String(control.dataset.managedGuidedObject || "");
        const key = String(control.dataset.managedGuidedKey || "");
        const textarea = findManagedAdvancedTextarea(control, objectPath);
        if (!textarea || !key) return;
        let objectValue;
        try { objectValue = JSON.parse(textarea.value || "{}"); } catch (_) { return; }
        const type = String(control.dataset.managedGuidedType || "text");
        let value = type === "boolean" ? control.checked : type === "number" ? (control.value === "" ? undefined : Number(control.value)) : type === "list" ? String(control.value || "").split(",").map((entry) => entry.trim()).filter(Boolean) : String(control.value || "").trim();
        if (value === "" || value === undefined || (typeof value === "number" && !Number.isFinite(value))) deleteManagedGuidedValue(objectValue, key);
        else setManagedGuidedValue(objectValue, key, value);
        textarea.value = JSON.stringify(objectValue, null, 2);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function syncManagedGuidedList(group) {
        const objectPath = String(group.dataset.managedGuidedList || "");
        const textarea = findManagedAdvancedTextarea(group, objectPath);
        if (!textarea) return;
        let current = [];
        try { current = JSON.parse(textarea.value || "[]"); } catch (_) { current = []; }
        const known = new Set(Array.from(group.querySelectorAll('input[type="checkbox"]')).map((input) => input.value));
        const preserved = Array.isArray(current) ? current.filter((value) => !known.has(String(value))) : [];
        const selected = Array.from(group.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
        textarea.value = JSON.stringify(Array.from(new Set([...preserved, ...selected])), null, 2);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function syncManagedDamageRows(list) {
        const textarea = findManagedAdvancedTextarea(list, "system.damage");
        if (!textarea) return;
        let damage = {};
        try { damage = JSON.parse(textarea.value || "{}"); } catch (_) { damage = {}; }
        damage.parts = Array.from(list.querySelectorAll("[data-managed-damage-row]")).map((row) => [
            String(row.querySelector("[data-managed-damage-formula]")?.value || "").trim(),
            String(row.querySelector("[data-managed-damage-type]")?.value || "").trim()
        ]).filter(([formula, type]) => formula || type);
        textarea.value = JSON.stringify(damage, null, 2);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function findManagedAdvancedTextarea(node, path) {
        const form = node.closest("[data-managed-item-form]");
        return form?.querySelector(`[data-managed-item-path="${CSS.escape(path)}"][data-managed-item-type="json"]`) || null;
    }

    function setManagedGuidedValue(target, path, value) {
        const keys = String(path || "").split(".").filter(Boolean);
        let cursor = target;
        while (keys.length > 1) {
            const key = keys.shift();
            const nextKey = keys[0];
            if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = /^\d+$/.test(nextKey) ? [] : {};
            cursor = cursor[key];
        }
        cursor[keys[0]] = value;
    }

    function deleteManagedGuidedValue(target, path) {
        const keys = String(path || "").split(".").filter(Boolean);
        let cursor = target;
        while (keys.length > 1) {
            const key = keys.shift();
            if (!cursor?.[key] || typeof cursor[key] !== "object") return;
            cursor = cursor[key];
        }
        if (cursor && keys[0]) delete cursor[keys[0]];
    }
    function renderManagedHeroVitals(attributes = {}, details = {}, runtime = {}, actorType = "") {
        const hp = runtime?.hp || attributes?.hp || {};
        const ac = attributes?.ac && typeof attributes.ac === "object" ? (attributes.ac.value ?? attributes.ac.flat) : attributes?.ac;
        const movement = attributes?.movement?.walk;
        const isCharacter = ["character", "player"].includes(String(actorType || "").toLowerCase());
        const challenge = isCharacter ? details.level : details.cr;
        const challengeLabel = isCharacter ? "Livello" : "CR";
        const entries = [
            { icon: "fa-heart-pulse", label: "Punti ferita", value: `${hp.value ?? "—"} / ${hp.max ?? "—"}`, tone: "health" },
            { icon: "fa-shield-halved", label: "Classe armatura", value: ac ?? "—", tone: "armor" },
            { icon: isCharacter ? "fa-star" : "fa-skull", label: challengeLabel, value: challenge ?? "—", tone: "challenge" },
            { icon: "fa-person-running", label: "Velocità", value: movement !== undefined ? `${movement} ${attributes?.movement?.units || "ft"}` : "—", tone: "speed" }
        ];
        return `<div class="managed-hero-vitals">${entries.map((entry) => `<div class="managed-hero-vital is-${entry.tone}"><i class="fas ${entry.icon}"></i><span><small>${escapeHtml(entry.label)}</small><strong>${escapeHtml(entry.value)}</strong></span></div>`).join("")}</div>`;
    }
    function renderManagedCommandBar({ abilities, skills, traits, variants, effects, merchant, attackEntries, spellEntries, inventoryEntries, canEdit, editMode, actor, canManageActor }) {
        const primaryPlayer = getManagedActorRelationshipType(actor) === "player";
        const links = [
            ["managed-profile", "fa-book-open", "Dossier", Boolean(currentProfile?.blocks?.length || currentProfile?.role || currentProfile?.quote || editMode)],
            ["managed-shop", "fa-store", "Negozio", Boolean(merchant?.enabled)],
            ["managed-appearance", "fa-images", "Media", editMode && canManageActor],
            ["managed-stats", "fa-gauge-high", "Panoramica", true],
            ["managed-abilities", "fa-dumbbell", "Caratteristiche", Object.keys(abilities || {}).length > 0],
            ["managed-companions", "fa-paw", "Companion", primaryPlayer],
            ["managed-player-skill-trees", "fa-diagram-project", "Alberi", primaryPlayer],
            ["managed-skills", "fa-list-check", "Abilità", Object.keys(skills || {}).length > 0],
            ["managed-traits", "fa-shield-halved", "Difese", Object.keys(traits || {}).length > 0],
            ["managed-capabilities", "fa-burst", "Combattimento", attackEntries.length > 0 || editMode],
            ["managed-spells", "fa-wand-sparkles", "Incantesimi", spellEntries.length > 0 || editMode],
            ["managed-inventory", "fa-backpack", "Inventario", inventoryEntries.length > 0 || editMode],


            ["managed-variants", "fa-layer-group", "Varianti", variants.length > 0 || (editMode && canManageActor)],
            ["managed-effects", "fa-wand-magic-sparkles", "Effetti", effects.length > 0 || editMode]
        ].filter(([, , , visible]) => visible);
        const commands = Array.isArray(actor?.sync?.commands) ? actor.sync.commands : [];
        const conflicts = commands.filter((command) => command.status === "conflict" || command.status === "failed").length;
        const pending = commands.filter((command) => command.status === "pending").length;
        const syncState = conflicts ? { icon: "fa-triangle-exclamation", title: `${conflicts} conflitti`, detail: "Richiedono attenzione", className: "is-conflict" }
            : pending ? { icon: "fa-cloud-arrow-up", title: `${pending} in attesa`, detail: "Foundry li riceverà a breve", className: "is-pending" }
                : { icon: "fa-circle-check", title: "Sincronizzato", detail: `Revisione ${Number(actor?.revision || 0)}`, className: "is-synced" };
        const actions = canEdit ? (editMode
            ? `<span class="managed-save-status" data-managed-status></span><button type="button" class="managed-command-secondary" data-managed-edit-toggle="view"><i class="fas fa-xmark"></i><span>Chiudi</span></button><button type="button" class="managed-command-primary" data-managed-save><i class="fas fa-cloud-arrow-up"></i><span>Salva scheda</span></button>`
            : `<button type="button" class="managed-command-primary" data-managed-edit-toggle="edit"><i class="fas fa-pen-to-square"></i><span>Modifica</span></button>`)
            : "";
        return `<div class="managed-command-bar"><nav class="managed-section-nav" aria-label="Sezioni della scheda"><div>${links.map(([id, icon, label]) => `<a href="#${id}"><i class="fas ${icon}" aria-hidden="true"></i><span>${escapeHtml(label)}</span></a>`).join("")}</div></nav><div class="managed-command-actions"><div class="managed-sync-indicator ${syncState.className}"><i class="fas ${syncState.icon}"></i><span><strong>${escapeHtml(syncState.title)}</strong><small>${escapeHtml(syncState.detail)}</small></span></div>${actions}</div></div>`;
    }

    async function toggleManagedEditMode(root, shouldEdit) {
        if (!currentCanEdit || managedEditMode === shouldEdit) return;
        if (!shouldEdit && root.dataset.managedDirty === "true" && !window.confirm("Uscire dalla modalità modifica? Le modifiche non ancora inviate andranno perse.")) return;
        if (!shouldEdit && managedProfileDirty) {
            await loadManagedActorProfile(currentDocument, getToken());
            managedProfileDirty = false;
        }
        const previousScroll = window.scrollY;
        managedEditMode = shouldEdit;
        renderManagedActor(root, currentDocument, currentCanEdit, managedEditMode, currentCanManageActor);
        window.requestAnimationFrame(() => window.scrollTo({ top: Math.min(previousScroll, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)), behavior: "instant" }));
    }
    function renderCoreStats(attributes, details, runtime, actorType, traits, spellSlotDefinitions = {}, canEdit = false) {
        const hp = attributes.hp || {};
        const runtimeHp = runtime?.hp || {};
        const acData = attributes.ac && typeof attributes.ac === "object" ? attributes.ac : {};
        const ac = readNumber(acData.value ?? acData.flat ?? attributes.ac);
        const movement = attributes.movement && typeof attributes.movement === "object" ? attributes.movement : {};
        const isCharacter = ["character", "player"].includes(String(actorType || "").toLowerCase());
        const stats = [
            { label: "PF attuali", path: "system.attributes.hp.value", value: runtimeHp.value ?? hp.value ?? 0, icon: "fa-heart-pulse", type: "number", min: 0, max: 999999, step: 1 },
            { label: "PF massimi", path: "system.attributes.hp.max", value: hp.max ?? runtimeHp.max, icon: "fa-heart", type: "number", min: 0, max: 999999, step: 1 },
            { label: "PF temporanei", path: "system.attributes.hp.temp", value: runtimeHp.temp ?? hp.temp ?? 0, icon: "fa-shield-heart", type: "number", min: 0, max: 999999, step: 1 },
            { label: "Classe Armatura", path: "system.attributes.ac.flat", value: acData.flat ?? ac, icon: "fa-shield-halved", type: "number", min: 0, max: 99, step: 1 },
            { label: "Competenza", path: "system.attributes.prof", value: attributes.prof, icon: "fa-dice-d20", type: "number", min: 0, max: 99, step: 1 },
            { label: "Bonus iniziativa", path: "system.attributes.init.bonus", value: attributes.init?.bonus ?? attributes.init?.value ?? 0, icon: "fa-bolt", type: "number", min: -99, max: 99, step: 1 },
            { label: "Velocità", path: "system.attributes.movement.walk", value: movement.walk, icon: "fa-person-running", type: "number", min: 0, max: 9999, step: 1 },
            { label: "Taglia", path: "system.traits.size", value: traits?.size || "med", icon: "fa-ruler-combined", type: "select", options: [["tiny", "Minuscola"], ["sm", "Piccola"], ["med", "Media"], ["lg", "Grande"], ["huge", "Enorme"], ["grg", "Mastodontica"]] },
            isCharacter
                ? { label: "Livello", value: details.level ?? 1, icon: "fa-star", editable: false, note: "Calcolato dalle classi" }
                : { label: "CR", path: "system.details.cr", value: details.cr, icon: "fa-skull", type: "text" }
        ].filter((entry) => canEdit || (entry.value !== undefined && entry.value !== null && entry.value !== ""));
        if (!stats.length) return "";
        const cards = stats.map((entry) => canEdit && entry.editable !== false
            ? `<label class="managed-stat managed-stat--editable"><i class="fas ${entry.icon}"></i><div><span>${escapeHtml(entry.label)}</span>${renderManagedActorControl(entry.path, entry.type, entry.value, entry)}</div></label>`
            : `<div class="managed-stat ${entry.editable === false ? "managed-stat--derived" : ""}"><i class="fas ${entry.icon}"></i><div><span>${escapeHtml(entry.label)}</span><strong>${escapeHtml(formatManagedStatValue(entry))}</strong>${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""}</div></div>`).join("");
        const movementEditor = canEdit ? `<div class="managed-rule-editor"><div class="managed-rule-editor-heading"><i class="fas fa-route"></i><div><strong>Movimento e calcolo</strong><span>Modifica ogni modalità senza perdere quelle non usate.</span></div></div><div class="managed-rule-grid">${[
            ["Volo", "fly"], ["Nuoto", "swim"], ["Scalata", "climb"], ["Scavo", "burrow"]
        ].map(([label, key]) => `<label><span>${label}</span>${renderManagedActorControl(`system.attributes.movement.${key}`, "number", movement[key] ?? 0, { min: 0, max: 9999, step: 1 })}</label>`).join("")}
            <label><span>Unità</span>${renderManagedActorControl("system.attributes.movement.units", "select", movement.units || "ft", { options: [["ft", "Piedi"], ["m", "Metri"], ["mi", "Miglia"], ["km", "Chilometri"]] })}</label>
            <label><span>Metodo CA</span>${renderManagedActorControl("system.attributes.ac.calc", "select", acData.calc || "flat", { options: [["default", "Equipaggiamento"], ["natural", "Armatura naturale"], ["flat", "Valore fisso"], ["formula", "Formula"], ["custom", "Personalizzato"]] })}</label>
            <label class="managed-rule-check">${renderManagedActorControl("system.attributes.movement.hover", "boolean", Boolean(movement.hover))}<span>Può fluttuare</span></label>
        </div></div>` : "";
        const spellSlotsEditor = renderManagedSpellSlots(spellSlotDefinitions, runtime?.spellSlots || {}, canEdit);
        return `<section id="managed-stats" class="managed-panel managed-panel--wide managed-panel--stats"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Profilo di gioco</span><h2><i class="fas fa-chart-simple"></i> Statistiche</h2></div>${renderManagedActorCommandStatus()}</header><div class="managed-stat-grid">${cards}</div>${movementEditor}${spellSlotsEditor}</section>`;
    }

    function renderManagedSpellSlots(definitions = {}, runtime = {}, canEdit = false) {
        const keys = [...Array.from({ length: 9 }, (_, index) => `spell${index + 1}`), "pact"];
        const slots = keys.map((key) => {
            const definition = definitions?.[key] || {};
            const state = runtime?.[key] || {};
            const maximum = Number(state.max ?? definition.max ?? definition.override ?? 0) || 0;
            if (!maximum) return null;
            const usesSpent = state.spent !== undefined && state.spent !== null;
            const path = `system.spells.${key}.${usesSpent ? "spent" : "value"}`;
            const rawValue = Number(usesSpent ? state.spent : (state.value ?? maximum)) || 0;
            const used = usesSpent ? rawValue : Math.max(0, maximum - rawValue);
            const label = key === "pact" ? "Patto" : `Livello ${key.replace("spell", "")}`;
            if (!canEdit) return `<div class="managed-spell-slot"><span>${label}</span><strong>${used}/${maximum}</strong><small>usati</small></div>`;
            const desiredRaw = getManagedActorDesiredValue(path, rawValue);
            const desiredUsed = usesSpent ? Number(desiredRaw || 0) : Math.max(0, maximum - Number(desiredRaw ?? maximum));
            const original = escapeAttr(JSON.stringify(rawValue));
            return `<label class="managed-spell-slot managed-spell-slot--editable"><span>${label}</span><input type="number" min="0" max="${maximum}" step="1" value="${desiredUsed}" data-managed-actor-path="${path}" data-managed-actor-type="spell-used" data-managed-spell-max="${maximum}" data-managed-spell-mode="${usesSpent ? "spent" : "remaining"}" data-managed-actor-original="${original}"><small>usati su ${maximum}</small></label>`;
        }).filter(Boolean);
        if (!slots.length) return "";
        return `<div class="managed-spell-editor"><div class="managed-rule-editor-heading"><i class="fas fa-wand-sparkles"></i><div><strong>Slot incantesimo</strong><span>Gli slot usati vengono sincronizzati con Foundry.</span></div></div><div class="managed-spell-slot-grid">${slots.join("")}</div></div>`;
    }
    function renderAbilities(abilities, canEdit = false) {
        const entries = Object.entries(abilities).filter(([, value]) => value && typeof value === "object");
        if (!entries.length) return "";
        const labels = { str: "Forza", dex: "Destrezza", con: "Costituzione", int: "Intelligenza", wis: "Saggezza", cha: "Carisma" };
        return `<section id="managed-abilities" class="managed-panel managed-panel--wide managed-panel--abilities"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Valori e tiri salvezza</span><h2><i class="fas fa-dumbbell"></i> Caratteristiche</h2></div></header><div class="managed-ability-grid">${entries.map(([key, value]) => `<div class="managed-ability"><span>${escapeHtml(labels[key] || key)}</span>${canEdit ? renderManagedActorControl(`system.abilities.${key}.value`, "number", value.value ?? 10, { min: 0, max: 99, step: 1, className: "managed-ability-score" }) : `<strong>${escapeHtml(String(value.value ?? "—"))}</strong>`}<b>${formatSigned(value.mod)}</b>${canEdit ? `<label class="managed-ability-save"><span>TS</span>${renderManagedProficiencyControl(`system.abilities.${key}.proficient`, value.proficient ?? 0)}</label>` : `<small>TS ${formatSigned(getManagedAbilitySave(value))}</small>`}</div>`).join("")}</div></section>`;
    }

    function renderSkills(skills, canEdit = false) {
        const entries = Object.entries(skills).filter(([, value]) => value && typeof value === "object");
        if (!entries.length) return "";
        const labels = { acr: "Acrobazia", ani: "Addestrare Animali", arc: "Arcano", ath: "Atletica", dec: "Inganno", his: "Storia", ins: "Intuizione", itm: "Intimidire", inv: "Investigare", med: "Medicina", nat: "Natura", prc: "Percezione", prf: "Intrattenere", per: "Persuasione", rel: "Religione", slt: "Rapidità di Mano", ste: "Furtività", sur: "Sopravvivenza" };
        const abilityLabels = { str: "FOR", dex: "DES", con: "COS", int: "INT", wis: "SAG", cha: "CAR" };
        return `<section id="managed-skills" class="managed-panel managed-panel--wide managed-panel--skills"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Addestramento e padronanza</span><h2><i class="fas fa-list-check"></i> Abilità</h2></div><span class="managed-count-badge">${entries.length}</span></header><div class="managed-skill-grid">${entries.map(([key, value]) => `<label class="managed-skill"><span class="managed-skill-name">${escapeHtml(labels[key] || key)}<small>${escapeHtml(abilityLabels[value.ability] || String(value.ability || "").toUpperCase())}</small></span>${canEdit ? renderManagedProficiencyControl(`system.skills.${key}.value`, value.value ?? value.proficient ?? 0) : `<strong>${formatSigned(value.total ?? value.mod ?? 0)}</strong>`}</label>`).join("")}</div></section>`;
    }

    function renderTraits(traits, canEdit = false) {
        const rows = [
            ["Resistenze", "dr", formatTrait(traits.dr)],
            ["Immunità", "di", formatTrait(traits.di)],
            ["Vulnerabilità", "dv", formatTrait(traits.dv)],
            ["Immunità condizioni", "ci", formatTrait(traits.ci)],
            ["Linguaggi", "languages", formatTrait(traits.languages)]
        ];
        const visibleRows = canEdit ? rows : rows.filter(([, , value]) => value);
        if (!visibleRows.length && !canEdit) return "";
        if (canEdit) {
            const editors = `${renderManagedDamageTraitsEditor(traits)}${renderManagedTraitEditor("Immunità condizioni", "ci", traits.ci)}${renderManagedTraitEditor("Linguaggi", "languages", traits.languages)}`;
            return `<section id="managed-traits" class="managed-panel managed-panel--wide managed-panel--traits"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Difese e identità</span><h2><i class="fas fa-fingerprint"></i> Tratti</h2></div></header><div class="managed-trait-editor-grid">${editors}</div></section>`;
        }
        const readonlyRows = visibleRows.map(([label, , value]) => [label, value]);
        return `<section id="managed-traits" class="managed-panel managed-panel--wide managed-panel--traits"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Difese e identità</span><h2><i class="fas fa-fingerprint"></i> Tratti</h2></div></header><div class="managed-trait-list">${readonlyRows.map(([label, value]) => `<div class="managed-trait"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}</div></section>`;
    }

    function renderManagedDamageTraitsEditor(traits) {
        const options = [
            ["acid", "Acido"], ["bludgeoning", "Contundente"], ["cold", "Freddo"], ["fire", "Fuoco"],
            ["force", "Forza"], ["lightning", "Fulmine"], ["necrotic", "Necrotico"], ["piercing", "Perforante"],
            ["poison", "Veleno"], ["psychic", "Psichico"], ["radiant", "Radioso"], ["slashing", "Tagliente"], ["thunder", "Tuono"]
        ];
        const physicalTypes = new Set(["bludgeoning", "piercing", "slashing"]);
        const columns = [
            ["dr", "Resistenza"],
            ["dv", "Vulnerabilità"],
            ["di", "Immunità"]
        ].map(([key, label]) => {
            const path = `system.traits.${key}.value`;
            const bypassPath = `system.traits.${key}.bypasses`;
            const desired = normalizeManagedTraitValues(getManagedActorDesiredValue(path, traits?.[key]?.value ?? traits?.[key]));
            const bypasses = normalizeManagedTraitValues(getManagedActorDesiredValue(bypassPath, traits?.[key]?.bypasses ?? []));
            const known = new Set(options.map(([value]) => value));
            return { key, label, path, bypassPath, desired, bypasses, other: desired.filter((value) => !known.has(value)) };
        });
        const valueTrackers = columns.map((column) => `<div class="managed-matrix-tracker" data-managed-actor-path="${escapeAttr(column.path)}" data-managed-actor-type="damage-matrix" data-managed-actor-original="${escapeAttr(JSON.stringify(column.desired))}" data-managed-matrix-key="${column.key}"></div>`).join("");
        const bypassTrackers = columns.map((column) => `<div class="managed-matrix-tracker" data-managed-actor-path="${escapeAttr(column.bypassPath)}" data-managed-actor-type="bypass-magic" data-managed-actor-original="${escapeAttr(JSON.stringify(column.bypasses))}" data-managed-matrix-key="${column.key}" data-managed-includes-magical="${column.bypasses.includes("mgc") ? "false" : "true"}"></div>`).join("");
        const rows = options.map(([value, label]) => {
            const selectedColumn = columns.find((column) => column.desired.includes(value));
            const selected = selectedColumn?.key || "";
            const physical = physicalTypes.has(value);
            const includesMagical = Boolean(selectedColumn && !selectedColumn.bypasses.includes("mgc"));
            return `<div class="managed-damage-row" data-managed-damage-row><strong>${escapeHtml(label)}</strong><select data-managed-damage-select data-managed-damage-type="${escapeAttr(value)}" aria-label="Effetto per ${escapeAttr(label)}"><option value="" ${!selected ? "selected" : ""}>Nessuna</option><option value="dr" ${selected === "dr" ? "selected" : ""}>Resistenza</option><option value="dv" ${selected === "dv" ? "selected" : ""}>Vulnerabilità</option><option value="di" ${selected === "di" ? "selected" : ""}>Immunità</option></select>${physical ? `<label class="managed-damage-magic" title="L'effetto si applica anche ai danni magici"><input type="checkbox" data-managed-damage-magic ${includesMagical ? "checked" : ""} ${selected ? "" : "disabled"}><span>Magici</span></label>` : '<span class="managed-damage-magic-placeholder" aria-hidden="true"></span>'}</div>`;
        }).join("");
        const custom = columns.map((column) => {
            const customValue = traits?.[column.key] && typeof traits[column.key] === "object" ? String(traits[column.key].custom || "") : "";
            return `<div class="managed-damage-extra"><strong>${escapeHtml(column.label)}</strong><label><span>Altri tipi</span><input type="text" value="${escapeAttr(column.other.join(", "))}" placeholder="Separati da virgola" data-managed-matrix-other="${column.key}"></label><label><span>Nota personalizzata</span>${renderManagedActorControl(`system.traits.${column.key}.custom`, "text", customValue, { placeholder: "Eccezioni o dettagli" })}</label></div>`;
        }).join("");
        return `<div class="managed-trait-editor managed-trait-editor--damage"><span><i class="fas fa-shield-halved"></i> Difese dai danni</span><div class="managed-damage-matrix"><div class="managed-damage-list">${rows}</div><div class="managed-damage-extras">${custom}</div>${valueTrackers}${bypassTrackers}</div></div>`;
    }

    function setupManagedDamageMagicControls(root) {
        const matrix = root.querySelector(".managed-damage-matrix");
        if (!matrix) return;
        const trackerFor = (key) => matrix.querySelector(`[data-managed-actor-type="bypass-magic"][data-managed-matrix-key="${CSS.escape(key)}"]`);
        const syncRow = (row) => {
            const select = row.querySelector("[data-managed-damage-select]");
            const checkbox = row.querySelector("[data-managed-damage-magic]");
            if (!select || !checkbox) return;
            const key = String(select.value || "");
            checkbox.disabled = !key;
            checkbox.checked = key ? trackerFor(key)?.dataset.managedIncludesMagical === "true" : false;
        };
        matrix.querySelectorAll("[data-managed-damage-select]").forEach((select) => select.addEventListener("change", () => syncRow(select.closest("[data-managed-damage-row]"))));
        matrix.querySelectorAll("[data-managed-damage-magic]").forEach((checkbox) => checkbox.addEventListener("change", () => {
            const key = String(checkbox.closest("[data-managed-damage-row]")?.querySelector("[data-managed-damage-select]")?.value || "");
            const tracker = trackerFor(key);
            if (!key || !tracker) return;
            tracker.dataset.managedIncludesMagical = checkbox.checked ? "true" : "false";
            matrix.querySelectorAll("[data-managed-damage-row]").forEach((row) => {
                if (String(row.querySelector("[data-managed-damage-select]")?.value || "") === key) syncRow(row);
            });
        }));
        matrix.querySelectorAll("[data-managed-damage-row]").forEach(syncRow);
    }
    function renderManagedTraitEditor(label, key, trait) {
        const values = normalizeManagedTraitValues(trait?.value ?? trait);
        const custom = trait && typeof trait === "object" && !Array.isArray(trait) ? String(trait.custom || "") : "";

        const conditionOptions = [
            ["blinded", "Accecato"], ["charmed", "Affascinato"], ["deafened", "Assordato"], ["exhaustion", "Indebolimento"],
            ["frightened", "Spaventato"], ["grappled", "Afferrato"], ["incapacitated", "Incapacitato"], ["invisible", "Invisibile"],
            ["paralyzed", "Paralizzato"], ["petrified", "Pietrificato"], ["poisoned", "Avvelenato"], ["prone", "Prono"],
            ["restrained", "Trattenuto"], ["stunned", "Stordito"], ["unconscious", "Privo di sensi"]
        ];
        const choiceOptions = key === "ci" ? conditionOptions : null;
        const valuesControl = choiceOptions
            ? renderManagedActorControl(`system.traits.${key}.value`, "chip-list", values, { options: choiceOptions })
            : renderManagedActorControl(`system.traits.${key}.value`, "list", values, { placeholder: "Separa le voci con una virgola" });
        return `<div class="managed-trait-editor ${choiceOptions ? "managed-trait-editor--choices" : ""}"><span><i class="fas fa-shield-heart"></i> ${escapeHtml(label)}</span><div class="managed-trait-values"><small>${choiceOptions ? "Seleziona una o più opzioni" : "Valori"}</small>${valuesControl}</div><label><small>Personalizzato</small>${renderManagedActorControl(`system.traits.${key}.custom`, "text", custom, { placeholder: "Nota o resistenza speciale" })}</label></div>`;
    }

    function normalizeManagedTraitValues(value) {
        if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
        if (value && typeof value === "object") return Object.keys(value).filter((key) => value[key]);
        return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
    }

    function renderManagedProficiencyControl(path, value) {
        return renderManagedActorControl(path, "select-number", Number(value || 0), { options: [[0, "Nessuna"], [.5, "Mezza"], [1, "Competente"], [2, "Maestria"]] });
    }

    function renderManagedActorControl(path, type, fallbackValue, options = {}) {
        const desired = getManagedActorDesiredValue(path, fallbackValue);
        const serialized = escapeAttr(JSON.stringify(desired ?? null));
        const common = `data-managed-actor-path="${escapeAttr(path)}" data-managed-actor-type="${escapeAttr(type)}" data-managed-actor-original="${serialized}"`;
        const className = options.className ? ` class="${escapeAttr(options.className)}"` : "";
        if (type === "chip-list") {
            const selected = normalizeManagedTraitValues(desired);
            const values = Array.isArray(options.options) ? options.options : [];
            const known = new Set(values.map(([value]) => String(value)));
            const other = selected.filter((value) => !known.has(String(value)));
            return `<div class="managed-choice-control" ${common}>${values.map(([value, label]) => `<label class="managed-choice"><input type="checkbox" value="${escapeAttr(value)}" ${selected.includes(String(value)) ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}<label class="managed-choice-other"><span>Altro</span><input type="text" value="${escapeAttr(other.join(", "))}" placeholder="Tipi aggiuntivi, separati da virgola" data-managed-choice-other></label></div>`;
        }
        if (type === "boolean") return `<input type="checkbox" ${desired ? "checked" : ""} ${common}${className}>`;
        if (type === "select" || type === "select-number") {
            const values = Array.isArray(options.options) ? [...options.options] : [];
            if (!values.some(([value]) => String(value) === String(desired))) values.unshift([desired, String(desired || "Altro")]);
            return `<select ${common}${className}>${values.map(([value, label]) => `<option value="${escapeAttr(value)}" ${String(value) === String(desired) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
        }
        const inputType = type === "number" ? "number" : "text";
        const value = type === "list" ? normalizeManagedTraitValues(desired).join(", ") : String(desired ?? "");
        const bounds = type === "number" ? `${options.min !== undefined ? ` min="${Number(options.min)}"` : ""}${options.max !== undefined ? ` max="${Number(options.max)}"` : ""}${options.step !== undefined ? ` step="${Number(options.step)}"` : ""}` : "";
        return `<input type="${inputType}" value="${escapeAttr(value)}"${bounds}${options.placeholder ? ` placeholder="${escapeAttr(options.placeholder)}"` : ""} ${common}${className}>`;
    }

    function findManagedActorUpdateCommand() {
        const commands = Array.isArray(currentDocument?.sync?.commands) ? currentDocument.sync.commands : [];
        return commands.find((command) => command.kind === "actor.update") || null;
    }

    function getManagedActorDesiredValue(path, fallbackValue) {
        const command = findManagedActorUpdateCommand();
        const patch = (Array.isArray(command?.patches) ? command.patches : []).find((entry) => entry.path === path);
        return patch ? patch.value : fallbackValue;
    }

    function renderManagedActorCommandStatus() {
        const command = findManagedActorUpdateCommand();
        if (!command) return "";
        const label = command.status === "pending" ? formatManagedPendingFields(command.patches || []) : command.status === "conflict" ? formatManagedActorConflict(command) : "Invio fallito: salva per riprovare";
        return `<span class="managed-actor-sync managed-actor-sync--${escapeAttr(command.status || "pending")}"><i class="fas ${command.status === "pending" ? "fa-clock" : "fa-triangle-exclamation"}"></i> ${escapeHtml(label)}</span>`;
    }
    function formatManagedActorConflict(command) {
        const patches = Array.isArray(command?.patches) ? command.patches : [];
        const current = command?.current && typeof command.current === "object" ? command.current : {};
        const alreadySatisfied = patches.length > 0 && patches.every((patch) => Object.prototype.hasOwnProperty.call(current, patch.path)
            && sameManagedFormValue(current[patch.path], patch.value));
        if (alreadySatisfied) return "Valore gi\u00e0 presente in Foundry. Salva per chiudere l'avviso";
        const conflict = patches.find((patch) => Object.prototype.hasOwnProperty.call(current, patch.path)
            && !sameManagedFormValue(current[patch.path], patch.value)
            && !sameManagedFormValue(current[patch.path], patch.baseValue));
        if (!conflict) return command?.error ? `Conflitto: ${command.error}. Salva per confermare` : "Conflitto: salva per confermare";
        return `Conflitto — ${managedActorFieldLabel(conflict.path)}: richiesto ${formatManagedConflictValue(conflict.value)}, Foundry ${formatManagedConflictValue(current[conflict.path])}. Salva per confermare`;
    }

    function formatManagedConflictValue(value) {
        if (value === null || value === undefined || value === "") return "vuoto";
        if (Array.isArray(value)) return value.length ? value.join(", ") : "nessuno";
        if (typeof value === "boolean") return value ? "sì" : "no";
        return String(value);
    }
    function renderManagedEffects(effects, canEdit = false) {
        const cards = effects.map((effect) => {
            const command = findManagedEffectCommand(effect);
            const status = command ? renderManagedEntitySyncStatus(command) : "";
            const desiredName = getManagedEffectDesiredValue(effect, command, "name", String(effect.name ?? "Effetto"));
            const desiredDisabled = getManagedEffectDesiredValue(effect, command, "disabled", effect.disabled === true) === true;
            const desiredStatuses = getManagedEffectDesiredValue(effect, command, "statuses", Array.isArray(effect.statuses) ? effect.statuses : []);
            const desiredDuration = getManagedEffectDesiredValue(effect, command, "duration", effect.duration ?? {});
            const desiredChanges = getManagedEffectDesiredValue(effect, command, "changes", effect.changes ?? []);
            if (!canEdit) return `<article class="managed-effect-card"><div class="managed-effect-title"><i class="fas fa-wand-magic-sparkles"></i><div><h3>${escapeHtml(desiredName)}</h3><span>${desiredDisabled ? "Disattivato" : "Attivo"}</span></div></div>${desiredStatuses.length ? `<p>${escapeHtml(desiredStatuses.join(", "))}</p>` : ""}</article>`;
            return `<article class="managed-effect-card" data-managed-effect-form="${escapeAttr(effect.id || effect.clientId || "")}" data-managed-effect-id="${escapeAttr(effect.id || "")}" data-managed-effect-client-id="${escapeAttr(effect.clientId || "")}">${status}<div class="managed-effect-title"><i class="fas fa-wand-magic-sparkles"></i><label><span>Nome</span><input type="text" value="${escapeAttr(desiredName)}" data-managed-effect-path="name" data-managed-effect-type="text" data-managed-effect-original="${escapeAttr(JSON.stringify(effect.name || "Effetto"))}"></label><label class="managed-item-check"><input type="checkbox" ${desiredDisabled ? "checked" : ""} data-managed-effect-path="disabled" data-managed-effect-type="boolean" data-managed-effect-original="${effect.disabled ? "true" : "false"}"><span>Disattivato</span></label></div><label><span>Stati</span><input type="text" value="${escapeAttr(desiredStatuses.join(", "))}" data-managed-effect-path="statuses" data-managed-effect-type="list" data-managed-effect-original="${escapeAttr(JSON.stringify(effect.statuses || []))}"></label><div class="managed-effect-json-grid"><label><span>Durata</span><textarea rows="5" data-managed-effect-path="duration" data-managed-effect-type="json" data-managed-effect-original="${escapeAttr(JSON.stringify(desiredDuration))}">${escapeHtml(JSON.stringify(desiredDuration, null, 2))}</textarea></label><label><span>Modifiche</span><textarea rows="5" data-managed-effect-path="changes" data-managed-effect-type="json" data-managed-effect-original="${escapeAttr(JSON.stringify(desiredChanges))}">${escapeHtml(JSON.stringify(desiredChanges, null, 2))}</textarea></label></div><div class="managed-item-actions"><span data-managed-effect-result></span><button type="button" class="button-gold-outline managed-danger-action" data-managed-effect-delete><i class="fas fa-trash"></i> Elimina</button><button type="button" class="button-gold-outline managed-primary-action" data-managed-effect-save><i class="fas fa-cloud-arrow-up"></i> Invia a Foundry</button></div></article>`;
        }).join("");
        const creator = canEdit ? `<details class="managed-create-editor managed-effect-create"><summary><span><i class="fas fa-plus"></i> Nuovo effetto</span><i class="fas fa-chevron-down"></i></summary><div class="managed-create-form" data-managed-effect-create-form><div class="managed-item-fields"><label><span>Nome</span><input type="text" value="Nuovo effetto" data-managed-effect-create-field="name"></label><label><span>Stati</span><input type="text" placeholder="prone, poisoned" data-managed-effect-create-field="statuses"></label><label class="managed-item-check"><input type="checkbox" data-managed-effect-create-field="disabled"><span>Crea disattivato</span></label></div><div class="managed-effect-json-grid"><label><span>Durata</span><textarea rows="4" data-managed-effect-create-field="duration">{}</textarea></label><label><span>Modifiche</span><textarea rows="4" data-managed-effect-create-field="changes">[]</textarea></label></div><div class="managed-item-actions"><span data-managed-effect-create-result></span><button type="button" class="button-gold-outline managed-primary-action" data-managed-effect-create><i class="fas fa-plus"></i> Crea in Foundry</button></div></div></details>` : "";
        return `<section id="managed-effects" class="managed-panel managed-panel--wide managed-panel--effects"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Condizioni e automazioni</span><h2><i class="fas fa-wand-magic-sparkles"></i> Effetti attivi</h2></div><span class="managed-count-badge">${effects.length}</span></header><div class="managed-effects-grid">${cards || `<div class="managed-empty-state"><i class="fas fa-wand-magic-sparkles"></i><strong>Nessun effetto</strong></div>`}</div>${creator}</section>`;
    }

    function findManagedEffectCommand(effect) {
        const commands = Array.isArray(currentDocument?.sync?.commands) ? currentDocument.sync.commands : [];
        return commands.find((command) => String(command.kind || "").startsWith("effect.") && ((effect.id && command.target?.effectId === effect.id) || (effect.clientId && command.target?.clientId === effect.clientId))) || null;
    }

    function getManagedEffectBaseValue(effect, path) {
        if (path === "name") return String(effect?.name ?? "Effetto");
        if (path === "disabled") return effect?.disabled === true;
        if (path === "statuses") return Array.isArray(effect?.statuses) ? effect.statuses : [];
        if (path === "duration") return effect?.duration ?? {};
        if (path === "changes") return effect?.changes ?? [];
        if (path === "img") return String(effect?.img || "");
        return undefined;
    }

    function getManagedEffectDesiredValue(effect, command, path, fallbackValue = undefined) {
        const patch = (Array.isArray(command?.patches) ? command.patches : []).find((entry) => entry.path === path);
        return patch ? patch.value : (fallbackValue !== undefined ? fallbackValue : getManagedEffectBaseValue(effect, path));
    }

    function findCurrentManagedEffect(effectId, clientId) {
        return (Array.isArray(currentDocument?.definition?.effects) ? currentDocument.definition.effects : []).find((effect) => (effectId && effect.id === effectId) || (!effectId && clientId && effect.clientId === clientId));
    }
    function renderManagedEntitySyncStatus(command) {
        const action = String(command.kind || "").endsWith(".delete") ? "Eliminazione" : String(command.kind || "").endsWith(".create") ? "Creazione" : "Modifica";
        const label = command.status === "pending" ? `${action} in attesa di Foundry` : command.status === "conflict" ? `Conflitto: ${command.error || action}` : `${action} fallita: ${command.error || "riprova"}`;
        return `<div class="managed-item-sync managed-item-sync--${escapeAttr(command.status || "pending")}"><i class="fas ${command.status === "pending" ? "fa-clock" : "fa-triangle-exclamation"}"></i> ${escapeHtml(label)}</div>`;
    }
    function renderManagedVariantsEditor(variants, canEdit) {
        const cards = variants.map((variant) => `<article class="managed-variant" data-managed-variant="${escapeAttr(variant.id)}">
            <div class="managed-variant-preview">
                ${renderImage(variant.path, variant.name || "Variante")}
                <span>r${Number(variant.revision || 1)}</span>
            </div>
            <div class="managed-variant-body">
                ${canEdit ? `
                    <label><span>Nome variante</span><input type="text" value="${escapeAttr(variant.name || "Variante")}" data-managed-variant-name="${escapeAttr(variant.id)}"></label>
                    <div class="managed-variant-row">
                        <label><span>Dimensione</span><input type="number" min="0.5" max="12" step="0.25" value="${Number(variant.width || 1)}" data-managed-variant-size="${escapeAttr(variant.id)}"></label>
                        <span class="managed-source-badge"><i class="fas fa-arrows-rotate"></i> ${variant.source === "site" ? "Sito" : "Foundry"}</span>
                    </div>
                    <label class="managed-file-field"><span>Sostituisci immagine</span><input type="file" accept="image/*" data-managed-variant-file="${escapeAttr(variant.id)}"></label>
                    <label class="managed-remove-field"><input type="checkbox" data-managed-variant-remove="${escapeAttr(variant.id)}"><span>Rimuovi questa variante</span></label>
                ` : `<h3>${escapeHtml(formatManagedVariantName(variant.name || "Variante"))}</h3><p>${escapeHtml(`${variant.width || 1} × ${variant.height || variant.width || 1}`)}</p>`}
            </div>
        </article>`).join("");
        const empty = !variants.length ? `<div class="managed-empty-state"><i class="fas fa-layer-group"></i><strong>Nessuna variante</strong><span>Il token base continuerà a essere usato normalmente.</span></div>` : "";
        const add = canEdit ? `<fieldset class="managed-variant-add"><legend><i class="fas fa-plus"></i> Nuova variante</legend><p>Carica un WebP o un'altra immagine: verrà convertita e collegata automaticamente anche a Foundry.</p><div><label><span>Nome</span><input type="text" value="Nuova variante" data-managed-variant-add-name></label><label><span>Dimensione token</span><input type="number" min="0.5" max="12" step="0.25" value="1" data-managed-variant-add-size></label><label class="managed-file-field"><span>Immagine</span><input type="file" accept="image/*" data-managed-variant-add-file></label></div></fieldset>` : "";
        return `<section id="managed-variants" class="managed-panel managed-panel--wide managed-panel--variants"><header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Raccolta condivisa</span><h2><i class="fas fa-layer-group"></i> Varianti token</h2></div><span class="managed-count-badge">${variants.length}</span></header><div class="managed-variants">${cards}${empty}</div>${add}</section>`;
    }
    function renderManagedMerchantShop(merchant = {}) {
        const inventory = Array.isArray(merchant.inventory) ? merchant.inventory : [];
        const subtitle = String(merchant.subtitle || "").trim();
        const cards = inventory.map((entry, index) => renderManagedMerchantCard(entry, index)).join("");
        const empty = `<div class="managed-empty-state managed-merchant-empty"><i class="fas fa-shop-lock"></i><strong>Banco vuoto</strong><span>Il mercante non ha articoli disponibili.</span></div>`;
        return `<section id="managed-shop" class="managed-panel managed-panel--wide managed-panel--merchant">
            <header class="managed-panel-heading managed-merchant-heading">
                <div><span class="managed-panel-eyebrow">Emporio</span><h2><i class="fas fa-store"></i> Negozio</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div>
                <span class="managed-count-badge">${inventory.length}</span>
            </header>
            <div class="managed-merchant-grid">${cards || empty}</div>
        </section>`;
    }

    function renderManagedMerchantCard(entry = {}, index = 0) {
        const description = stripManagedDuplicateHeading(htmlToText(normalizeManagedMerchantDescription(entry.description)), entry.name);
        const preview = truncatePreview(description, 360);
        const meta = formatEntryMeta(entry);
        const stock = formatManagedMerchantStock(entry.stock);
        const facts = getManagedMerchantFacts(entry);
        const details = description || facts.length ? `<details class="managed-merchant-details"><summary><span><i class="fas fa-scroll"></i> Scheda articolo</span><i class="fas fa-chevron-down"></i></summary><div>${description ? `<p>${formatManagedPreview(description)}</p>` : ""}${facts.length ? `<dl>${facts.map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd></div>`).join("")}</dl>` : ""}</div></details>` : "";
        const order = String(index + 1).padStart(2, "0");
        return `<article class="managed-merchant-item ${stock.className}">
            <div class="managed-merchant-item-copy">
                <header><div class="managed-merchant-title"><span class="managed-merchant-order">${order}</span><div><h3>${escapeHtml(entry.name || "Oggetto")}</h3>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</div></div><strong class="managed-merchant-price">${escapeHtml(formatManagedMerchantPrice(entry.price))}</strong></header>
                <span class="managed-merchant-stock"><i class="fas ${stock.icon}"></i> ${escapeHtml(stock.label)}</span>
                ${preview ? `<p class="managed-merchant-preview">${formatManagedPreview(preview)}</p>` : ""}
                ${details}
            </div>
        </article>`;
    }

    function formatManagedMerchantPrice(price = {}) {
        const value = Math.max(0, Number(price?.value ?? 0) || 0);
        const labels = { cp: "mr", sp: "ma", ep: "me", gp: "mo", pp: "mp" };
        const amount = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
        return `${amount} ${labels[String(price?.denomination || "gp").toLowerCase()] || String(price?.denomination || "mo")}`;
    }

    function formatManagedMerchantStock(value) {
        if (value === null || value === undefined || value === "") return { label: "Disponibilit\u00e0 illimitata", icon: "fa-infinity", className: "has-stock" };
        const stock = Math.max(0, Math.floor(Number(value) || 0));
        if (!stock) return { label: "Esaurito", icon: "fa-ban", className: "is-sold-out" };
        return { label: stock === 1 ? "Ultimo disponibile" : `${stock} disponibili`, icon: "fa-box-open", className: "has-stock" };
    }

    function getManagedMerchantFacts(entry = {}) {
        const definition = entry.definition || {};
        const rarityLabels = { common: "Comune", uncommon: "Non comune", rare: "Raro", veryRare: "Molto raro", legendary: "Leggendario", artifact: "Artefatto" };
        const facts = [];
        const add = (label, value) => {
            if (value === undefined || value === null || value === "" || value === false) return;
            facts.push({ label, value: String(value) });
        };
        add("Rarit\u00e0", rarityLabels[String(definition.rarity || "")] || definition.rarity);
        const weight = definition.weight && typeof definition.weight === "object" ? definition.weight.value : definition.weight;
        const weightUnits = definition.weight && typeof definition.weight === "object" ? definition.weight.units : "";
        add("Peso", weight !== undefined && weight !== null && weight !== "" ? `${weight}${weightUnits ? ` ${weightUnits}` : ""}` : "");
        add("Sintonia", definition.attunement || definition.attuned ? "Richiesta" : "");
        add("Livello", definition.level);
        const activation = definition.activation || {};
        add("Attivazione", activation.type ? [activation.cost, activation.type].filter((value) => value !== undefined && value !== "").join(" ") : "");
        const range = definition.range || {};
        add("Gittata", range.value !== undefined ? `${range.value}${range.units ? ` ${range.units}` : ""}` : "");
        add("Requisiti", definition.requirements);
        const uses = definition.uses || {};
        add("Utilizzi", uses.max ? `${uses.max}${uses.per ? ` / ${uses.per}` : ""}` : "");
        return facts;
    }

    function renderEntries(title, entries, canEdit = false, sectionId = "") {
        if (!entries.length && !canEdit) return "";
        const panelIcon = title === "Incantesimi" ? "fa-wand-sparkles" : title === "Inventario" ? "fa-backpack" : "fa-burst";
        const collectionKind = title === "Incantesimi" ? "spells" : title === "Inventario" ? "inventory" : "capabilities";
        const preparedEntries = entries.map((entry) => ({ entry, group: getManagedEntryGroup(entry, collectionKind) }));
        const groups = Array.from(new Set(preparedEntries.map(({ group }) => group.key))).map((key) => ({
            ...preparedEntries.find(({ group }) => group.key === key).group,
            entries: preparedEntries.filter(({ group }) => group.key === key).map(({ entry }) => entry)
        })).sort((left, right) => left.order - right.order);
        const cardsFor = (groupEntries, groupKey) => groupEntries.map((entry) => renderManagedEntryCard(entry, canEdit, groupKey)).join("");
        const groupedContent = groups.length ? groups.map((group) => `<section class="managed-entry-group" data-managed-entry-group="${escapeAttr(group.key)}"><header><span>${escapeHtml(group.label)}</span><b>${group.entries.length}</b></header><div class="managed-entry-grid">${cardsFor(group.entries, group.key)}</div></section>`).join("") : "";
        const empty = !entries.length ? `<div class="managed-empty-state"><i class="fas ${panelIcon}"></i><strong>Nessun elemento</strong><span>Puoi aggiungerne uno entrando in modifica.</span></div>` : "";
        const hasUnprepared = collectionKind === "spells" && entries.some((entry) => getManagedSpellPreparation(entry, findManagedItemCommand(entry))?.key === "unprepared");
        const groupFilterButtons = groups.length > 1 ? `<button type="button" class="is-active" data-managed-entry-filter="all">Tutti</button>${groups.map((group) => `<button type="button" data-managed-entry-filter="${escapeAttr(group.key)}">${escapeHtml(group.shortLabel || group.label)}</button>`).join("")}` : "";
        const preparationFilterButton = hasUnprepared ? `<button type="button" data-managed-prepared-only aria-pressed="false"><i class="fas fa-circle-check"></i> Solo preparati</button>` : "";
        const filterButtons = groupFilterButtons || preparationFilterButton ? `<div class="managed-filter-chips" role="group" aria-label="Filtra ${escapeAttr(title)}">${groupFilterButtons}${preparationFilterButton}</div>` : "";
        const tools = entries.length > 5 ? `<div class="managed-collection-tools"><label class="managed-collection-search"><i class="fas fa-magnifying-glass"></i><input type="search" placeholder="Cerca ${escapeAttr(title.toLowerCase())}" aria-label="Cerca ${escapeAttr(title.toLowerCase())}" data-managed-entry-search></label>${filterButtons}<span class="managed-collection-result"><b data-managed-visible-count>${entries.length}</b> risultati</span></div>` : filterButtons ? `<div class="managed-collection-tools">${filterButtons}<span class="managed-collection-result"><b data-managed-visible-count>${entries.length}</b> risultati</span></div>` : "";
        const lead = collectionKind === "spells" ? "Cerca e filtra il grimorio; apri soltanto ciò che vuoi leggere o modificare." : collectionKind === "capabilities" ? "Azioni, reazioni e capacità sono ordinate secondo il loro utilizzo in Foundry." : "Equipaggiamento e risorse collegate all’Actor originale.";
        return `<details${sectionId ? ` id="${escapeAttr(sectionId)}"` : ""} class="managed-panel managed-panel--wide managed-panel--entries managed-collection managed-collection--${collectionKind}" data-managed-collection="${collectionKind}"><summary class="managed-panel-heading managed-collection-summary"><div><span class="managed-panel-eyebrow">Dati Foundry</span><h2><i class="fas ${panelIcon}"></i> ${escapeHtml(title)}</h2></div><span class="managed-collection-summary-meta"><span class="managed-count-badge">${entries.length}</span><i class="fas fa-chevron-down" aria-hidden="true"></i></span></summary><div class="managed-collection-body">${entries.length ? `<p class="managed-panel-lead">${escapeHtml(lead)}</p>${tools}<div class="managed-entry-groups">${groupedContent}</div>` : empty}${canEdit ? renderManagedItemCreator(title) : ""}</div></details>`;
    }
    function renderManagedEntryCard(entry, canEdit, groupKey) {
        const icon = entry.media?.icon?.path;
        const description = truncatePreview(stripManagedDuplicateHeading(htmlToText(entry.definition?.description || ""), entry.name), 900);
        const meta = formatEntryMeta(entry);
        const command = findManagedItemCommand(entry);
        const preparation = getManagedSpellPreparation(entry, command);
        const editor = canEdit ? renderManagedItemEditor(entry, command) : "";
        const status = command ? renderManagedItemSyncStatus(command) : "";
        const searchText = normalizeManagedSearch([entry.name, meta, preparation?.label, description].filter(Boolean).join(" "));
        const level = Number(entry.definition?.level ?? 0) || 0;
        const disclosure = description ? `<details class="managed-entry-disclosure"><summary><span><i class="fas fa-book-open"></i> Descrizione</span><i class="fas fa-chevron-down"></i></summary><div>${formatManagedPreview(description)}</div></details>` : "";
        const preparationAttribute = preparation ? ` data-managed-spell-preparation="${escapeAttr(preparation.key)}"` : "";
        const preparationBadge = preparation ? `<span class="managed-spell-preparation is-${escapeAttr(preparation.key)}"><i class="fas ${escapeAttr(preparation.icon)}"></i>${escapeHtml(preparation.label)}</span>` : "";
        return `<article class="managed-entry ${preparation ? `managed-entry--spell-${escapeAttr(preparation.key)}` : ""}" data-managed-item-card="${escapeAttr(entry.transferId || entry.itemId || "")}" data-managed-entry-search-value="${escapeAttr(searchText)}" data-managed-entry-level="${level}" data-managed-entry-group-key="${escapeAttr(groupKey)}"${preparationAttribute}>${icon ? `<img src="${escapeAttr(resolveMedia(icon))}" alt="">` : '<div class="managed-entry-icon"><i class="fas fa-dice-d20"></i></div>'}<div class="managed-entry-copy"><div class="managed-entry-title"><h3>${escapeHtml(entry.name || "Elemento")}</h3>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</div>${preparationBadge}${status}${disclosure}${editor}</div></article>`;
    }

    function getManagedSpellPreparation(entry, command) {
        if (entry?.type !== "spell") return null;
        const mode = String(getManagedItemDesiredValue(entry, command, "system.preparation.mode") || "").trim().toLowerCase();
        const rawPrepared = getManagedItemDesiredValue(entry, command, "system.preparation.prepared");
        const prepared = rawPrepared === true || rawPrepared === 1 || String(rawPrepared).toLowerCase() === "true";
        const fixedModes = {
            always: { key: "always", label: "Sempre preparato", icon: "fa-star" },
            atwill: { key: "atwill", label: "A volontà", icon: "fa-infinity" },
            innate: { key: "innate", label: "Innato", icon: "fa-sparkles" },
            pact: { key: "pact", label: "Magia del patto", icon: "fa-moon" },
            ritual: { key: "ritual", label: "Rituale", icon: "fa-book-open" },
        };
        if (fixedModes[mode]) return fixedModes[mode];
        if (mode === "prepared" || rawPrepared !== undefined) {
            return prepared
                ? { key: "prepared", label: "Preparato", icon: "fa-circle-check" }
                : { key: "unprepared", label: "Non preparato", icon: "fa-circle" };
        }
        return null;
    }
    function getManagedEntryGroup(entry, kind) {
        if (kind === "spells") {
            const level = Math.max(0, Math.min(9, Number(entry.definition?.level ?? 0) || 0));
            return { key: `level-${level}`, label: level ? `Livello ${level}` : "Trucchetti", shortLabel: level ? String(level) : "0", order: level };
        }
        if (kind === "capabilities") {
            const activation = String(entry.definition?.activation?.type || "").toLowerCase();
            if (["action", "attack"].includes(activation)) return { key: "action", label: "Azioni", shortLabel: "Azioni", order: 1 };
            if (["bonus", "bonusaction"].includes(activation)) return { key: "bonus", label: "Azioni bonus", shortLabel: "Bonus", order: 2 };
            if (activation === "reaction") return { key: "reaction", label: "Reazioni", shortLabel: "Reazioni", order: 3 };
            if (["legendary", "lair"].includes(activation)) return { key: activation, label: activation === "legendary" ? "Azioni leggendarie" : "Azioni di tana", shortLabel: activation === "legendary" ? "Leggendarie" : "Tana", order: 4 };
            return { key: "passive", label: "Tratti e capacità passive", shortLabel: "Passive", order: 5 };
        }
        return { key: "inventory", label: "Oggetti", shortLabel: "Oggetti", order: 1 };
    }

    function normalizeManagedSearch(value) {
        return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }

    function setupManagedCollectionControls(root) {
        root.querySelectorAll("[data-managed-collection]").forEach((collection) => {
            const search = collection.querySelector("[data-managed-entry-search]");
            const buttons = Array.from(collection.querySelectorAll("[data-managed-entry-filter]"));
            const preparedOnlyButton = collection.querySelector("[data-managed-prepared-only]");
            const cards = Array.from(collection.querySelectorAll("[data-managed-entry-search-value]"));
            const groups = Array.from(collection.querySelectorAll("[data-managed-entry-group]"));
            const counter = collection.querySelector("[data-managed-visible-count]");
            let activeFilter = "all";
            let preparedOnly = false;
            const apply = () => {
                const query = normalizeManagedSearch(search?.value || "").trim();
                let visible = 0;
                cards.forEach((card) => {
                    const matchesText = !query || String(card.dataset.managedEntrySearchValue || "").includes(query);
                    const matchesFilter = activeFilter === "all" || card.dataset.managedEntryGroupKey === activeFilter;
                    const preparation = String(card.dataset.managedSpellPreparation || "");
                    const matchesPreparation = !preparedOnly || Boolean(preparation && preparation !== "unprepared");
                    card.hidden = !(matchesText && matchesFilter && matchesPreparation);
                    if (!card.hidden) visible += 1;
                });
                groups.forEach((group) => { group.hidden = !Array.from(group.querySelectorAll("[data-managed-entry-search-value]")).some((card) => !card.hidden); });
                if (counter) counter.textContent = String(visible);
                collection.classList.toggle("has-no-results", visible === 0);
            };
            search?.addEventListener("input", apply);
            buttons.forEach((button) => button.addEventListener("click", () => {
                activeFilter = String(button.dataset.managedEntryFilter || "all");
                buttons.forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
                apply();
            }));
            preparedOnlyButton?.addEventListener("click", () => {
                preparedOnly = !preparedOnly;
                preparedOnlyButton.classList.toggle("is-active", preparedOnly);
                preparedOnlyButton.setAttribute("aria-pressed", String(preparedOnly));
                collection.classList.toggle("is-prepared-only", preparedOnly);
                apply();
            });
        });
    }
    function setupManagedSectionNavigation(root) {
        const openSection = (id, scroll = false) => {
            const cleanId = String(id || "").replace(/^#/, "");
            if (!cleanId) return null;
            const target = root.querySelector(`#${CSS.escape(cleanId)}`);
            if (target instanceof HTMLDetailsElement) target.open = true;
            if (scroll && target) requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
            return target;
        };
        root.querySelectorAll('.managed-section-nav a[href^="#"]').forEach((link) => link.addEventListener("click", () => {
            openSection(link.getAttribute("href"));
        }));
        if (window.location.hash) {
            try { openSection(decodeURIComponent(window.location.hash), true); }
            catch (_) { openSection(window.location.hash, true); }
        }
    }

    function findManagedItemCommand(entry) {
        const commands = Array.isArray(currentDocument?.sync?.commands) ? currentDocument.sync.commands : [];
        return commands.find((command) => String(command.kind || "").startsWith("item.")
            && ((entry.transferId && command.target?.transferId === entry.transferId) || (!entry.transferId && entry.itemId && command.target?.itemId === entry.itemId))) || null;
    }

    function renderManagedItemSyncStatus(command) {
        return renderManagedEntitySyncStatus(command).replace('<div class="managed-item-sync', '<div data-managed-item-sync class="managed-item-sync');
    }

    function renderManagedItemEditor(entry, command) {
        const key = entry.transferId || entry.itemId || "";
        const usesPath = getManagedItemBaseValue(entry, "system.uses.spent") !== undefined
            ? "system.uses.spent"
            : (getManagedItemBaseValue(entry, "system.uses.value") !== undefined ? "system.uses.value" : "");
        const fields = [
            renderManagedItemControl(entry, command, "name", "Nome", "text"),
            renderManagedItemControl(entry, command, "system.quantity", "Quantità", "number"),
            renderManagedItemControl(entry, command, "system.level", "Livello", "number"),
            renderManagedItemControl(entry, command, "system.school", "Scuola", "text"),
            renderManagedItemControl(entry, command, "system.preparation.mode", "Preparazione", "text"),
            renderManagedItemControl(entry, command, "system.uses.max", "Utilizzi massimi", "number"),
            renderManagedItemControl(entry, command, "system.equipped", "Equipaggiato", "boolean"),
            renderManagedItemControl(entry, command, "system.attuned", "In sintonia", "boolean"),
            renderManagedItemControl(entry, command, "system.preparation.prepared", "Preparato", "boolean"),
            usesPath ? renderManagedItemControl(entry, command, usesPath, usesPath.endsWith("spent") ? "Utilizzi consumati" : "Utilizzi disponibili", "number") : ""
        ].filter(Boolean).join("");
        const description = getManagedItemDesiredValue(entry, command, "system.description.value");
        const mechanicalFields = [
            ["system.activation", "Attivazione"], ["system.range", "Gittata"], ["system.target", "Bersagli"],
            ["system.duration", "Durata"], ["system.attack", "Tiro per colpire"], ["system.damage", "Danni"],
            ["system.save", "Tiro salvezza e CD"], ["system.properties", "Proprietà e componenti"],
            ["system.materials", "Materiali"], ["system.recharge", "Ricarica"], ["system.activities", "Attività D&D5e"]
        ].map(([path, label]) => renderManagedItemJsonControl(entry, command, path, label)).filter(Boolean).join("");
        const guidedMechanics = renderManagedHumanMechanicsEditor(entry, command);
        return `<details class="managed-item-editor"><summary><span><i class="fas fa-pen"></i> Modifica elemento</span><i class="fas fa-chevron-down managed-editor-chevron" aria-hidden="true"></i></summary><div class="managed-item-form" data-managed-item-form="${escapeAttr(key)}" data-managed-item-id="${escapeAttr(entry.itemId || "")}" data-managed-transfer-id="${escapeAttr(entry.transferId || "")}"><div class="managed-item-fields">${fields}</div><div class="managed-item-icon-editor" ${currentCanManageActor ? "" : "hidden"}><div>${entry.media?.icon?.path ? `<img src="${escapeAttr(resolveMedia(entry.media.icon.path))}" alt="">` : `<i class="fas fa-image"></i>`}</div><label class="managed-file-field"><span>Icona elemento</span><input type="file" accept="image/*" data-managed-item-icon></label></div><label class="managed-item-description"><span>Descrizione</span><div class="managed-richtext-editor" contenteditable="true" spellcheck="true" data-managed-item-path="system.description.value" data-managed-item-type="richtext" data-managed-description-dirty="false">${buildManagedDescriptionEditorHtml(description ?? "")}</div><small>Incantesimi, riferimenti e tiri restano collegati a Foundry.</small></label>${guidedMechanics}<details class="managed-mechanics-editor managed-mechanics-advanced"><summary><span><i class="fas fa-code"></i> Avanzato e automazioni</span><i class="fas fa-chevron-down"></i></summary><p>Qui rimangono i dati completi di D&D5e, MidiQOL e degli altri moduli. Usali solo per campi non presenti nell’editor guidato.</p><div class="managed-mechanics-grid">${mechanicalFields}</div></details><div class="managed-item-actions"><span data-managed-item-result></span><button type="button" class="button-gold-outline managed-danger-action" data-managed-item-delete><i class="fas fa-trash"></i> Elimina</button><button type="button" class="button-gold-outline managed-primary-action" data-managed-item-save><i class="fas fa-cloud-arrow-up"></i> Invia a Foundry</button></div></div></details>`;
    }

    function renderManagedHumanMechanicsEditor(entry, command) {
        const object = (path, fallback = {}) => {
            const value = getManagedItemDesiredValue(entry, command, path);
            return value && typeof value === "object" ? value : fallback;
        };
        const activation = object("system.activation");
        const range = object("system.range");
        const target = object("system.target");
        const duration = object("system.duration");
        const attack = object("system.attack");
        const save = object("system.save");
        const damage = object("system.damage");
        const properties = object("system.properties", []);
        const materials = object("system.materials");
        const recharge = object("system.recharge");
        const activities = object("system.activities");
        const cards = [];
        if (getManagedItemBaseValue(entry, "system.activation") !== undefined) cards.push(renderManagedGuideCard("fa-bolt", "Attivazione", "Quando e quanto costa usare l’elemento.", [
            renderManagedGuidedSelect("system.activation", "type", "Tipo", activation.type || "action", [["action", "Azione"], ["bonus", "Azione bonus"], ["reaction", "Reazione"], ["minute", "Minuti"], ["hour", "Ore"], ["special", "Speciale"], ["none", "Nessuna"]]),
            renderManagedGuidedInput("system.activation", "value", "Costo", activation.value ?? 1, "number", { min: 0, step: 1 })
        ]));
        if (getManagedItemBaseValue(entry, "system.range") !== undefined) cards.push(renderManagedGuideCard("fa-location-crosshairs", "Gittata", "Distanza normale, portata e unità.", [
            renderManagedGuidedInput("system.range", "value", "Distanza", range.value ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedInput("system.range", "reach", "Portata", range.reach ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedSelect("system.range", "units", "Unità", range.units || "ft", [["self", "Personale"], ["touch", "Tocco"], ["ft", "Piedi"], ["mi", "Miglia"], ["m", "Metri"], ["km", "Chilometri"], ["spec", "Speciale"], ["any", "Qualsiasi"]])
        ]));
        if (getManagedItemBaseValue(entry, "system.target") !== undefined) cards.push(renderManagedGuideCard("fa-crosshairs", "Bersaglio", "Creatura, oggetto oppure area d’effetto.", [
            renderManagedGuidedInput("system.target", "value", "Numero", target.value ?? target.affects?.count ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedSelect("system.target", "type", "Tipo", target.type || "creature", [["creature", "Creatura"], ["ally", "Alleato"], ["enemy", "Nemico"], ["object", "Oggetto"], ["space", "Spazio"], ["self", "Sé stesso"], ["any", "Qualsiasi"]]),
            renderManagedGuidedSelect("system.target", "template.type", "Forma area", target.template?.type || "", [["", "Nessuna area"], ["sphere", "Sfera"], ["cone", "Cono"], ["cube", "Cubo"], ["cylinder", "Cilindro"], ["line", "Linea"], ["radius", "Raggio"], ["wall", "Muro"]]),
            renderManagedGuidedInput("system.target", "template.size", "Dimensione area", target.template?.size ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedSelect("system.target", "template.units", "Unità area", target.template?.units || target.units || "ft", [["ft", "Piedi"], ["m", "Metri"], ["mi", "Miglia"], ["km", "Chilometri"]])
        ]));
        if (getManagedItemBaseValue(entry, "system.duration") !== undefined) cards.push(renderManagedGuideCard("fa-hourglass-half", "Durata", "Durata dell’effetto e concentrazione.", [
            renderManagedGuidedInput("system.duration", "value", "Valore", duration.value ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedSelect("system.duration", "units", "Unità", duration.units || "inst", [["inst", "Istantanea"], ["turn", "Turni"], ["round", "Round"], ["minute", "Minuti"], ["hour", "Ore"], ["day", "Giorni"], ["month", "Mesi"], ["year", "Anni"], ["perm", "Permanente"], ["spec", "Speciale"]]),
            renderManagedGuidedToggle("system.duration", "concentration", "Richiede concentrazione", duration.concentration === true)
        ]));
        if (getManagedItemBaseValue(entry, "system.attack") !== undefined || getManagedItemBaseValue(entry, "system.save") !== undefined) cards.push(renderManagedGuideCard("fa-dice-d20", "Tiri e CD", "Caratteristica del tiro, bonus e tiro salvezza.", [
            renderManagedGuidedSelect("system.attack", "ability", "Caratteristica attacco", attack.ability || "", managedAbilityOptions("Automatica")),
            renderManagedGuidedInput("system.attack", "bonus", "Bonus attacco", attack.bonus ?? "", "text", { placeholder: "+2 oppure 1d4" }),
            renderManagedGuidedToggle("system.attack", "flat", "Bonus fisso", attack.flat === true),
            renderManagedGuidedSelect("system.save", "ability", "Tiro salvezza", save.ability || "", managedAbilityOptions("Nessuno")),
            renderManagedGuidedInput("system.save", "dc", "CD", save.dc ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedSelect("system.save", "scaling", "Calcolo CD", save.scaling || "", [["", "Valore manuale"], ["spellcasting", "Caratteristica magica"], ["flat", "Fissa"], ["str", "Forza"], ["dex", "Destrezza"], ["con", "Costituzione"], ["int", "Intelligenza"], ["wis", "Saggezza"], ["cha", "Carisma"]])
        ]));
        const damageEditor = getManagedItemBaseValue(entry, "system.damage") !== undefined ? renderManagedDamageGuide(damage) : "";
        const propertyEditor = getManagedItemBaseValue(entry, "system.properties") !== undefined ? renderManagedPropertyGuide(properties, entry.type) : "";
        const materialEditor = getManagedItemBaseValue(entry, "system.materials") !== undefined ? renderManagedGuideCard("fa-gem", "Materiali", "Componenti materiali, costo e consumo.", [
            renderManagedGuidedInput("system.materials", "value", "Descrizione materiale", materials.value ?? "", "text", { wide: true }),
            renderManagedGuidedInput("system.materials", "cost", "Costo", materials.cost ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedToggle("system.materials", "consumed", "Materiale consumato", materials.consumed === true)
        ]) : "";
        const rechargeEditor = getManagedItemBaseValue(entry, "system.recharge") !== undefined ? renderManagedGuideCard("fa-arrows-rotate", "Ricarica", "Soglia del dado e stato della ricarica.", [
            renderManagedGuidedInput("system.recharge", "value", "Si ricarica con", recharge.value ?? "", "number", { min: 1, max: 6, step: 1 }),
            renderManagedGuidedToggle("system.recharge", "charged", "Attualmente carico", recharge.charged !== false)
        ]) : "";
        const activitiesEditor = Object.keys(activities).length ? renderManagedActivitiesGuide(activities) : "";
        return `<section class="managed-guided-mechanics"><header><div><span class="managed-panel-eyebrow">Editor guidato</span><h4><i class="fas fa-sliders"></i> Meccaniche</h4></div><p>Modifica i valori principali senza toccare il JSON. Le automazioni avanzate restano conservate.</p></header><div class="managed-guided-grid">${cards.join("")}${damageEditor}${propertyEditor}${materialEditor}${rechargeEditor}</div>${activitiesEditor}</section>`;
    }

    function renderManagedGuideCard(icon, title, help, controls) {
        const content = controls.filter(Boolean).join("");
        if (!content) return "";
        return `<section class="managed-guide-card"><header><i class="fas ${icon}"></i><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(help)}</small></span></header><div class="managed-guide-fields">${content}</div></section>`;
    }

    function renderManagedGuidedInput(objectPath, key, label, value, type = "text", options = {}) {
        const attributes = type === "number" ? `${options.min !== undefined ? ` min="${options.min}"` : ""}${options.max !== undefined ? ` max="${options.max}"` : ""}${options.step !== undefined ? ` step="${options.step}"` : ""}` : "";
        const inputType = type === "list" ? "text" : type;
        return `<label class="managed-guide-field ${options.wide ? "is-wide" : ""}"><span>${escapeHtml(label)}</span><input type="${escapeAttr(inputType)}" value="${escapeAttr(value ?? "")}"${attributes}${options.placeholder ? ` placeholder="${escapeAttr(options.placeholder)}"` : ""} data-managed-guided-object="${escapeAttr(objectPath)}" data-managed-guided-key="${escapeAttr(key)}" data-managed-guided-type="${escapeAttr(type)}"></label>`;
    }

    function renderManagedGuidedSelect(objectPath, key, label, value, options) {
        const normalized = String(value ?? "");
        const values = Array.isArray(options) ? [...options] : [];
        if (normalized && !values.some(([candidate]) => String(candidate) === normalized)) values.unshift([normalized, formatManagedTraitValue(normalized)]);
        return `<label class="managed-guide-field"><span>${escapeHtml(label)}</span><select data-managed-guided-object="${escapeAttr(objectPath)}" data-managed-guided-key="${escapeAttr(key)}" data-managed-guided-type="text">${values.map(([candidate, text]) => `<option value="${escapeAttr(candidate)}" ${String(candidate) === normalized ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
    }

    function renderManagedGuidedToggle(objectPath, key, label, checked) {
        return `<label class="managed-guide-toggle"><input type="checkbox" ${checked ? "checked" : ""} data-managed-guided-object="${escapeAttr(objectPath)}" data-managed-guided-key="${escapeAttr(key)}" data-managed-guided-type="boolean"><span>${escapeHtml(label)}</span></label>`;
    }

    function managedAbilityOptions(emptyLabel) {
        return [["", emptyLabel], ["str", "Forza"], ["dex", "Destrezza"], ["con", "Costituzione"], ["int", "Intelligenza"], ["wis", "Saggezza"], ["cha", "Carisma"]];
    }

    function renderManagedDamageGuide(damage) {
        if (Array.isArray(damage.parts)) {
            const rows = damage.parts.map((part, index) => renderManagedDamagePartRow(index, part)).join("");
            return `<section class="managed-guide-card managed-guide-card--wide managed-damage-guide"><header><i class="fas fa-burst"></i><span><strong>Danni</strong><small>Formula e tipo di ogni componente del danno.</small></span></header><div class="managed-damage-parts" data-managed-damage-parts>${rows}</div><button type="button" class="managed-guide-add" data-managed-damage-add><i class="fas fa-plus"></i> Aggiungi danno</button></section>`;
        }
        const base = damage.base && typeof damage.base === "object" ? damage.base : {};
        return renderManagedGuideCard("fa-burst", "Danni", "Dadi base dell’arma o dell’attacco.", [
            renderManagedGuidedInput("system.damage", "base.number", "Numero dadi", base.number ?? "", "number", { min: 0, step: 1 }),
            renderManagedGuidedInput("system.damage", "base.denomination", "Dado", base.denomination ?? "", "number", { min: 2, step: 2 }),
            renderManagedGuidedInput("system.damage", "base.bonus", "Bonus", base.bonus ?? "", "text", { placeholder: "+4" }),
            renderManagedGuidedInput("system.damage", "base.types", "Tipi di danno", Array.isArray(base.types) ? base.types.join(", ") : "", "list", { placeholder: "necrotic, fire", wide: true })
        ]);
    }

    function renderManagedDamagePartRow(index, part = ["", ""]) {
        return `<div class="managed-damage-part" data-managed-damage-row><label><span>Formula</span><input type="text" value="${escapeAttr(part?.[0] || "")}" placeholder="8d6 + 4" data-managed-damage-formula></label><label><span>Tipo</span><select data-managed-damage-type>${managedDamageTypeOptions(part?.[1] || "")}</select></label><button type="button" title="Rimuovi questo danno" data-managed-damage-remove><i class="fas fa-xmark"></i></button></div>`;
    }

    function managedDamageTypeOptions(selected) {
        const options = [["", "Non specificato"], ["acid", "Acido"], ["bludgeoning", "Contundente"], ["cold", "Freddo"], ["fire", "Fuoco"], ["force", "Forza"], ["lightning", "Fulmine"], ["necrotic", "Necrotico"], ["piercing", "Perforante"], ["poison", "Veleno"], ["psychic", "Psichico"], ["radiant", "Radioso"], ["slashing", "Tagliente"], ["thunder", "Tuono"], ["healing", "Cura"]];
        if (selected && !options.some(([value]) => value === selected)) options.unshift([selected, formatManagedTraitValue(selected)]);
        return options.map(([value, label]) => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    }

    function renderManagedPropertyGuide(properties, itemType) {
        const selected = new Set(Array.isArray(properties) ? properties.map(String) : []);
        const common = itemType === "spell"
            ? [["vocal", "Verbale"], ["somatic", "Somatica"], ["material", "Materiale"], ["ritual", "Rituale"], ["mgc", "Magico"]]
            : [["mgc", "Magico"], ["fin", "Accurata"], ["hvy", "Pesante"], ["lgt", "Leggera"], ["rch", "Portata"], ["thr", "Lancio"], ["two", "Due mani"], ["ver", "Versatile"], ["amm", "Munizioni"], ["lod", "Caricamento"], ["spc", "Speciale"]];
        const unknown = Array.from(selected).filter((value) => !common.some(([candidate]) => candidate === value));
        return `<section class="managed-guide-card managed-guide-card--wide"><header><i class="fas fa-tags"></i><span><strong>${itemType === "spell" ? "Componenti e proprietà" : "Proprietà"}</strong><small>Seleziona tutte le caratteristiche applicabili.</small></span></header><div class="managed-property-chips" data-managed-guided-list="system.properties">${common.map(([value, label]) => `<label><input type="checkbox" value="${escapeAttr(value)}" ${selected.has(value) ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}</div>${unknown.length ? `<p class="managed-guide-note">Conservate anche: ${escapeHtml(unknown.join(", "))}</p>` : ""}</section>`;
    }

    function renderManagedActivitiesGuide(activities) {
        const labels = { attack: "Tiro per colpire", save: "Tiro salvezza", damage: "Danno", heal: "Cura", utility: "Utilità", check: "Prova", summon: "Evocazione", enchant: "Incantamento" };
        const cards = Object.entries(activities).map(([key, activity], index) => {
            const value = activity && typeof activity === "object" ? activity : {};
            const title = labels[value.type] || `Attività ${index + 1}`;
            return `<section class="managed-activity-guide"><header><span><b>${index + 1}</b><strong>${escapeHtml(title)}</strong></span><small>Dati specifici dell’attività Foundry</small></header><div class="managed-guide-fields">${renderManagedGuidedSelect("system.activities", `${key}.type`, "Tipo attività", value.type || "utility", [["attack", "Tiro per colpire"], ["save", "Tiro salvezza"], ["damage", "Danno"], ["heal", "Cura"], ["utility", "Utilità"], ["check", "Prova"], ["summon", "Evocazione"], ["enchant", "Incantamento"]])}${renderManagedGuidedSelect("system.activities", `${key}.activation.type`, "Attivazione", value.activation?.type || "action", [["action", "Azione"], ["bonus", "Azione bonus"], ["reaction", "Reazione"], ["special", "Speciale"], ["none", "Nessuna"]])}${renderManagedGuidedInput("system.activities", `${key}.activation.value`, "Costo", value.activation?.value ?? 1, "number", { min: 0, step: 1 })}${renderManagedGuidedSelect("system.activities", `${key}.attack.ability`, "Caratteristica attacco", value.attack?.ability || "", managedAbilityOptions("Automatica"))}${renderManagedGuidedSelect("system.activities", `${key}.damage.onSave`, "Danno con TS riuscito", value.damage?.onSave || "none", [["none", "Nessun danno"], ["half", "Metà danno"], ["full", "Danno completo"]])}</div></section>`;
        }).join("");
        return `<details class="managed-activities-guide"><summary><span><i class="fas fa-diagram-project"></i> Attività Foundry</span><b>${Object.keys(activities).length}</b><i class="fas fa-chevron-down"></i></summary><div>${cards}</div></details>`;
    }
    function renderManagedItemControl(entry, command, path, label, type) {
        const baseValue = getManagedItemBaseValue(entry, path);
        if (baseValue === undefined || baseValue === null) return "";
        const value = getManagedItemDesiredValue(entry, command, path);
        if (type === "boolean") return `<label class="managed-item-check"><input type="checkbox" data-managed-item-path="${escapeAttr(path)}" data-managed-item-type="boolean" ${value === true ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
        return `<label><span>${escapeHtml(label)}</span><input type="${type}" ${type === "number" ? 'min="0" step="1"' : ""} value="${escapeAttr(value ?? "")}" data-managed-item-path="${escapeAttr(path)}" data-managed-item-type="${escapeAttr(type)}"></label>`;
    }

    function renderManagedItemJsonControl(entry, command, path, label) {
        const baseValue = getManagedItemBaseValue(entry, path);
        if (baseValue === undefined || baseValue === null) return "";
        const value = getManagedItemDesiredValue(entry, command, path);
        return `<label class="managed-json-field"><span>${escapeHtml(label)}</span><textarea rows="7" spellcheck="false" data-managed-item-path="${escapeAttr(path)}" data-managed-item-type="json">${escapeHtml(JSON.stringify(value, null, 2))}</textarea></label>`;
    }

    function renderManagedItemCreator(title) {
        const options = title === "Incantesimi"
            ? [["spell", "Incantesimo"]]
            : title === "Inventario"
                ? [["equipment", "Equipaggiamento"], ["weapon", "Arma"], ["consumable", "Consumabile"], ["tool", "Strumento"], ["loot", "Bottino"], ["container", "Contenitore"]]
                : [["feat", "Capacità"], ["weapon", "Attacco/arma"]];
        const linkedIds = new Set((Array.isArray(currentDocument?.definition?.items) ? currentDocument.definition.items : []).map((entry) => String(entry.campaignItemId || "")).filter(Boolean));
        const catalogPicker = title === "Inventario" && campaignItemCatalog.length ? `
            <section class="managed-catalog-picker">
                <div class="managed-catalog-picker-heading">
                    <span class="managed-catalog-picker-icon"><i class="fas fa-vault"></i></span>
                    <div><strong>Aggiungi dal catalogo della campagna</strong><small>La copia resterà collegata all'oggetto canonico, mantenendo quantità e utilizzi propri.</small></div>
                </div>
                <div class="managed-catalog-picker-controls">
                    <label><span>Oggetto</span><select data-managed-catalog-select><option value="">Scegli un oggetto...</option>${campaignItemCatalog.map((item) => { const id = String(item.id || ""); const owned = linkedIds.has(id); const meta = [item.type, item.rarity].filter(Boolean).join(" · "); return `<option value="${escapeAttr(id)}" ${owned ? "disabled" : ""}>${escapeHtml(item.name || id)}${meta ? ` — ${escapeHtml(meta)}` : ""}${owned ? " (già presente)" : ""}</option>`; }).join("")}</select></label>
                    <button type="button" class="button-gold-outline managed-primary-action" data-managed-catalog-add><i class="fas fa-plus"></i> Aggiungi</button>
                </div>
                <span class="managed-catalog-picker-result" data-managed-catalog-result></span>
            </section>` : "";
        const customCreator = `<details class="managed-create-editor" data-managed-item-create-form><summary><span><i class="fas fa-plus"></i> Crea elemento personalizzato</span><i class="fas fa-chevron-down"></i></summary><div class="managed-create-form"><div class="managed-item-fields"><label><span>Nome</span><input type="text" value="Nuovo elemento" data-managed-item-create-field="name"></label><label><span>Tipo</span><select data-managed-item-create-field="type">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label><span>Livello</span><input type="number" min="0" max="20" step="1" value="0" data-managed-item-create-field="level"></label><label class="managed-file-field" ${currentCanManageActor ? "" : "hidden"}><span>Icona</span><input type="file" accept="image/*" data-managed-item-create-field="icon"></label></div><label class="managed-item-description"><span>Descrizione</span><textarea rows="4" data-managed-item-create-field="description"></textarea></label><label class="managed-json-field"><span>Dati system iniziali</span><textarea rows="5" spellcheck="false" data-managed-item-create-field="system">{}</textarea></label><div class="managed-item-actions"><span data-managed-item-create-result></span><button type="button" class="button-gold-outline managed-primary-action" data-managed-item-create><i class="fas fa-plus"></i> Crea in Foundry</button></div></div></details>`;
        return `${catalogPicker}${customCreator}`;
    }

    function getManagedItemDesiredValue(entry, command, path) {
        const patch = Array.isArray(command?.patches) ? command.patches.find((candidate) => candidate.path === path) : null;
        return patch ? patch.value : getManagedItemBaseValue(entry, path);
    }

    function getManagedItemBaseValue(entry, path) {
        const definition = entry.definition || {};
        const state = entry.state || {};
        if (path === "name") return entry.name || "";
        if (path === "img") return definition.img || "";
        if (path === "system.description.value") return definition.description || "";
        if (path === "system.quantity") return state.quantity ?? definition.quantity;
        if (path === "system.equipped") return state.equipped ?? definition.equipped;
        if (path === "system.attuned") return state.attuned ?? definition.attuned;
        if (path === "system.preparation.prepared") return state.prepared ?? definition.preparation?.prepared;
        if (path === "system.uses.value") return state.uses?.value;
        if (path === "system.uses.spent") return state.uses?.spent;
        if (path === "system.uses.max") return state.uses?.max ?? definition.uses?.max;
        const keys = String(path || "").replace(/^system\./, "").split(".").filter(Boolean);
        return keys.reduce((value, key) => value?.[key], definition);
    }
    function renderAdmin(actor) {
        return `<section id="managed-appearance" class="managed-panel managed-panel--admin" data-managed-admin>
            <header class="managed-panel-heading"><div><span class="managed-panel-eyebrow">Sito e Foundry</span><h2><i class="fas fa-sliders"></i> Aspetto condiviso</h2></div></header>
            <div class="managed-media-strip" aria-label="Immagini del personaggio">
                ${renderBaseMediaCircleEditor("avatar", actor.media?.avatar)}
                ${renderBaseMediaCircleEditor("token", actor.media?.token)}
                ${renderSiteCircleEditor("idle", actor.media?.idle, actor.media?.token || actor.media?.avatar)}
                ${renderSiteCircleEditor("hover", actor.media?.hover, actor.media?.idle || actor.media?.token || actor.media?.avatar)}
            </div>
        </section>`;
    }

    function renderManagedFrameCircleImageAttributes(descriptor, target = "") {
        const circle = normalizeManagedFrameCircle(descriptor);
        if (!circle) return "";
        return ` data-frame-circle="1" data-frame-circle-x="${circle.x}" data-frame-circle-y="${circle.y}" data-frame-circle-radius="${circle.radius}"${target ? ` data-frame-circle-target="${escapeAttr(target)}"` : ""}`;
    }

    function renderManagedFrameCircleControls(slot, descriptor) {
        const presentation = descriptor?.presentation || {};
        const circle = normalizeManagedFrameCircle(descriptor);
        const enabled = circle ? "1" : "0";
        return `
            <input type="hidden" value="${Number(presentation.x ?? 50)}" data-managed-adjust="${slot}:x">
            <input type="hidden" value="${Number(presentation.y ?? 50)}" data-managed-adjust="${slot}:y">
            <input type="hidden" value="${Number(presentation.scale ?? 1)}" data-managed-adjust="${slot}:scale">
            <input type="hidden" value="${enabled}" data-managed-frame-circle-enabled="${slot}">
            <input type="hidden" value="${circle?.x ?? .5}" data-managed-frame-circle="${slot}:x">
            <input type="hidden" value="${circle?.y ?? .5}" data-managed-frame-circle="${slot}:y">
            <input type="hidden" value="${circle?.radius ?? .42}" data-managed-frame-circle="${slot}:radius">
            <div class="managed-frame-circle-action">
                <button type="button" data-managed-frame-circle-open="${slot}" ${descriptor?.path ? "" : "disabled"}><i class="fas fa-circle-dot"></i><span>${circle ? "Modifica cerchio" : "Imposta cerchio"}</span></button>
                <small data-managed-frame-circle-state="${slot}" class="${circle ? "is-ready" : ""}">${circle ? "Condiviso" : "Non impostato"}</small>
            </div>`;
    }

    function renderBaseMediaCircleEditor(slot, descriptor) {
        const avatar = slot === "avatar";
        const label = avatar ? "Avatar" : "Token base";
        const help = avatar ? "Immagine grande del personaggio" : "Immagine usata sulla mappa";
        if (avatar) {
            return `<fieldset class="managed-base-media managed-base-media--${slot}" data-managed-media-drop="${slot}"><legend><i class="fas fa-image-portrait"></i> ${label}</legend><div class="managed-base-media-preview">${descriptor?.path ? renderImage(descriptor.path, label) : `<div class="managed-slot-placeholder"><i class="fas fa-image"></i><span>Nessuna immagine</span></div>`}<span>${escapeHtml(help)}</span></div><label class="managed-file-field"><span>Trascina qui o scegli</span><input type="file" accept="image/*" data-managed-file="${slot}"></label></fieldset>`;
        }
        const presentation = descriptor?.presentation || {};
        const path = descriptor?.path || "";
        return `<fieldset class="managed-base-media managed-base-media--${slot}" data-managed-media-drop="${slot}"><legend><i class="fas fa-chess-pawn"></i> ${label}</legend><div class="managed-slot-list-preview ${path ? "has-preview" : "is-empty"}"><div class="managed-slot-list-preview-frame is-idle" data-frame-circle-host><img ${path ? `src="${escapeAttr(resolveMedia(path))}"` : ""} alt="Anteprima ${label}" data-managed-list-adjust-image="${slot}"${renderManagedFrameCircleImageAttributes(descriptor)} style="${renderManagedListAdjustStyle(presentation)}"></div><span>Anteprima</span></div><label class="managed-file-field"><span>Trascina qui o scegli</span><input type="file" accept="image/*" data-managed-file="${slot}"></label>${renderManagedFrameCircleControls(slot, descriptor)}</fieldset>`;
    }

    function renderSiteCircleEditor(slot, descriptor, fallbackDescriptor = null) {
        const presentation = descriptor?.presentation || {};
        const label = slot === "idle" ? "Idle" : "Hover";
        const previewDescriptor = descriptor?.path ? descriptor : fallbackDescriptor;
        const previewPresentation = previewDescriptor?.presentation || presentation;
        const previewPath = previewDescriptor?.path || "";
        const previewClass = slot === "idle" ? "is-idle" : "is-hover";
        return `<fieldset class="managed-slot-editor ${descriptor ? "has-image" : ""}" data-managed-slot="${slot}" data-managed-media-drop="${slot}"><legend><i class="fas ${slot === "idle" ? "fa-person" : "fa-hand-pointer"}"></i> ${label}</legend><div class="managed-slot-list-preview ${previewPath ? "has-preview" : "is-empty"}"><div class="managed-slot-list-preview-frame ${previewClass}" data-frame-circle-host><img ${previewPath ? `src="${escapeAttr(resolveMedia(previewPath))}"` : ""} alt="Anteprima ${label}" data-managed-list-adjust-image="${slot}"${renderManagedFrameCircleImageAttributes(previewDescriptor)} style="${renderManagedListAdjustStyle(previewPresentation)}"></div><span>Anteprima</span></div><label class="managed-file-field"><span>Trascina qui o scegli</span><input type="file" accept="image/*" data-managed-file="${slot}"></label>${renderManagedFrameCircleControls(slot, descriptor)}${descriptor ? `<label class="managed-remove-field"><input type="checkbox" data-managed-remove="${slot}"><span>Rimuovi ${label}</span></label>` : ""}</fieldset>`;
    }
    function renderBaseMediaEditor(slot, descriptor) {
        const avatar = slot === "avatar";
        const label = avatar ? "Avatar" : "Token base";
        const help = avatar ? "Immagine grande del personaggio" : "Immagine usata sulla mappa";
        if (!avatar) {
            const presentation = descriptor?.presentation || {};
            const path = descriptor?.path || "";
            return `<fieldset class="managed-base-media managed-base-media--${slot}" data-managed-media-drop="${slot}"><legend><i class="fas fa-chess-pawn"></i> ${label}</legend><div class="managed-slot-list-preview ${path ? "has-preview" : "is-empty"}"><div class="managed-slot-list-preview-frame is-idle"><img ${path ? `src="${escapeAttr(resolveMedia(path))}"` : ""} alt="Anteprima lista ${label}" data-managed-list-adjust-image="${slot}" style="${renderManagedListAdjustStyle(presentation)}"></div><span>Lista NPC</span></div><label class="managed-file-field"><span>Trascina qui o scegli</span><input type="file" accept="image/*" data-managed-file="${slot}"></label><div class="managed-adjust-heading"><i class="fas fa-sliders"></i> Regola nella lista</div><div class="managed-adjust-grid"><label><span>X</span><input type="number" min="0" max="100" step="1" value="${Number(presentation.x ?? 50)}" data-managed-adjust="${slot}:x"></label><label><span>Y</span><input type="number" min="0" max="100" step="1" value="${Number(presentation.y ?? 50)}" data-managed-adjust="${slot}:y"></label><label><span>Scala</span><input type="number" min="0.5" max="3" step="0.05" value="${Number(presentation.scale ?? 1)}" data-managed-adjust="${slot}:scale"></label></div></fieldset>`;
        }
        return `<fieldset class="managed-base-media managed-base-media--${slot}" data-managed-media-drop="${slot}"><legend><i class="fas ${avatar ? "fa-image-portrait" : "fa-chess-pawn"}"></i> ${label}</legend><div class="managed-base-media-preview">${descriptor?.path ? renderImage(descriptor.path, label) : `<div class="managed-slot-placeholder"><i class="fas fa-image"></i><span>Nessuna immagine</span></div>`}<span>${escapeHtml(help)}</span></div><label class="managed-file-field"><span>Trascina qui o scegli</span><input type="file" accept="image/*" data-managed-file="${slot}"></label></fieldset>`;
    }

    function renderSiteSlotEditor(slot, descriptor, fallbackDescriptor = null) {
        const presentation = descriptor?.presentation || {};
        const label = slot === "idle" ? "Idle" : "Hover";
        const previewDescriptor = descriptor?.path ? descriptor : fallbackDescriptor;
        const previewPath = previewDescriptor?.path || "";
        const previewClass = slot === "idle" ? "is-idle" : "is-hover";
        return `<fieldset class="managed-slot-editor ${descriptor ? "has-image" : ""}" data-managed-slot="${slot}" data-managed-media-drop="${slot}"><legend><i class="fas ${slot === "idle" ? "fa-person" : "fa-hand-pointer"}"></i> ${label}</legend><div class="managed-slot-list-preview ${previewPath ? "has-preview" : "is-empty"}"><div class="managed-slot-list-preview-frame ${previewClass}"><img ${previewPath ? `src="${escapeAttr(resolveMedia(previewPath))}"` : ""} alt="Anteprima lista ${label}" data-managed-list-adjust-image="${slot}" style="${renderManagedListAdjustStyle(presentation)}"></div><span>Lista NPC</span></div><label class="managed-file-field"><span>Trascina qui o scegli</span><input type="file" accept="image/*" data-managed-file="${slot}"></label><div class="managed-adjust-heading"><i class="fas fa-sliders"></i> Regola nella lista</div><div class="managed-adjust-grid"><label><span>X</span><input type="number" min="0" max="100" step="1" value="${Number(presentation.x ?? 50)}" data-managed-adjust="${slot}:x"></label><label><span>Y</span><input type="number" min="0" max="100" step="1" value="${Number(presentation.y ?? 50)}" data-managed-adjust="${slot}:y"></label><label><span>Scala</span><input type="number" min="0.5" max="3" step="0.05" value="${Number(presentation.scale ?? 1)}" data-managed-adjust="${slot}:scale"></label></div>${descriptor ? `<label class="managed-remove-field"><input type="checkbox" data-managed-remove="${slot}"><span>Rimuovi ${label}</span></label>` : ""}</fieldset>`;
    }

    function renderManagedListAdjustStyle(presentation = {}) {
        const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const x = Math.min(100, Math.max(0, finiteOr(presentation.x, 50)));
        const y = Math.min(100, Math.max(0, finiteOr(presentation.y, 50)));
        const scale = Math.min(3, Math.max(.5, finiteOr(presentation.scale, 1)));
        return `--managed-list-x:${Math.round((x - 50) * 2)}px;--managed-list-y:${Math.round((y - 50) * 2)}px;--managed-list-scale:${scale};`;
    }

    function setupManagedListAdjustPreviews(root) {
        root.querySelectorAll("[data-managed-adjust]").forEach((control) => {
            const parts = String(control.dataset.managedAdjust || "").split(":");
            const slot = parts[0];
            if (!["token", "idle", "hover"].includes(slot)) return;
            const sync = () => {
                const image = root.querySelector(`[data-managed-list-adjust-image="${slot}"]`);
                if (!image) return;
                image.setAttribute("style", renderManagedListAdjustStyle({
                    x: readAdjust(root, slot, "x", 50),
                    y: readAdjust(root, slot, "y", 50),
                    scale: readAdjust(root, slot, "scale", 1)
                }));
            };
            control.addEventListener("input", sync);
            control.addEventListener("change", sync);
            sync();
        });
    }

    function renderManagedFrameCircleDialog() {
        return `<div class="managed-frame-circle-dialog" data-managed-frame-circle-dialog hidden role="dialog" aria-modal="true" aria-labelledby="managed-frame-circle-title">
            <button type="button" class="managed-frame-circle-backdrop" data-managed-frame-circle-close aria-label="Chiudi"></button>
            <section class="managed-frame-circle-shell">
                <header><span><small>Inquadratura condivisa</small><strong id="managed-frame-circle-title" data-managed-frame-circle-title>Regola cerchio</strong></span><button type="button" data-managed-frame-circle-close aria-label="Chiudi"><i class="fas fa-xmark"></i></button></header>
                <div class="managed-frame-circle-body">
                    <div class="managed-frame-circle-stage" data-managed-frame-circle-stage>
                        <img data-managed-frame-circle-source src="" alt="">
                        <span class="managed-frame-circle-overlay" data-managed-frame-circle-overlay tabindex="0" role="application" aria-label="Trascina il cerchio; usa il bordo per cambiarne il raggio"><i></i></span>
                    </div>
                    <aside>
                        <div class="managed-frame-circle-preview" data-frame-circle-host><img data-managed-frame-circle-preview src="" alt="Anteprima"></div>
                        <output data-managed-frame-circle-output>Centro 50% - Raggio 42%</output>
                        <label><span>Raggio</span><input type="range" min="0.03" max="0.5" step="0.005" value="0.42" data-managed-frame-circle-radius></label>
                        <div class="managed-frame-circle-tools">
                            <button type="button" data-managed-frame-circle-smaller aria-label="Riduci cerchio"><i class="fas fa-minus"></i></button>
                            <button type="button" data-managed-frame-circle-reset>Centra</button>
                            <button type="button" data-managed-frame-circle-larger aria-label="Ingrandisci cerchio"><i class="fas fa-plus"></i></button>
                        </div>
                    </aside>
                </div>
                <footer><span>Trascina il cerchio. Afferra il punto sul bordo per ridimensionarlo.</span><div><button type="button" data-managed-frame-circle-close>Annulla</button><button type="button" class="managed-frame-circle-apply" data-managed-frame-circle-apply><i class="fas fa-check"></i> Applica</button></div></footer>
            </section>
        </div>`;
    }

    function readManagedFrameCircle(root, slot) {
        if (root.querySelector(`[data-managed-frame-circle-enabled="${slot}"]`)?.value !== "1") return null;
        return window.CriptaImageAdjust?.normalizeFrameCircle?.({
            x: root.querySelector(`[data-managed-frame-circle="${slot}:x"]`)?.value,
            y: root.querySelector(`[data-managed-frame-circle="${slot}:y"]`)?.value,
            radius: root.querySelector(`[data-managed-frame-circle="${slot}:radius"]`)?.value
        }) || null;
    }

    function managedFrameCirclesEqual(left, right) {
        const a = window.CriptaImageAdjust?.normalizeFrameCircle?.(left);
        const b = window.CriptaImageAdjust?.normalizeFrameCircle?.(right);
        if (!a || !b) return a === b;
        return ["x", "y", "radius"].every((key) => Math.abs(a[key] - b[key]) < .000001);
    }

    function setupManagedFrameCircleEditor(root) {
        const dialog = root.querySelector("[data-managed-frame-circle-dialog]");
        if (!dialog) return;
        document.body.appendChild(dialog);
        const stage = dialog.querySelector("[data-managed-frame-circle-stage]");
        const source = dialog.querySelector("[data-managed-frame-circle-source]");
        const overlay = dialog.querySelector("[data-managed-frame-circle-overlay]");
        const preview = dialog.querySelector("[data-managed-frame-circle-preview]");
        const radius = dialog.querySelector("[data-managed-frame-circle-radius]");
        const output = dialog.querySelector("[data-managed-frame-circle-output]");
        const title = dialog.querySelector("[data-managed-frame-circle-title]");
        let state = null;
        let pointer = null;
        let previousFocus = null;

        const constrain = (circle) => {
            if (!source.naturalWidth || !source.naturalHeight) return circle;
            const minDimension = Math.min(source.naturalWidth, source.naturalHeight);
            let next = window.CriptaImageAdjust.normalizeFrameCircle(circle) || { x: .5, y: .5, radius: .42 };
            const horizontal = next.radius * minDimension / source.naturalWidth;
            const vertical = next.radius * minDimension / source.naturalHeight;
            next.x = Math.max(horizontal, Math.min(1 - horizontal, next.x));
            next.y = Math.max(vertical, Math.min(1 - vertical, next.y));
            return next;
        };

        const constrainRadius = (circle) => {
            if (!source.naturalWidth || !source.naturalHeight) return circle;
            const minDimension = Math.min(source.naturalWidth, source.naturalHeight);
            let next = window.CriptaImageAdjust.normalizeFrameCircle(circle) || { x: .5, y: .5, radius: .42 };
            const maxRadius = Math.min(
                next.x * source.naturalWidth,
                (1 - next.x) * source.naturalWidth,
                next.y * source.naturalHeight,
                (1 - next.y) * source.naturalHeight
            ) / minDimension;
            next.radius = Math.max(.03, Math.min(next.radius, maxRadius, .5));
            return next;
        };

        const imageRect = () => {
            const stageRect = stage.getBoundingClientRect();
            const sourceRect = source.getBoundingClientRect();
            if (!sourceRect.width || !sourceRect.height || !source.naturalWidth || !source.naturalHeight) return null;
            const stageStyle = getComputedStyle(stage);
            const originLeft = stageRect.left + (parseFloat(stageStyle.borderLeftWidth) || 0);
            const originTop = stageRect.top + (parseFloat(stageStyle.borderTopWidth) || 0);
            const scale = Math.min(sourceRect.width / source.naturalWidth, sourceRect.height / source.naturalHeight);
            const width = source.naturalWidth * scale;
            const height = source.naturalHeight * scale;
            return { left: sourceRect.left - originLeft + (sourceRect.width - width) / 2, top: sourceRect.top - originTop + (sourceRect.height - height) / 2, width, height, scale };
        };

        const paint = () => {
            if (!state) return;
            state.circle = constrain(state.circle);
            const rect = imageRect();
            if (!rect) return;
            const naturalMin = Math.min(source.naturalWidth, source.naturalHeight);
            const radiusPixels = state.circle.radius * naturalMin * rect.scale;
            const centerX = rect.left + state.circle.x * rect.width;
            const centerY = rect.top + state.circle.y * rect.height;
            overlay.style.width = `${radiusPixels * 2}px`;
            overlay.style.height = `${radiusPixels * 2}px`;
            overlay.style.left = `${centerX - radiusPixels}px`;
            overlay.style.top = `${centerY - radiusPixels}px`;
            radius.value = String(state.circle.radius);
            output.textContent = `Centro ${Math.round(state.circle.x * 100)}%, ${Math.round(state.circle.y * 100)}% - Raggio ${Math.round(state.circle.radius * 100)}%`;
            preview.src = source.src;
            window.CriptaImageAdjust.setFrameCircleDataset(preview, state.circle);
            requestAnimationFrame(() => window.CriptaImageAdjust.applyFrameCircleLayout(preview));
        };

        const pointToCircle = (event) => {
            const stageRect = stage.getBoundingClientRect();
            const stageStyle = getComputedStyle(stage);
            const originLeft = stageRect.left + (parseFloat(stageStyle.borderLeftWidth) || 0);
            const originTop = stageRect.top + (parseFloat(stageStyle.borderTopWidth) || 0);
            const rect = imageRect();
            if (!rect) return null;
            return {
                x: (event.clientX - originLeft - rect.left) / rect.width,
                y: (event.clientY - originTop - rect.top) / rect.height,
                rect,
                originLeft,
                originTop
            };
        };

        const beginPointer = (event, mode) => {
            if (!state || event.button > 0) return;
            event.preventDefault();
            event.stopPropagation();
            pointer = { id: event.pointerId, mode };
            stage.setPointerCapture?.(event.pointerId);
            if (mode === "drag") {
                const point = pointToCircle(event);
                if (point) state.circle = constrain({ ...state.circle, x: point.x, y: point.y });
                paint();
            }
        };

        overlay.addEventListener("pointerdown", (event) => beginPointer(event, event.target.closest("i") ? "resize" : "drag"));
        stage.addEventListener("pointerdown", (event) => {
            if (event.target.closest("[data-managed-frame-circle-overlay]")) return;
            beginPointer(event, "drag");
        });
        stage.addEventListener("pointermove", (event) => {
            if (!pointer || pointer.id !== event.pointerId || !state) return;
            event.preventDefault();
            const point = pointToCircle(event);
            if (!point) return;
            if (pointer.mode === "drag") {
                state.circle = constrain({ ...state.circle, x: point.x, y: point.y });
            } else {
                const centerX = point.rect.left + state.circle.x * point.rect.width;
                const centerY = point.rect.top + state.circle.y * point.rect.height;
                const localX = event.clientX - point.originLeft;
                const localY = event.clientY - point.originTop;
                const naturalMin = Math.min(source.naturalWidth, source.naturalHeight);
                state.circle = constrainRadius({ ...state.circle, radius: Math.hypot(localX - centerX, localY - centerY) / (naturalMin * point.rect.scale) });
            }
            paint();
        });
        const endPointer = (event) => {
            if (!pointer || pointer.id !== event.pointerId) return;
            stage.releasePointerCapture?.(event.pointerId);
            pointer = null;
        };
        stage.addEventListener("pointerup", endPointer);
        stage.addEventListener("pointercancel", endPointer);

        radius.addEventListener("input", (event) => {
            event.stopPropagation();
            if (!state) return;
            state.circle = constrainRadius({ ...state.circle, radius: Number(radius.value) });
            paint();
        });
        overlay.addEventListener("keydown", (event) => {
            if (!state) return;
            const rect = imageRect();
            if (!rect) return;
            const pixels = event.shiftKey ? 10 : 1;
            const stepX = pixels / rect.width;
            const stepY = pixels / rect.height;
            const movement = { ArrowLeft: [-stepX, 0], ArrowRight: [stepX, 0], ArrowUp: [0, -stepY], ArrowDown: [0, stepY] }[event.key];
            if (!movement) return;
            event.preventDefault();
            state.circle = constrain({ ...state.circle, x: state.circle.x + movement[0], y: state.circle.y + movement[1] });
            paint();
        });
        dialog.querySelector("[data-managed-frame-circle-smaller]")?.addEventListener("click", () => {
            if (!state) return;
            state.circle = constrainRadius({ ...state.circle, radius: state.circle.radius - .025 });
            paint();
        });
        dialog.querySelector("[data-managed-frame-circle-larger]")?.addEventListener("click", () => {
            if (!state) return;
            state.circle = constrainRadius({ ...state.circle, radius: state.circle.radius + .025 });
            paint();
        });
        dialog.querySelector("[data-managed-frame-circle-reset]")?.addEventListener("click", () => {
            if (!state) return;
            state.circle = constrain({ x: .5, y: .5, radius: .42 });
            paint();
        });

        const close = () => {
            dialog.hidden = true;
            document.body.classList.remove("managed-frame-circle-open");
            state = null;
            pointer = null;
            previousFocus?.focus?.();
        };
        dialog.querySelectorAll("[data-managed-frame-circle-close]").forEach((button) => button.addEventListener("click", close));
        dialog.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                close();
            }
        });
        dialog.querySelector("[data-managed-frame-circle-apply]")?.addEventListener("click", () => {
            if (!state) return;
            const circle = constrain(state.circle);
            root.querySelector(`[data-managed-frame-circle-enabled="${state.slot}"]`).value = "1";
            ["x", "y", "radius"].forEach((key) => {
                root.querySelector(`[data-managed-frame-circle="${state.slot}:${key}"]`).value = String(circle[key]);
            });
            const image = root.querySelector(`[data-managed-list-adjust-image="${state.slot}"]`);
            if (image) {
                window.CriptaImageAdjust.setFrameCircleDataset(image, circle);
                window.CriptaImageAdjust.applyFrameCircleLayout(image);
            }
            const button = root.querySelector(`[data-managed-frame-circle-open="${state.slot}"]`);
            if (button) {
                button.classList.add("is-ready");
                button.querySelector("span").textContent = "Modifica cerchio";
            }
            const status = root.querySelector(`[data-managed-frame-circle-state="${state.slot}"]`);
            if (status) {
                status.classList.add("is-ready");
                status.textContent = "Condiviso";
            }
            root.dataset.managedDirty = "true";
            close();
        });

        root.querySelectorAll("[data-managed-frame-circle-open]").forEach((button) => button.addEventListener("click", async () => {
            const slot = String(button.dataset.managedFrameCircleOpen || "");
            const image = root.querySelector(`[data-managed-list-adjust-image="${slot}"]`);
            const src = String(image?.currentSrc || image?.src || "").trim();
            if (!slot || !src) return;
            previousFocus = button;
            source.src = src;
            preview.src = src;
            try { await source.decode(); } catch (_) { /* load event below handles cached failures */ }
            if (!source.naturalWidth) return;
            state = { slot, circle: readManagedFrameCircle(root, slot) || { x: .5, y: .5, radius: .42 } };
            title.textContent = `Regola ${slot === "token" ? "Token" : slot === "idle" ? "Idle" : "Hover"}`;
            dialog.hidden = false;
            document.body.classList.add("managed-frame-circle-open");
            requestAnimationFrame(() => {
                paint();
                overlay.focus({ preventScroll: true });
            });
        }));
        dialog._managedFrameCircleResizeHandler = () => {
            if (!dialog.hidden && state) paint();
        };
        window.addEventListener("resize", dialog._managedFrameCircleResizeHandler);
        if (typeof ResizeObserver === "function") {
            dialog._managedFrameCircleResizeObserver = new ResizeObserver(() => {
                if (!dialog.hidden && state) paint();
            });
            dialog._managedFrameCircleResizeObserver.observe(stage);
        }
    }
    async function enqueueManagedItemUpdate(button) {
        const form = button.closest("[data-managed-item-form]");
        if (!form || !currentDocument) return;
        const transferId = String(form.dataset.managedTransferId || "");
        const itemId = String(form.dataset.managedItemId || "");
        const entry = findCurrentManagedItem(transferId, itemId);
        const existingCommand = entry ? findManagedItemCommand(entry) : null;
        if (!entry) return;
        const result = form.querySelector("[data-managed-item-result]");
        const token = getToken();
        if (!token) return;
        button.disabled = true;
        result.textContent = "Preparazione...";
        try {
            const patches = [];
            for (const control of form.querySelectorAll("[data-managed-item-path]")) {
                const path = String(control.dataset.managedItemPath || "");
                const type = String(control.dataset.managedItemType || "text");
                const snapshotValue = getManagedItemBaseValue(entry, path);
                const commandPatch = (Array.isArray(existingCommand?.patches) ? existingCommand.patches : []).find((patch) => patch.path === path);
                const hasConflictValue = existingCommand?.current && Object.prototype.hasOwnProperty.call(existingCommand.current, path);
                const baseValue = hasConflictValue ? existingCommand.current[path] : commandPatch ? commandPatch.baseValue : snapshotValue;
                let value;
                if (type === "boolean") value = control.checked;
                else if (type === "number") value = Number(control.value);
                else if (type === "json") value = parseManagedJson(control.value, path);
                else if (type === "richtext") value = control.dataset.managedDescriptionDirty === "true" ? serializeManagedDescriptionEditor(control) : getManagedItemDesiredValue(entry, existingCommand, path);
                else value = control.value;
                const retrying = ["conflict", "failed"].includes(existingCommand?.status) && Boolean(commandPatch);
                if (!sameManagedFormValue(value, snapshotValue) || retrying) patches.push({ path, value, baseValue });
            }
            const iconFile = form.querySelector("[data-managed-item-icon]")?.files?.[0];
            if (iconFile) {
                const revision = Number(entry.media?.icon?.revision || 0) + 1;
                const iconPath = await uploadManagedItemIcon(iconFile, transferId || itemId, revision, token);
                patches.push({ path: "img", value: iconPath, baseValue: getManagedItemBaseValue(entry, "img") || null });
            }
            if (!patches.length) {
                result.textContent = "Nessuna modifica da inviare.";
                return;
            }
            if (patches.some((patch) => patch.path === "name" && !String(patch.value || "").trim())) throw new Error("Il nome non può essere vuoto.");
            const response = await postManagedActorCommand({ kind: "item.update", target: { transferId, itemId }, patches }, token);
            rememberManagedCommand(response.command, (command) => String(command.kind || "").startsWith("item.") && managedCommandTargetsItem(command, transferId, itemId));
            result.textContent = "Modifica in attesa di Foundry.";
            updateManagedCardStatus(form.closest("[data-managed-item-card]"), response.command);
        } catch (error) {
            console.error("Accodamento modifica elemento fallito", error);
            result.textContent = error.message || "Modifica non accodata.";
        } finally {
            button.disabled = false;
        }
    }

    async function enqueueManagedItemDelete(button) {
        const form = button.closest("[data-managed-item-form]");
        const transferId = String(form?.dataset.managedTransferId || "");
        const itemId = String(form?.dataset.managedItemId || "");
        const entry = findCurrentManagedItem(transferId, itemId);
        if (!form || !entry || !window.confirm(`Eliminare ${entry.name || "questo elemento"} anche da Foundry?`)) return;
        const result = form.querySelector("[data-managed-item-result]");
        const token = getToken();
        if (!token) return;
        button.disabled = true;
        try {
            const response = await postManagedActorCommand({ kind: "item.delete", target: { transferId, itemId } }, token);
            rememberManagedCommand(response.command, (command) => String(command.kind || "").startsWith("item.") && managedCommandTargetsItem(command, transferId, itemId));
            result.textContent = "Eliminazione in attesa di Foundry.";
            updateManagedCardStatus(form.closest("[data-managed-item-card]"), response.command);
        } catch (error) {
            result.textContent = error.message || "Eliminazione non accodata.";
        } finally {
            button.disabled = false;
        }
    }

    async function enqueueManagedCatalogItem(button) {
        const picker = button.closest(".managed-catalog-picker");
        const select = picker?.querySelector("[data-managed-catalog-select]");
        const result = picker?.querySelector("[data-managed-catalog-result]");
        const campaignItemId = String(select?.value || "");
        const catalogItem = campaignItemCatalog.find((item) => String(item.id || "") === campaignItemId);
        const token = getToken();
        if (!picker || !select || !result || !token || !catalogItem) {
            if (result) result.textContent = "Scegli un oggetto dal catalogo.";
            return;
        }
        button.disabled = true;
        try {
            const canonical = catalogItem.foundry?.document && typeof catalogItem.foundry.document === "object"
                ? structuredCloneManaged(catalogItem.foundry.document)
                : buildManagedCatalogFallback(catalogItem);
            const transferId = `item-${crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
            const response = await postManagedActorCommand({
                kind: "item.create",
                target: { transferId },
                document: {
                    campaignItemId,
                    name: canonical.name || catalogItem.name || "Oggetto di campagna",
                    type: canonical.type || "equipment",
                    img: canonical.img || catalogItem.image || "",
                    system: canonical.system || {},
                    effects: Array.isArray(canonical.effects) ? canonical.effects : [],
                    transferId
                }
            }, token);
            rememberManagedCommand(response.command, () => false);
            select.disabled = true;
            result.textContent = `${catalogItem.name || "Oggetto"} sarà aggiunto da Foundry.`;
        } catch (error) {
            console.error("Aggiunta oggetto dal catalogo fallita", error);
            result.textContent = error.message || "Aggiunta non accodata.";
        } finally {
            button.disabled = false;
        }
    }

    function buildManagedCatalogFallback(item) {
        const type = String(item?.foundryType || "equipment");
        const description = [item?.summary ? `<p>${escapeHtml(item.summary)}</p>` : "", ...(Array.isArray(item?.properties) ? item.properties : []).map((property) => `${property?.name ? `<h3>${escapeHtml(property.name)}</h3>` : ""}${property?.description ? `<p>${escapeHtml(property.description)}</p>` : ""}`)].join("");
        return {
            name: String(item?.name || "Oggetto di campagna"),
            type,
            img: String(item?.image || ""),
            system: {
                description: { value: description, unidentified: String(item?.unidentifiedDescription || ""), chat: "" },
                quantity: 1,
                rarity: String(item?.rarity || ""),
                identified: item?.unidentified !== true,
                attunement: item?.attunement === true ? "required" : "",
                attuned: false
            },
            effects: []
        };
    }

    function structuredCloneManaged(value) {
        if (typeof structuredClone === "function") return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }
    async function enqueueManagedItemCreate(button) {
        const form = button.closest("[data-managed-item-create-form]");
        const result = form?.querySelector("[data-managed-item-create-result]");
        const token = getToken();
        if (!form || !result || !token || !currentDocument) return;
        if (form.dataset.managedPendingCreate === "true") return;
        button.disabled = true;
        try {
            const read = (field) => form.querySelector(`[data-managed-item-create-field="${field}"]`);
            const name = String(read("name")?.value || "").trim();
            const type = String(read("type")?.value || "feat");
            if (!name) throw new Error("Inserisci un nome.");
            const transferId = `item-${crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
            const system = parseManagedJson(read("system")?.value || "{}", "Dati system");
            const description = String(read("description")?.value || "").trim();
            const level = Number(read("level")?.value || 0);
            if (description) system.description = { ...(system.description || {}), value: description };
            if (type === "spell") system.level = Math.max(0, Math.min(9, level));
            const iconFile = read("icon")?.files?.[0];
            const img = iconFile ? await uploadManagedItemIcon(iconFile, transferId, 1, token) : "";
            const response = await postManagedActorCommand({ kind: "item.create", target: { transferId }, document: { name, type, img, system, transferId } }, token);
            rememberManagedCommand(response.command, () => false);
            form.dataset.managedPendingCreate = "true";
            result.textContent = `Creazione di ${name} in attesa di Foundry.`;
        } catch (error) {
            console.error("Creazione elemento Managed Actor fallita", error);
            result.textContent = error.message || "Creazione non accodata.";
        } finally {
            button.disabled = form.dataset.managedPendingCreate === "true";
        }
    }

    async function enqueueManagedEffectUpdate(button) {
        const form = button.closest("[data-managed-effect-form]");
        const result = form?.querySelector("[data-managed-effect-result]");
        if (!form || !result) return;
        const effectId = String(form.dataset.managedEffectId || "");
        const clientId = String(form.dataset.managedEffectClientId || "");
        const effect = findCurrentManagedEffect(effectId, clientId);
        const existingCommand = effect ? findManagedEffectCommand(effect) : null;
        const patches = [];
        try {
            if (!effect) throw new Error("Effetto non più disponibile: ricarica la pagina.");
            for (const control of form.querySelectorAll("[data-managed-effect-path]")) {
                const path = String(control.dataset.managedEffectPath || "");
                const type = String(control.dataset.managedEffectType || "text");
                const snapshotValue = getManagedEffectBaseValue(effect, path);
                const commandPatch = (Array.isArray(existingCommand?.patches) ? existingCommand.patches : []).find((patch) => patch.path === path);
                const hasConflictValue = existingCommand?.current && Object.prototype.hasOwnProperty.call(existingCommand.current, path);
                const baseValue = hasConflictValue ? existingCommand.current[path] : commandPatch ? commandPatch.baseValue : snapshotValue;
                const value = type === "boolean" ? control.checked : type === "json" ? parseManagedJson(control.value, path) : type === "list" ? String(control.value || "").split(",").map((entry) => entry.trim()).filter(Boolean) : control.value;
                const retrying = ["conflict", "failed"].includes(existingCommand?.status) && Boolean(commandPatch);
                if (!sameManagedFormValue(value, snapshotValue) || retrying) patches.push({ path, value, baseValue });
            }
            if (!patches.length) throw new Error("Nessuna modifica da inviare.");
            const token = getToken();
            const response = await postManagedActorCommand({ kind: "effect.update", target: { effectId, clientId }, patches }, token);
            rememberManagedCommand(response.command, (command) => managedCommandTargetsEffect(command, effectId, clientId));
            result.textContent = "Modifica in attesa di Foundry.";
        } catch (error) {
            result.textContent = error.message || "Modifica non accodata.";
        }
    }

    async function enqueueManagedEffectDelete(button) {
        const form = button.closest("[data-managed-effect-form]");
        const effectId = String(form?.dataset.managedEffectId || "");
        const clientId = String(form?.dataset.managedEffectClientId || "");
        if (!form || !window.confirm("Eliminare questo effetto anche da Foundry?")) return;
        const result = form.querySelector("[data-managed-effect-result]");
        try {
            const response = await postManagedActorCommand({ kind: "effect.delete", target: { effectId, clientId } }, getToken());
            rememberManagedCommand(response.command, (command) => managedCommandTargetsEffect(command, effectId, clientId));
            result.textContent = "Eliminazione in attesa di Foundry.";
        } catch (error) {
            result.textContent = error.message || "Eliminazione non accodata.";
        }
    }

    async function enqueueManagedEffectCreate(button) {
        const form = button.closest("[data-managed-effect-create-form]");
        const result = form?.querySelector("[data-managed-effect-create-result]");
        if (!form || !result) return;
        if (form.dataset.managedPendingCreate === "true") return;
        button.disabled = true;
        try {
            const read = (field) => form.querySelector(`[data-managed-effect-create-field="${field}"]`);
            const name = String(read("name")?.value || "").trim();
            if (!name) throw new Error("Inserisci un nome.");
            const clientId = `effect-${crypto.randomUUID?.() || Date.now().toString(36)}`;
            const statuses = String(read("statuses")?.value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
            const duration = parseManagedJson(read("duration")?.value || "{}", "Durata");
            const changes = parseManagedJson(read("changes")?.value || "[]", "Modifiche");
            const response = await postManagedActorCommand({ kind: "effect.create", target: { clientId }, document: { name, clientId, disabled: read("disabled")?.checked === true, statuses, duration, changes } }, getToken());
            rememberManagedCommand(response.command, () => false);
            form.dataset.managedPendingCreate = "true";
            result.textContent = `Creazione di ${name} in attesa di Foundry.`;
        } catch (error) {
            result.textContent = error.message || "Creazione non accodata.";
        } finally {
            button.disabled = form.dataset.managedPendingCreate === "true";
        }
    }

    function findCurrentManagedItem(transferId, itemId) {
        return (Array.isArray(currentDocument?.definition?.items) ? currentDocument.definition.items : []).find((candidate) => (transferId && candidate.transferId === transferId) || (!transferId && itemId && candidate.itemId === itemId));
    }

    function managedCommandTargetsItem(command, transferId, itemId) {
        return (transferId && command.target?.transferId === transferId) || (!transferId && itemId && command.target?.itemId === itemId);
    }

    function managedCommandTargetsEffect(command, effectId, clientId) {
        return (effectId && command.target?.effectId === effectId) || (!effectId && clientId && command.target?.clientId === clientId);
    }

    function parseManagedJson(value, label = "JSON") {
        try { return JSON.parse(String(value || "").trim() || "{}"); }
        catch (_) { throw new Error(`${label}: JSON non valido.`); }
    }

    async function postManagedActorCommand(payload, token) {
        if (!token || !currentDocument) throw new Error("Sessione non disponibile.");
        return window.CriptaApp.api.post(`api/managed-actors/${encodeURIComponent(currentDocument.worldId)}/${encodeURIComponent(currentDocument.actorId)}/commands`, { expectedRevision: currentDocument.revision, ...payload }, { token });
    }

    function rememberManagedCommand(command, removePredicate) {
        const commands = Array.isArray(currentDocument?.sync?.commands) ? currentDocument.sync.commands : [];
        currentDocument.sync = { ...(currentDocument.sync || {}), commands: [...commands.filter((entry) => !removePredicate(entry)), command] };
        window.CriptaApp.api.clearCache?.();
    }

    function updateManagedCardStatus(card, command) {
        const previousStatus = card?.querySelector("[data-managed-item-sync]");
        const statusHtml = renderManagedItemSyncStatus(command);
        if (previousStatus) previousStatus.outerHTML = statusHtml;
        else card?.querySelector(".managed-entry-title")?.insertAdjacentHTML("afterend", statusHtml);
    }

    async function uploadManagedItemIcon(file, transferId, revision, token) {
        const blob = await fileToWebp(file, 512);
        const folder = `managed-actors/${sanitizeId(currentDocument.worldId)}/${sanitizeId(currentDocument.actorId)}/icons/site`;
        const filename = `${sanitizeId(transferId) || "item"}-site-r${Math.max(1, Number(revision) || 1)}.webp`;
        const form = new FormData();
        form.set("campaignId", window.CriptaApp.campaigns.currentId());
        form.set("folder", folder);
        form.set("filename", filename);
        form.set("file", new File([blob], filename, { type: "image/webp" }));
        const url = new URL(window.CriptaApp.urls.api("media/upload"));
        url.searchParams.set("folder", folder);
        url.searchParams.set("campaign", window.CriptaApp.campaigns.currentId());
        const response = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "Upload icona fallito");
        return payload.path || `media/${payload.key}`;
    }
    function sameManagedFormValue(left, right) {
        const normalizeScalar = (value) => {
            if (typeof value !== "string") return value;
            const clean = value.trim();
            if (!clean || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) return value;
            const number = Number(clean);
            return Number.isFinite(number) ? number : value;
        };
        const comparable = (value) => Array.isArray(value) && value.every((entry) => ["string", "number"].includes(typeof entry))
            ? [...value].map(normalizeScalar).map(String).sort((a, b) => a.localeCompare(b))
            : normalizeScalar(value);
        return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
    }

    function normalizeManagedChallengeRating(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const text = String(value).trim();
        const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2]);
        const numeric = Number(text);
        return Number.isFinite(numeric) ? numeric : text;
    }
    function formatManagedPendingFields(patches = []) {
        const labels = Array.from(new Set(patches.map((patch) => managedActorFieldLabel(patch.path))));
        const visible = labels.slice(0, 4);
        const remainder = labels.length - visible.length;
        return `In attesa di Foundry (${labels.length}): ${visible.join(", ")}${remainder > 0 ? ` e altri ${remainder}` : ""}`;
    }

    function managedActorFieldLabel(path) {
        const labels = {
            name: "Nome",
            "system.attributes.hp.value": "PF attuali",
            "system.attributes.hp.temp": "PF temporanei",
            "system.attributes.hp.max": "PF massimi",
            "system.attributes.hp.tempmax": "Bonus PF massimi",
            "system.attributes.ac.flat": "Classe Armatura",
            "system.attributes.ac.calc": "Metodo CA",
            "system.attributes.prof": "Competenza",
            "system.attributes.init.bonus": "Iniziativa",
            "system.attributes.movement.walk": "Velocità",
            "system.attributes.movement.fly": "Volo",
            "system.attributes.movement.swim": "Nuoto",
            "system.attributes.movement.climb": "Scalata",
            "system.attributes.movement.burrow": "Scavo",
            "system.attributes.movement.units": "Unità movimento",
            "system.attributes.movement.hover": "Fluttuare",
            "system.details.cr": "CR",
            "system.traits.size": "Taglia",
            "system.traits.dr.value": "Resistenze",
            "system.traits.dr.bypasses": "Resistenze magiche",
            "system.traits.dr.custom": "Nota resistenze",
            "system.traits.dv.value": "Vulnerabilità",
            "system.traits.dv.bypasses": "Vulnerabilità magiche",
            "system.traits.dv.custom": "Nota vulnerabilità",
            "system.traits.di.value": "Immunità",
            "system.traits.di.bypasses": "Immunità magiche",
            "system.traits.di.custom": "Nota immunità",
            "system.traits.ci.value": "Immunità condizioni",
            "system.traits.ci.custom": "Nota condizioni",
            "system.traits.languages.value": "Linguaggi",
            "system.traits.languages.custom": "Nota linguaggi"
        };
        if (labels[path]) return labels[path];
        const abilities = { str: "Forza", dex: "Destrezza", con: "Costituzione", int: "Intelligenza", wis: "Saggezza", cha: "Carisma" };
        const ability = String(path || "").match(/^system\.abilities\.(str|dex|con|int|wis|cha)\.(value|proficient)$/);
        if (ability) return ability[2] === "proficient" ? `TS ${abilities[ability[1]]}` : abilities[ability[1]];
        const skill = String(path || "").match(/^system\.skills\.([a-z0-9_-]+)\.value$/);
        if (skill) return `Abilità ${skill[1].toUpperCase()}`;
        const spell = String(path || "").match(/^system\.spells\.(spell[0-9]|pact)\.(value|spent|max|override)$/);
        if (spell) return `${spell[1] === "pact" ? "Patto" : `Slot livello ${spell[1].replace("spell", "")}`} (${spell[2] === "value" ? "disponibili" : spell[2] === "spent" ? "usati" : "massimi"})`;
        return String(path || "Campo").split(".").pop() || "Campo";
    }
    async function saveManagedActorPresentation(root) {
        if (!currentDocument) return;
        const status = root.querySelector("[data-managed-status]");
        const button = root.querySelector("[data-managed-save]");
        const token = getToken();
        if (!token) return;
        const actorPatches = collectManagedActorPatches(root);
        const presentationChanged = hasManagedPresentationChanges(root, currentDocument);
        if (!actorPatches.length && !presentationChanged) {
            status.textContent = "Nessuna modifica da salvare.";
            return;
        }
        button.disabled = true;
        status.textContent = "Salvataggio...";
        try {
            const next = structuredClone(currentDocument);
            const latest = await window.CriptaApp.api.get(`api/managed-actors/${encodeURIComponent(currentDocument.worldId)}/${encodeURIComponent(currentDocument.actorId)}`, { token, cache: false });
            if (Number(latest?.data?.revision || 0) !== Number(currentDocument.revision || 0)) {
                currentDocument = latest.data;
                renderManagedActor(root, currentDocument, currentCanEdit, managedEditMode, currentCanManageActor);
                const refreshedStatus = root.querySelector("[data-managed-status]");
                if (refreshedStatus) refreshedStatus.textContent = "La scheda era cambiata: ho caricato la versione più recente. Ripeti la modifica.";
                return;
            }

            let revision = Number(currentDocument.revision || 0);
            if (presentationChanged) {
                next.expectedRevision = revision;
                next.media ||= {};
                const visibilityControl = root.querySelector("[data-managed-visibility]");
                if (visibilityControl) {
                    const visibility = visibilityControl.value || "dm";
                    next.visibility = { state: visibility, published: visibility === "public" };
                }
                for (const slot of ["avatar", "token"]) {
                    const file = root.querySelector(`[data-managed-file="${slot}"]`)?.files?.[0];
                    const current = next.media?.[slot] || null;
                    if (!file && slot !== "token") continue;
                    if (!file && !current?.path) continue;
                    const nextRevision = Number(current?.revision || 0) + 1;
                    const path = file ? await uploadSiteSlot(file, slot, next, token, nextRevision) : current.path;
                    next.media[slot] = {
                        ...(file ? {} : current),
                        path,
                        source: file ? "site" : (current.source || "site"),
                        revision: file ? nextRevision : Number(current.revision || 1),
                        ...(slot === "token" ? { presentation: collectManagedMediaPresentation(root, slot, current?.presentation) } : {})
                    };
                }
                for (const slot of ["idle", "hover"]) {
                    if (root.querySelector(`[data-managed-remove="${slot}"]`)?.checked) {
                        next.media[slot] = null;
                        continue;
                    }
                    const file = root.querySelector(`[data-managed-file="${slot}"]`)?.files?.[0];
                    const current = next.media?.[slot] || null;
                    const path = file ? await uploadSiteSlot(file, slot, next, token) : current?.path;
                    if (!path) continue;
                    next.media[slot] = {
                        path,
                        source: "site",
                        revision: Number(current?.revision || 0) + (file ? 1 : 0),
                        presentation: collectManagedMediaPresentation(root, slot, current?.presentation)
                    };
                }
                next.media.variants = await collectManagedVariantEdits(root, next, token);
                next.variantSync = true;
                const result = await window.CriptaApp.api.post(`api/managed-actors/${encodeURIComponent(next.worldId)}/${encodeURIComponent(next.actorId)}`, next, { token });
                revision = Number(result.revision || revision);
            }
            if (actorPatches.length) await enqueueManagedActorUpdate(actorPatches, revision, token);

            status.textContent = actorPatches.length
                ? formatManagedPendingFields(actorPatches)
                : `Salvato · revisione ${revision}`;
            window.CriptaApp.api.clearCache?.();
            const payload = await window.CriptaApp.api.get(`api/managed-actors/${encodeURIComponent(next.worldId)}/${encodeURIComponent(next.actorId)}`, { token, cache: false });
            currentDocument = payload.data;
            renderManagedActor(root, currentDocument, currentCanEdit, managedEditMode, currentCanManageActor);
            const savedStatus = root.querySelector("[data-managed-status]");
            if (savedStatus) savedStatus.textContent = actorPatches.length
                ? formatManagedPendingFields(actorPatches)
                : `Salvato - revisione ${revision}`;
        } catch (error) {
            console.error("Salvataggio Managed Actor fallito", error);
            status.textContent = error.message || "Salvataggio fallito";
        } finally {
            if (button) button.disabled = false;
        }
    }

    function hasManagedPresentationChanges(root, actor) {
        const visibilityControl = root.querySelector("[data-managed-visibility]");
        if (visibilityControl && visibilityControl.value !== String(actor.visibility?.state || "dm")) return true;
        if (["avatar", "token"].some((slot) => root.querySelector(`[data-managed-file="${slot}"]`)?.files?.length)) return true;
        const token = actor.media?.token;
        if (token?.path) {
            const presentation = token.presentation || {};
            if (readAdjust(root, "token", "x", 50) !== Number(presentation.x ?? 50)
                || readAdjust(root, "token", "y", 50) !== Number(presentation.y ?? 50)
                || readAdjust(root, "token", "scale", 1) !== Number(presentation.scale ?? 1)) return true;
            if (!managedFrameCirclesEqual(readManagedFrameCircle(root, "token"), presentation.frameCircle)) return true;
        }
        for (const slot of ["idle", "hover"]) {
            if (root.querySelector(`[data-managed-remove="${slot}"]`)?.checked) return true;
            if (root.querySelector(`[data-managed-file="${slot}"]`)?.files?.length) return true;
            const current = actor.media?.[slot];
            if (current?.path) {
                const presentation = current.presentation || {};
                if (readAdjust(root, slot, "x", 50) !== Number(presentation.x ?? 50)
                    || readAdjust(root, slot, "y", 50) !== Number(presentation.y ?? 50)
                    || readAdjust(root, slot, "scale", 1) !== Number(presentation.scale ?? 1)) return true;
                if (!managedFrameCirclesEqual(readManagedFrameCircle(root, slot), presentation.frameCircle)) return true;
            }
        }
        for (const variant of Array.isArray(actor.media?.variants) ? actor.media.variants : []) {
            const id = String(variant.id || "");
            if (!id) continue;
            if (root.querySelector(`[data-managed-variant-remove="${CSS.escape(id)}"]`)?.checked) return true;
            if (root.querySelector(`[data-managed-variant-file="${CSS.escape(id)}"]`)?.files?.length) return true;
            const name = String(root.querySelector(`[data-managed-variant-name="${CSS.escape(id)}"]`)?.value || "").trim();
            const size = Number(root.querySelector(`[data-managed-variant-size="${CSS.escape(id)}"]`)?.value);
            if (name !== String(variant.name || "Variante") || size !== Number(variant.width || 1)) return true;
        }
        return Boolean(root.querySelector("[data-managed-variant-add-file]")?.files?.length);
    }
    function collectManagedActorPatches(root) {
        const patches = Array.from(root.querySelectorAll("[data-managed-actor-path]")).map((control) => {
            const path = String(control.dataset.managedActorPath || "");
            const type = String(control.dataset.managedActorType || "text");
            let original = null;
            try { original = JSON.parse(control.dataset.managedActorOriginal || "null"); } catch (_) { original = null; }
            let value;
            if (type === "chip-list") {
                const checked = Array.from(control.querySelectorAll('input[type="checkbox"]:checked')).map((input) => String(input.value || "").trim()).filter(Boolean);
                const other = String(control.querySelector("[data-managed-choice-other]")?.value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
                value = Array.from(new Set([...checked, ...other]));
            }
            else if (type === "damage-matrix") {
                const matrix = control.closest(".managed-damage-matrix");
                const key = String(control.dataset.managedMatrixKey || "");
                const selected = Array.from(matrix?.querySelectorAll("select[data-managed-damage-select]") || [])
                    .filter((select) => String(select.value || "") === key)
                    .map((select) => String(select.dataset.managedDamageType || "").trim())
                    .filter(Boolean);
                const other = String(matrix?.querySelector(`[data-managed-matrix-other="${CSS.escape(key)}"]`)?.value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
                value = Array.from(new Set([...selected, ...other]));
            }
            else if (type === "bypass-magic") {
                const matrix = control.closest(".managed-damage-matrix");
                const key = String(control.dataset.managedMatrixKey || "");
                const assigned = Array.from(matrix?.querySelectorAll("[data-managed-damage-row]") || []).some((row) => {
                    const type = String(row.querySelector("[data-managed-damage-select]")?.dataset.managedDamageType || "");
                    const effect = String(row.querySelector("[data-managed-damage-select]")?.value || "");
                    return ["bludgeoning", "piercing", "slashing"].includes(type) && effect === key;
                });
                if (!assigned) value = Array.isArray(original) ? original : [];
                else {
                    const includesMagical = control.dataset.managedIncludesMagical === "true";
                    value = normalizeManagedTraitValues(original).filter((entry) => entry !== "mgc");
                    if (!includesMagical) value.push("mgc");
                }
            }
            else if (type === "boolean") value = control.checked;
            else if (type === "spell-used") {
                const used = Math.max(0, Number(control.value) || 0);
                const maximum = Math.max(0, Number(control.dataset.managedSpellMax) || 0);
                value = control.dataset.managedSpellMode === "remaining" ? Math.max(0, maximum - used) : used;
            }
            else if (type === "number" || type === "select-number") value = Number(control.value);
            else if (type === "list") value = String(control.value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
            else value = control.value;
            const originalComparable = path === "system.details.cr" ? normalizeManagedChallengeRating(original) : original;
            if (path === "system.details.cr") value = normalizeManagedChallengeRating(value);
            const command = findManagedActorUpdateCommand();
            const retrying = ["conflict", "failed"].includes(command?.status)
                && (Array.isArray(command?.patches) ? command.patches : []).some((patch) => patch.path === path);
            if (sameManagedFormValue(value, originalComparable) && !retrying) return null;
            const commandPatch = (Array.isArray(command?.patches) ? command.patches : []).find((patch) => patch.path === path);
            const hasConflictValue = command?.current && Object.prototype.hasOwnProperty.call(command.current, path);
            const baseValue = hasConflictValue
                ? command.current[path]
                : commandPatch
                    ? commandPatch.baseValue
                    : readManagedActorBaseValue(path);
            return { path, value, baseValue: baseValue ?? null };
        }).filter(Boolean);
        const acPatch = patches.find((patch) => patch.path === "system.attributes.ac.flat");
        const currentAcMethod = String(readManagedActorBaseValue("system.attributes.ac.calc") || "");
        if (acPatch && !patches.some((patch) => patch.path === "system.attributes.ac.calc") && !["flat", "natural"].includes(currentAcMethod)) {
            patches.push({ path: "system.attributes.ac.calc", value: "flat", baseValue: currentAcMethod || null });
        }
        return patches;
    }

    function readManagedActorBaseValue(path) {
        if (path === "name") return currentDocument?.name;
        if (path === "system.attributes.hp.value") return currentDocument?.runtime?.hp?.value;
        if (path === "system.attributes.hp.temp") return currentDocument?.runtime?.hp?.temp;
        const spell = String(path || "").match(/^system\.spells\.(spell[0-9]|pact)\.(value|spent|max|override)$/);
        if (spell) {
            if (["value", "spent"].includes(spell[2])) return currentDocument?.runtime?.spellSlots?.[spell[1]]?.[spell[2]];
            return currentDocument?.definition?.spellSlots?.[spell[1]]?.[spell[2]];
        }
        const keys = String(path || "").replace(/^system\./, "").split(".").filter(Boolean);
        return keys.reduce((value, key) => value?.[key], currentDocument?.definition);
    }

    async function enqueueManagedActorUpdate(patches, expectedRevision, token) {
        const response = await window.CriptaApp.api.post(`api/managed-actors/${encodeURIComponent(currentDocument.worldId)}/${encodeURIComponent(currentDocument.actorId)}/commands`, {
            kind: "actor.update",
            expectedRevision,
            patches
        }, { token });
        const commands = Array.isArray(currentDocument.sync?.commands) ? currentDocument.sync.commands : [];
        currentDocument.sync = {
            ...(currentDocument.sync || {}),
            queueVersion: response.queueVersion,
            commands: [...commands.filter((command) => command.kind !== "actor.update"), response.command]
        };
        return response;
    }

    async function collectManagedVariantEdits(root, actor, token) {
        const variants = [];
        for (const variant of Array.isArray(actor.media?.variants) ? actor.media.variants : []) {
            const id = String(variant.id || "");
            if (!id || root.querySelector(`[data-managed-variant-remove="${CSS.escape(id)}"]`)?.checked) continue;
            const size = Math.max(.5, Math.min(12, Number(root.querySelector(`[data-managed-variant-size="${CSS.escape(id)}"]`)?.value) || 1));
            const file = root.querySelector(`[data-managed-variant-file="${CSS.escape(id)}"]`)?.files?.[0];
            const name = String(root.querySelector(`[data-managed-variant-name="${CSS.escape(id)}"]`)?.value || variant.name || "Variante").trim();
            const changed = Boolean(file) || name !== String(variant.name || "Variante") || size !== Number(variant.width || 1) || size !== Number(variant.height || variant.width || 1);
            const nextRevision = Number(variant.revision || 1) + (changed ? 1 : 0);
            const path = file ? await uploadManagedVariant(file, id, actor, token, nextRevision) : variant.path;
            variants.push({
                ...variant,
                name,
                width: size,
                height: size,
                path,
                source: changed ? "site" : variant.source,
                revision: nextRevision
            });
        }
        const addFile = root.querySelector("[data-managed-variant-add-file]")?.files?.[0];
        if (addFile) {
            const id = `variant-site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const size = Math.max(.5, Math.min(12, Number(root.querySelector("[data-managed-variant-add-size]")?.value) || 1));
            const path = await uploadManagedVariant(addFile, id, actor, token, 1);
            variants.push({ id, name: String(root.querySelector("[data-managed-variant-add-name]")?.value || "Nuova variante").trim(), width: size, height: size, path, source: "site", revision: 1 });
        }
        return variants;
    }


    async function uploadManagedVariant(file, id, actor, token, revision = 1) {
        const blob = await fileToWebp(file, 2048);
        const folder = `managed-actors/${sanitizeId(actor.worldId)}/${sanitizeId(actor.actorId)}/variants`;
        const filename = `${sanitizeId(id)}-site-r${Math.max(1, Math.floor(Number(revision) || 1))}.webp`;
        const form = new FormData();
        form.set("campaignId", window.CriptaApp.campaigns.currentId());
        form.set("folder", folder);
        form.set("filename", filename);
        form.set("file", new File([blob], filename, { type: "image/webp" }));
        const url = new URL(window.CriptaApp.urls.api("media/upload"));
        url.searchParams.set("folder", folder);
        url.searchParams.set("campaign", window.CriptaApp.campaigns.currentId());
        const response = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || "Upload variante fallito");
        return payload.path || `media/${payload.key}`;
    }

    async function uploadSiteSlot(file, slot, actor, token, revision = 1) {
        const baseSlot = ["avatar", "token"].includes(slot);
        const blob = await fileToWebp(file, slot === "token" ? 2048 : 1600);
        const folder = `managed-actors/${sanitizeId(actor.worldId)}/${sanitizeId(actor.actorId)}/${baseSlot ? "base" : "site"}`;
        const filename = baseSlot ? `${slot}-site-r${Math.max(1, Math.floor(Number(revision) || 1))}.webp` : `${slot}.webp`;
        const form = new FormData();
        form.set("campaignId", window.CriptaApp.campaigns.currentId());
        form.set("folder", folder);
        form.set("filename", filename);
        form.set("file", new File([blob], filename, { type: "image/webp" }));
        const url = new URL(window.CriptaApp.urls.api("media/upload"));
        url.searchParams.set("folder", folder);
        url.searchParams.set("campaign", window.CriptaApp.campaigns.currentId());
        const response = await fetch(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Upload ${slot} fallito`);
        return payload.path || `media/${payload.key}`;
    }

    async function fileToWebp(file, maxDimension) {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Conversione WebP fallita")), "image/webp", .9));
    }


    function collectManagedMediaPresentation(root, slot, current = {}) {
        const presentation = {
            ...(current && typeof current === "object" ? current : {}),
            x: readAdjust(root, slot, "x", 50),
            y: readAdjust(root, slot, "y", 50),
            scale: readAdjust(root, slot, "scale", 1)
        };
        const circle = readManagedFrameCircle(root, slot);
        if (circle) presentation.frameCircle = circle;
        else delete presentation.frameCircle;
        return presentation;
    }
    function readAdjust(root, slot, key, fallback) {
        const value = Number(root.querySelector(`[data-managed-adjust="${slot}:${key}"]`)?.value);
        return Number.isFinite(value) ? value : fallback;
    }

    function renderImage(path, alt) {
        return path ? `<img src="${escapeAttr(resolveMedia(path))}" alt="${escapeAttr(alt || "")}" loading="lazy" decoding="async">` : '<div class="managed-entry-icon"><i class="fas fa-user"></i></div>';
    }

    function resolveMedia(path) {
        return window.CriptaApp.utils.resolveImageUrl(String(path || ""));
    }

    function getToken() {
        return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "").trim();
    }

    function buildActorBackLink(actor) {
        const ownerCharacterId = String(actor?.ownerCharacterId || "").trim();
        const relationshipType = getManagedActorRelationshipType(actor);
        const campaignId = window.CriptaApp?.campaigns?.currentId?.() || "";
        const target = new URL(relationshipType === "player" ? "../giocatori.html" : (relationshipType === "companion" && ownerCharacterId ? "./character.html" : "../npcs.html"), window.location.href);
        if (relationshipType === "companion" && ownerCharacterId) {
            target.searchParams.set("id", ownerCharacterId);
            target.searchParams.set("type", "player");
        }
        if (campaignId && campaignId !== "cripta-di-sangue") target.searchParams.set("campaign", campaignId);
        return `${target.pathname}${target.search}`;
    }

    function formatUpdatedAt(value) {
        const date = new Date(value || "");
        if (!Number.isFinite(date.getTime())) return "ultimo aggiornamento";
        return new Intl.DateTimeFormat("it-IT", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }
    function formatDetails(details) {
        const type = typeof details.type === "object" ? details.type.value || details.type.label : details.type;
        const race = typeof details.race === "object" ? details.race.name : details.race;
        const typeLabels = { undead: "Non morto", humanoid: "Umanoide", aberration: "Aberrazione", beast: "Bestia", celestial: "Celestiale", construct: "Costrutto", dragon: "Drago", elemental: "Elementale", fey: "Fatato", fiend: "Immondo", giant: "Gigante", monstrosity: "Mostruosità", ooze: "Melma", plant: "Vegetale" };
        const alignmentLabels = { "lawful good": "Legale Buono", "neutral good": "Neutrale Buono", "chaotic good": "Caotico Buono", "lawful neutral": "Legale Neutrale", neutral: "Neutrale", "chaotic neutral": "Caotico Neutrale", "lawful evil": "Legale Malvagio", "neutral evil": "Neutrale Malvagio", "chaotic evil": "Caotico Malvagio", unaligned: "Senza allineamento" };
        const translatedType = typeLabels[String(type || "").toLowerCase()] || type;
        const translatedAlignment = alignmentLabels[String(details.alignment || "").toLowerCase()] || details.alignment;
        return [race, translatedType, translatedAlignment].filter(Boolean).join(" · ");
    }

    function formatVisibility(visibility) {
        return ({ dm: "solo DM", owners: "proprietari", players: "giocatori", public: "pubblico" })[visibility?.state] || "solo DM";
    }

    function formatMovement(movement) {
        if (!movement || typeof movement !== "object") return movement || "";
        const labels = { walk: "Terra", fly: "Volo", swim: "Nuoto", climb: "Scalata", burrow: "Scavo" };
        return Object.entries(movement).filter(([, value]) => Number(value) > 0).map(([key, value]) => `${labels[key] || key} ${value}`).join(", ");
    }

    function formatTrait(value) {
        if (!value) return "";
        if (Array.isArray(value)) return value.map((entry) => typeof entry === "object" ? entry.value || entry.name : entry).filter(Boolean).map(formatManagedTraitValue).join(", ");
        if (typeof value === "object") {
            const values = Array.isArray(value.value) ? value.value : [];
            return [...values.map(formatManagedTraitValue), value.custom].filter(Boolean).join(", ");
        }
        return formatManagedTraitValue(value);
    }

    function formatManagedTraitValue(value) {
        const labels = {
            acid: "acido", bludgeoning: "contundente", cold: "freddo", fire: "fuoco", force: "forza", lightning: "fulmine", necrotic: "necrotico", piercing: "perforante", poison: "veleno", psychic: "psichico", radiant: "radioso", slashing: "tagliente", thunder: "tuono",
            blinded: "accecato", charmed: "affascinato", deafened: "assordato", exhaustion: "indebolimento", frightened: "spaventato", grappled: "afferrato", incapacitated: "incapacitato", invisible: "invisibile", paralyzed: "paralizzato", petrified: "pietrificato", poisoned: "avvelenato", prone: "prono", restrained: "trattenuto", stunned: "stordito", unconscious: "privo di sensi",
            abyssal: "Abissale", celestial: "Celestiale", common: "Comune", deep: "Gergo delle Profondità", draconic: "Draconico", dwarvish: "Nanico", elvish: "Elfico", giant: "Gigante", gnomish: "Gnomesco", goblin: "Goblin", halfling: "Halfling", infernal: "Infernale", orc: "Orchesco", primordial: "Primordiale", sylvan: "Silvano", undercommon: "Sottocomune"
        };
        const text = String(value || "").trim();
        return labels[text.toLowerCase()] || text.replace(/[_-]+/g, " ");
    }

    function formatEntryMeta(entry) {
        const def = entry.definition || {};
        if (entry.type === "spell") {
            const schools = { abj: "Abiurazione", con: "Evocazione", div: "Divinazione", enc: "Ammaliamento", evo: "Invocazione", ill: "Illusione", nec: "Necromanzia", trs: "Trasmutazione" };
            return [Number(def.level || 0) ? `Livello ${def.level}` : "Trucchetto", schools[String(def.school || "").toLowerCase()] || def.school].filter(Boolean).join(" · ");
        }
        const typeLabels = { weapon: "Attacco", feat: "Capacità", equipment: "Equipaggiamento", consumable: "Consumabile", loot: "Oggetto", tool: "Strumento", container: "Contenitore" };
        const rarityLabels = { common: "Comune", uncommon: "Non comune", rare: "Raro", veryRare: "Molto raro", legendary: "Leggendario", artifact: "Artefatto" };
        return [typeLabels[entry.type] || entry.type, rarityLabels[def.rarity] || def.rarity, def.equipped ? "Equipaggiato" : ""].filter(Boolean).join(" · ");
    }

    function formatManagedVariantName(value) {
        let text = String(value || "Variante").trim();
        const actorFirstName = sanitizeId(currentDocument?.name || "").split("-")[0];
        if (actorFirstName) text = text.replace(new RegExp(`^${actorFirstName}-`, "i"), "");
        text = text.replace(/-token(?:-new)?(?:-webp)?$/i, "").replace(/[_-]+/g, " ").trim();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Variante";
    }

    function getManagedAbilitySave(value = {}) {
        if (value.save !== undefined && value.save !== null && value.save !== "" && Number.isFinite(Number(value.save))) return Number(value.save);
        const modifier = Number(value.mod || 0);
        const proficiency = Number(value.proficient || 0);
        const proficiencyBonus = Number(currentDocument?.definition?.attributes?.prof || 0);
        return modifier + (proficiency * proficiencyBonus);
    }

    function formatManagedStatValue(entry) {
        if (entry.type === "select" && Array.isArray(entry.options)) {
            return String(entry.options.find(([value]) => String(value) === String(entry.value))?.[1] || entry.value || "—");
        }
        return String(entry.value ?? "—");
    }
    function formatSigned(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number}` : "—";
    }

    function readNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : value;
    }

    function htmlToText(value) {
        const documentValue = new DOMParser().parseFromString(String(value || ""), "text/html");
        documentValue.body.querySelectorAll("table").forEach((table) => {
            const rows = Array.from(table.querySelectorAll("tr")).map((row) => (
                Array.from(row.children)
                    .filter((cell) => ["TH", "TD"].includes(cell.tagName))
                    .map((cell) => String(cell.textContent || "").replace(/\s+/g, " ").trim())
                    .filter(Boolean)
                    .join(" | ")
            )).filter(Boolean);
            table.replaceWith(documentValue.createTextNode(`${rows.join(" - ")}\n`));
        });
        documentValue.body.querySelectorAll("br").forEach((node) => node.replaceWith(documentValue.createTextNode("\n")));
        documentValue.body.querySelectorAll("li").forEach((node) => {
            node.insertBefore(documentValue.createTextNode("- "), node.firstChild);
            node.append(documentValue.createTextNode("\n"));
        });
        documentValue.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6").forEach((node) => node.append(documentValue.createTextNode("\n")));
        return String(documentValue.body.textContent || "")
            .replace(/(\]|\})(?=@[\w-]+\[)/g, "$1 ")
            .replace(/&(?:amp;)?Reference\[([^\]]+)\]/gi, (_, reference) => simplifyFoundryReference(reference))
            .replace(/@([\w-]+)\[([^\]]+)\](?:\{([^}]+)\})?/gi, (_, kind, target, explicitLabel) => resolveManagedFoundryLink(kind, target, explicitLabel))
            .replace(/\[\[(?:\/([\w-]+)\s+)?([^\]]+)\]\](?:\{([^}]+)\})?/gi, (_, command, args, explicitLabel) => formatManagedInlineRoll(command, args, explicitLabel))
            .replace(/[ \t\f\v]+/g, " ")
            .replace(/ *\n */g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    function resolveManagedFoundryLink(kind, target, explicitLabel = "") {
        if (String(explicitLabel || "").trim()) return String(explicitLabel).trim();
        const rawTarget = String(target || "").trim();
        if (String(kind || "").toLowerCase() !== "uuid") return rawTarget.split("|")[0].replace(/[_-]+/g, " ").trim();
        const itemId = rawTarget.match(/\.Item\.([^.\s]+)$/i)?.[1] || "";
        const item = (Array.isArray(currentDocument?.definition?.items) ? currentDocument.definition.items : []).find((entry) => String(entry.itemId || "") === itemId);
        return String(item?.name || "Elemento collegato");
    }

    function simplifyFoundryReference(reference) {
        const content = String(reference || "").trim();
        const match = content.match(/[a-z0-9_-]+\s*=\s*("[^"]+"|'[^']+'|[^\s,\]|]+)/i);
        const rawValue = match?.[1] || content.replace(/^[a-z0-9_-]+\s*=\s*/i, "");
        return String(rawValue || "").trim().replace(/^["']|["']$/g, "").replace(/[_-]+/g, " ").trim();
    }

    function formatManagedInlineRoll(command, args, explicitLabel = "") {
        if (String(explicitLabel || "").trim()) return String(explicitLabel).trim();
        const rawArgs = String(args || "").trim();
        const values = Object.fromEntries(Array.from(rawArgs.matchAll(/([a-z0-9_-]+)=("[^"]+"|'[^']+'|[^\s]+)/gi)).map((match) => [match[1].toLowerCase(), match[2].replace(/^["']|["']$/g, "")]));
        const abilityLabels = { str: "Forza", dex: "Destrezza", con: "Costituzione", int: "Intelligenza", wis: "Saggezza", cha: "Carisma" };
        const ability = abilityLabels[String(values.ability || "").toLowerCase()] || values.ability || "";
        const dc = values.dc ? ` CD ${values.dc}` : "";
        const normalizedCommand = String(command || "").toLowerCase();
        if (normalizedCommand === "save") return `TS${ability ? ` ${ability}` : ""}${dc}`.trim();
        if (normalizedCommand === "check") return `Prova${ability ? ` ${ability}` : ""}${dc}`.trim();
        return rawArgs.split(/\s+(?=[a-z0-9_-]+=)/i)[0].trim() || rawArgs;
    }

    function buildManagedDescriptionEditorHtml(value) {
        const withTokens = String(value || "")
            .replace(/&(?:amp;)?Reference\[([^\]]+)\]/gi, (raw, reference) => buildManagedFoundryToken(raw, simplifyFoundryReference(reference), "reference"))
            .replace(/@([\w-]+)\[([^\]]+)\](?:\{([^}]+)\})?/gi, (raw, kind, target, explicitLabel) => buildManagedFoundryToken(raw, resolveManagedFoundryLink(kind, target, explicitLabel), "link"))
            .replace(/\[\[(?:\/([\w-]+)\s+)?([^\]]+)\]\](?:\{([^}]+)\})?/gi, (raw, command, args, explicitLabel) => buildManagedFoundryToken(raw, formatManagedInlineRoll(command, args, explicitLabel), "roll"));
        const parsed = new DOMParser().parseFromString(withTokens, "text/html");
        parsed.body.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());
        parsed.body.querySelectorAll("*").forEach((node) => Array.from(node.attributes).forEach((attribute) => {
            if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
        }));
        return parsed.body.innerHTML;
    }

    function buildManagedFoundryToken(raw, label, type) {
        return `<span class="managed-foundry-token managed-foundry-token--${escapeAttr(type)}" contenteditable="false" data-foundry-raw="${escapeAttr(raw)}">${escapeHtml(label || "Elemento collegato")}</span>`;
    }

    function serializeManagedDescriptionEditor(editor) {
        const clone = editor.cloneNode(true);
        const replacements = [];
        clone.querySelectorAll("[data-foundry-raw]").forEach((node, index) => {
            const placeholder = `__KHUZOE_FOUNDRY_TOKEN_${index}__`;
            replacements.push([placeholder, String(node.getAttribute("data-foundry-raw") || "")]);
            node.replaceWith(document.createTextNode(placeholder));
        });
        let html = clone.innerHTML.trim();
        for (const [placeholder, raw] of replacements) html = html.replace(placeholder, () => raw);
        return html;
    }

    function normalizeManagedMerchantDescription(value) {
        if (typeof value === "string" || typeof value === "number") {
            const text = String(value).trim();
            return /^\[object\s+Object\]$/i.test(text) ? "" : text;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) return "";
        for (const candidate of [value.value, value.chat, value.unidentified, value.description, value.text, value.html]) {
            const text = normalizeManagedMerchantDescription(candidate);
            if (text) return text;
        }
        return "";
    }

    function formatManagedPreview(value) {
        return escapeHtml(value).replace(/\n/g, "<br>");
    }
    function stripManagedDuplicateHeading(value, name) {
        const text = String(value || "").trim();
        const escapedName = String(name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!escapedName) return text;
        const stripped = text.replace(new RegExp(`^${escapedName}\\.?\\s*`, "i"), "").trim();
        return stripped || text;
    }

    function truncatePreview(value, limit = 360) {
        const text = String(value || "").trim();
        if (text.length <= limit) return text;
        const clipped = text.slice(0, Math.max(0, limit - 1)).replace(/\s+\S*$/, "").trim();
        return `${clipped || text.slice(0, limit - 1).trim()}...`;
    }

    function sanitizeId(value) {
        return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }
})();