(function () {
    const STORAGE_KEY = "cripta-appunti-v1";
    const AUTOSAVE_DELAY = 4000;
    const PERIODIC_SAVE_MS = 30000;
    const NOTE_PLACEHOLDER = "<p></p>";
    const NOTES_CONTENT_VERSION = 1;
    const NOTES_PAGE_ID = "appunti";

    const state = {
        currentDiscordId: "",
        currentUsername: "",
        ownerDiscordId: "",
        isDm: false,
        owners: [],
        notes: [],
        selectedId: "",
        query: "",
        linkFilter: "",
        dirty: false,
        saveTimer: null,
        pickerType: "",
        entities: {
            npc: [],
            player: [],
            item: [],
            creature: []
        }
    };

    const els = {};

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        bindElements();
        bindEvents();
        setEditorEnabled(false);

        const authState = await getVerifiedAuth();
        state.currentDiscordId = getDiscordId(authState);
        state.currentUsername = authState?.user?.global_name || authState?.user?.username || "Utente";
        state.ownerDiscordId = state.currentDiscordId;
        if (!state.currentDiscordId) {
            renderLoggedOutState();
            return;
        }

        await loadAccessContext();
        renderOwnerSelector();

        await Promise.all([
            loadNotesForCurrentOwner(),
            loadLinkableEntities()
        ]);

        window.setInterval(() => {
            if (state.dirty && canWriteNotes()) saveNow();
        }, PERIODIC_SAVE_MS);
    }

    function bindElements() {
        [
            "note-new-btn",
            "notes-sync-status",
            "notes-search",
            "notes-owner-field",
            "notes-owner-select",
            "notes-tag-filters",
            "notes-list",
            "note-title",
            "note-shared",
            "note-duplicate-btn",
            "note-delete-btn",
            "note-links",
            "note-editor",
            "note-updated-at",
            "note-save-btn",
            "notes-picker-modal",
            "notes-picker-title",
            "notes-picker-search",
            "notes-picker-results"
        ].forEach((id) => {
            els[toCamel(id)] = document.getElementById(id);
        });
    }

    function bindEvents() {
        els.noteNewBtn?.addEventListener("click", createAndSelectNote);
        els.noteDuplicateBtn?.addEventListener("click", duplicateSelectedNote);
        els.noteDeleteBtn?.addEventListener("click", deleteSelectedNote);
        els.noteSaveBtn?.addEventListener("click", saveNow);

        els.notesOwnerSelect?.addEventListener("change", async () => {
            if (!state.isDm) return;
            const nextOwner = String(els.notesOwnerSelect.value || "").trim();
            if (!nextOwner || nextOwner === state.ownerDiscordId) return;
            if (state.dirty && canWriteNotes()) await saveNow();
            state.ownerDiscordId = nextOwner;
            state.linkFilter = "";
            await loadNotesForCurrentOwner();
        });

        els.notesSearch?.addEventListener("input", (event) => {
            if (!canUseNotes()) return;
            state.query = event.target.value.trim();
            state.linkFilter = "";
            renderNotesList();
        });

        els.notesTagFilters?.addEventListener("click", (event) => {
            if (!canUseNotes()) return;
            const button = event.target.closest("[data-note-link-filter]");
            if (!button) return;
            state.linkFilter = button.dataset.noteLinkFilter || "";
            renderNotesList();
        });

        els.notesList?.addEventListener("click", (event) => {
            if (!canUseNotes()) return;
            const button = event.target.closest("[data-note-id]");
            if (!button) return;
            if (canWriteNotes()) commitEditorToState({ touch: false });
            state.selectedId = button.dataset.noteId;
            renderAll();
        });

        els.noteTitle?.addEventListener("input", () => {
            if (!canWriteNotes()) return;
            const note = getSelectedNote();
            if (!note) return;
            note.title = els.noteTitle.value.trim();
            markDirty();
            renderNotesList();
        });

        els.noteShared?.addEventListener("change", () => {
            if (!canWriteNotes()) return;
            const note = getSelectedNote();
            if (!note) return;
            note.shared = els.noteShared.checked;
            markDirty();
            renderNotesList();
        });

        els.noteEditor?.addEventListener("input", () => {
            if (!canWriteNotes()) return;
            const note = getSelectedNote();
            if (!note) return;
            note.html = sanitizeNoteHtml(els.noteEditor.innerHTML);
            markDirty();
            renderNotesList();
        });

        document.querySelectorAll("[data-format-command]").forEach((button) => {
            button.addEventListener("click", () => {
                if (!canWriteNotes()) return;
                els.noteEditor?.focus();
                document.execCommand(button.dataset.formatCommand, false, button.dataset.formatValue || null);
                const note = getSelectedNote();
                if (!note) return;
                note.html = sanitizeNoteHtml(els.noteEditor.innerHTML);
                markDirty();
            });
        });

        document.querySelectorAll("[data-link-type]").forEach((button) => {
            button.addEventListener("click", () => openPicker(button.dataset.linkType));
        });

        els.noteLinks?.addEventListener("click", (event) => {
            if (!canWriteNotes()) return;
            const button = event.target.closest("[data-remove-link]");
            if (!button) return;
            const note = getSelectedNote();
            if (!note) return;
            note.links = (note.links || []).filter((link) => link.key !== button.dataset.removeLink);
            const merged = promptDuplicateTagMerge(note);
            markDirty();
            if (merged) renderAll();
            else renderLinks(note);
        });

        els.notesPickerSearch?.addEventListener("input", renderPickerResults);
        els.notesPickerResults?.addEventListener("click", (event) => {
            if (!canUseNotes()) return;
            const button = event.target.closest("[data-picker-key]");
            if (!button) return;
            attachEntity(button.dataset.pickerKey);
        });

        document.querySelectorAll("[data-close-notes-picker]").forEach((button) => {
            button.addEventListener("click", closePicker);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && els.notesPickerModal && !els.notesPickerModal.hidden) closePicker();
        });
    }

    function renderAll() {
        renderNotesList();
        renderEditor();
    }

    function renderLoggedOutState() {
        state.notes = [];
        state.selectedId = "";
        state.dirty = false;
        window.clearTimeout(state.saveTimer);
        setEditorEnabled(false);
        if (els.notesSearch) els.notesSearch.disabled = true;
        setStatus("Login richiesto", "error");
        if (els.notesList) {
            els.notesList.innerHTML = '<p class="notes-empty">Accedi con Discord per leggere e scrivere i tuoi appunti.</p>';
        }
        if (els.noteTitle) els.noteTitle.value = "";
        if (els.noteEditor) els.noteEditor.innerHTML = "";
        if (els.noteLinks) els.noteLinks.innerHTML = '<p class="notes-link-empty">Login richiesto.</p>';
        if (els.noteUpdatedAt) els.noteUpdatedAt.textContent = "Nessun appunto caricato";
    }

    function renderOwnerSelector() {
        if (!els.notesOwnerField || !els.notesOwnerSelect) return;
        if (!state.isDm) {
            els.notesOwnerField.hidden = true;
            return;
        }

        els.notesOwnerField.hidden = false;
        els.notesOwnerSelect.innerHTML = state.owners.map((owner) => `
            <option value="${escapeHtml(owner.discordId)}"${owner.discordId === state.ownerDiscordId ? " selected" : ""}>
                ${escapeHtml(owner.name)}
            </option>
        `).join("");
    }

    async function loadNotesForCurrentOwner() {
        setEditorEnabled(false);
        setStatus("Caricamento...");
        if (els.notesSearch) els.notesSearch.disabled = false;
        state.notes = normalizeNotes(await notesStore.load());
        if (!state.notes.length) state.notes = [createNote()];
        state.selectedId = state.notes[0].id;
        state.dirty = false;
        renderAll();
        renderOwnerSelector();
        setStatus(state.isDm && state.ownerDiscordId !== state.currentDiscordId ? "Sola lettura DM" : "Pronto");
    }

    function renderNotesList() {
        const query = normalizeText(state.query);
        const queryMatchedNotes = state.notes
            .filter((note) => {
                if (!query) return true;
                return normalizeText([note.title, htmlToText(note.html), ...(note.links || []).map((link) => link.label)].join(" ")).includes(query);
            });

        const availableFilters = getAvailableNoteLinkFilters(queryMatchedNotes);
        if (state.linkFilter && !availableFilters.some((filter) => filter.key === state.linkFilter)) {
            state.linkFilter = "";
        }
        renderNoteTagFilters(availableFilters);

        const notes = queryMatchedNotes
            .filter((note) => {
                if (!state.linkFilter) return true;
                if (state.linkFilter === "shared") return note.shared === true;
                return (note.links || []).some((link) => link.key === state.linkFilter);
            })
            .sort(compareNotesForList);

        if (!notes.length) {
            els.notesList.innerHTML = '<p class="notes-empty">Nessun appunto trovato.</p>';
            return;
        }

        els.notesList.innerHTML = notes.map((note) => `
            <button class="notes-list-item ${note.id === state.selectedId ? "is-active" : ""}" type="button" data-note-id="${escapeHtml(note.id)}">
                <strong>${note.shared ? '<i class="fas fa-users" aria-hidden="true"></i>' : ""}${escapeHtml(note.title || "Appunto senza titolo")}</strong>
                <span>${escapeHtml(buildNoteExcerpt(note))}</span>
                <em>${escapeHtml(formatDateTime(note.updatedAt))}</em>
            </button>
        `).join("");
    }

    function getAvailableNoteLinkFilters(notes) {
        const query = normalizeText(state.query);
        if (!query) return [];
        const byKey = new Map();
        notes.forEach((note) => {
            if (note.shared === true) {
                byKey.set("shared", { key: "shared", label: "Condivisi", count: (byKey.get("shared")?.count || 0) + 1 });
            }
            (note.links || []).forEach((link) => {
                if (!link.key || !link.label) return;
                const current = byKey.get(link.key) || { key: link.key, label: link.label, type: link.type, count: 0 };
                current.count += 1;
                byKey.set(link.key, current);
            });
        });
        return [...byKey.values()].sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), "it", { sensitivity: "base" }));
    }

    function renderNoteTagFilters(filters) {
        if (!els.notesTagFilters) return;
        if (!filters.length) {
            els.notesTagFilters.innerHTML = "";
            els.notesTagFilters.hidden = true;
            return;
        }

        els.notesTagFilters.innerHTML = filters.map((filter) => `
            <button class="notes-tag-filter notes-tag-filter--${escapeHtml(filter.type || "tag")} ${state.linkFilter === filter.key ? "is-active" : ""}" type="button" data-note-link-filter="${escapeHtml(filter.key)}">
                <span>${escapeHtml(filter.label)}</span>
                <em>${escapeHtml(filter.count)}</em>
            </button>
        `).join("");
        els.notesTagFilters.hidden = false;
    }

    function renderEditor() {
        const note = getSelectedNote();
        setEditorEnabled(Boolean(note) && canWriteNotes());
        if (!note) return;
        els.noteTitle.value = note.title || "";
        if (els.noteShared) els.noteShared.checked = note.shared === true;
        els.noteEditor.innerHTML = note.html || NOTE_PLACEHOLDER;
        renderLinks(note);
        els.noteUpdatedAt.textContent = `Ultima modifica: ${formatDateTime(note.updatedAt)}`;
    }

    function renderLinks(note) {
        const links = Array.isArray(note.links) ? note.links : [];
        if (!links.length) {
            els.noteLinks.innerHTML = '<p class="notes-link-empty">Nessun collegamento.</p>';
            return;
        }

        els.noteLinks.innerHTML = links.map((link) => `
            <span class="notes-entity-chip notes-entity-chip--${escapeHtml(link.type)}">
                <a href="${escapeHtml(link.url || "#")}" title="Apri ${escapeHtml(link.label)}">
                    ${renderEntityThumb(link)}
                    <span>${escapeHtml(link.label)}</span>
                </a>
                <button type="button" data-remove-link="${escapeHtml(link.key)}" aria-label="Rimuovi collegamento ${escapeHtml(link.label)}">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
            </span>
        `).join("");
    }

    function createAndSelectNote() {
        if (!canWriteNotes()) return;
        commitEditorToState({ touch: false });
        const note = createNote();
        state.notes.unshift(note);
        state.selectedId = note.id;
        markDirty();
        renderAll();
        els.noteTitle?.focus();
    }

    function duplicateSelectedNote() {
        if (!canWriteNotes()) return;
        const note = getSelectedNote();
        if (!note) return;
        commitEditorToState({ touch: false });
        const now = new Date().toISOString();
        const copy = {
            ...structuredCloneSafe(note),
            id: createId(),
            title: `${note.title || "Appunto"} copia`,
            createdAt: now,
            updatedAt: now
        };
        state.notes.unshift(copy);
        state.selectedId = copy.id;
        const merged = promptDuplicateTagMerge(copy);
        markDirty();
        renderAll();
    }

    function deleteSelectedNote() {
        if (!canWriteNotes()) return;
        const note = getSelectedNote();
        if (!note) return;
        const confirmed = window.confirm(`Eliminare "${note.title || "Appunto senza titolo"}"?`);
        if (!confirmed) return;
        state.notes = state.notes.filter((item) => item.id !== note.id);
        if (!state.notes.length) state.notes.push(createNote());
        state.selectedId = state.notes[0].id;
        markDirty();
        renderAll();
    }

    function commitEditorToState(options = {}) {
        const note = getSelectedNote();
        if (!note) return;
        const { touch = true } = options;
        note.title = els.noteTitle?.value.trim() || note.title || "Appunto senza titolo";
        note.html = sanitizeNoteHtml(els.noteEditor?.innerHTML || "");
        if (touch) note.updatedAt = new Date().toISOString();
    }

    function markDirty() {
        if (!canWriteNotes()) return;
        const note = getSelectedNote();
        if (note) note.updatedAt = new Date().toISOString();
        state.dirty = true;
        setStatus("Modifiche non salvate", "dirty");
        window.clearTimeout(state.saveTimer);
        state.saveTimer = window.setTimeout(saveNow, AUTOSAVE_DELAY);
    }

    async function saveNow() {
        if (!canWriteNotes()) return;
        window.clearTimeout(state.saveTimer);
        commitEditorToState({ touch: false });
        try {
            await notesStore.save(state.notes);
            state.dirty = false;
            setStatus(`Salvato ${formatTime(new Date())}`, "saved");
            renderNotesList();
            const note = getSelectedNote();
            if (note) els.noteUpdatedAt.textContent = `Ultima modifica: ${formatDateTime(note.updatedAt)}`;
        } catch (error) {
            console.error("Errore salvataggio appunti:", error);
            setStatus("Errore salvataggio", "error");
        }
    }

    function openPicker(type) {
        if (!canWriteNotes()) return;
        state.pickerType = type;
        const titleMap = {
            npc: "Collega NPC",
            item: "Collega oggetto",
            creature: "Collega creatura",
            player: "Collega giocatore"
        };
        els.notesPickerTitle.textContent = titleMap[type] || "Collega voce";
        els.notesPickerSearch.value = "";
        renderPickerResults();
        els.notesPickerModal.hidden = false;
        els.notesPickerSearch.focus();
    }

    function closePicker() {
        els.notesPickerModal.hidden = true;
        state.pickerType = "";
    }

    function renderPickerResults() {
        if (!canUseNotes()) return;
        const type = state.pickerType;
        const query = normalizeText(els.notesPickerSearch?.value || "");
        const note = getSelectedNote();
        const linkedKeys = new Set((note?.links || []).map((link) => link.key));
        const entries = (state.entities[type] || [])
            .filter((entry) => !linkedKeys.has(entry.key))
            .filter((entry) => !query || normalizeText([entry.label, entry.meta].join(" ")).includes(query))
            .slice(0, 80);

        if (!entries.length) {
            els.notesPickerResults.innerHTML = '<p class="notes-empty">Nessuna voce disponibile.</p>';
            return;
        }

        els.notesPickerResults.innerHTML = entries.map((entry) => `
            <button class="notes-picker-result" type="button" data-picker-key="${escapeHtml(entry.key)}" title="${escapeHtml([entry.label, entry.meta].filter(Boolean).join(" - "))}">
                ${renderEntityThumb(entry)}
                <span class="notes-picker-copy">
                    <strong>${escapeHtml(entry.label)}</strong>
                </span>
            </button>
        `).join("");
    }

    function attachEntity(key) {
        if (!canWriteNotes()) return;
        const note = getSelectedNote();
        if (!note) return;
        const entry = Object.values(state.entities).flat().find((item) => item.key === key);
        if (!entry) return;
        note.links = Array.isArray(note.links) ? note.links : [];
        note.links.push({
            key: entry.key,
            type: entry.type,
            id: entry.id,
            label: entry.label,
            url: entry.url,
            image: entry.image || "",
            icon: entry.icon || getEntityIcon(entry.type)
        });
        const merged = promptDuplicateTagMerge(note);
        markDirty();
        if (merged) renderAll();
        else renderLinks(note);
        closePicker();
    }

    function promptDuplicateTagMerge(sourceNote) {
        if (!canWriteNotes() || !sourceNote || sourceNote.shared === true) return false;
        const signature = getNoteTagSignature(sourceNote);
        if (!signature) return false;

        const targetNote = state.notes.find((note) => (
            note.id !== sourceNote.id
            && note.shared !== true
            && getNoteTagSignature(note) === signature
        ));
        if (!targetNote) return false;

        const tagNames = getNoteTagLabels(sourceNote).join(", ");
        const confirmed = window.confirm(
            `Esiste gia un blocco appunti non condiviso con gli stessi tag (${tagNames}). Vuoi unificarli?`
        );
        if (!confirmed) return false;

        mergeNotes(targetNote, sourceNote);
        state.notes = state.notes.filter((note) => note.id !== sourceNote.id);
        state.selectedId = targetNote.id;
        return true;
    }

    function mergeNotes(targetNote, sourceNote) {
        const now = new Date().toISOString();
        targetNote.links = mergeNoteLinks(targetNote.links, sourceNote.links);
        targetNote.html = mergeNoteHtml(targetNote, sourceNote);
        targetNote.updatedAt = now;
        if (!targetNote.title || targetNote.title === "Nuovo appunto") {
            targetNote.title = sourceNote.title || targetNote.title;
        }
    }

    function mergeNoteLinks(left, right) {
        const byKey = new Map();
        [...normalizeLinks(left), ...normalizeLinks(right)].forEach((link) => {
            byKey.set(link.key, link);
        });
        return [...byKey.values()];
    }

    function mergeNoteHtml(targetNote, sourceNote) {
        const targetHtml = sanitizeNoteHtml(targetNote.html || "");
        const sourceHtml = sanitizeNoteHtml(sourceNote.html || "");
        if (!htmlToText(sourceHtml)) return targetHtml;
        if (!htmlToText(targetHtml)) return sourceHtml;

        const sourceTitle = sourceNote.title && sourceNote.title !== targetNote.title
            ? `<p><strong>${escapeHtml(sourceNote.title)}</strong></p>`
            : "";
        return sanitizeNoteHtml(`${targetHtml}<p><br></p>${sourceTitle}${sourceHtml}`);
    }

    function getNoteTagSignature(note) {
        const keys = getNoteTagKeys(note);
        return keys.length ? keys.join("|") : "";
    }

    function getNoteTagKeys(note) {
        return [...new Set((note?.links || [])
            .map((link) => String(link.key || "").trim())
            .filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }

    function getNoteTagLabels(note) {
        return [...new Map((note?.links || [])
            .filter((link) => link?.key && link?.label)
            .map((link) => [String(link.key), String(link.label)]))
            .values()]
            .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
    }

    async function loadLinkableEntities() {
        const [searchIndex, items, creatures, players] = await Promise.all([
            fetchJson("../assets/data/search-index.json").catch(() => ({ items: [] })),
            fetchJson("../assets/data/items.json").catch(() => []),
            fetchJson("../assets/data/bestiary.json").catch(() => []),
            fetchJson("../assets/data/players.json").catch(() => [])
        ]);

        state.entities.npc = (Array.isArray(searchIndex.items) ? searchIndex.items : [])
            .filter((entry) => entry.type === "npc")
            .filter((entry) => !window.WikiSpoiler || window.WikiSpoiler.isVisible(entry))
            .map((entry) => ({
                key: `npc:${entry.entityId || entry.id}`,
                type: "npc",
                id: entry.entityId || entry.id,
                label: entry.title || entry.entityId || "NPC",
                meta: entry.subtitle || "NPC",
                url: `characters/character.html?id=${encodeURIComponent(entry.entityId || "")}`,
                image: getNpcThumb(entry.entityId || entry.id),
                icon: "fa-skull"
            }))
            .sort(compareEntityLabels);

        state.entities.player = (Array.isArray(players) ? players : [])
            .filter((player) => !window.WikiSpoiler || window.WikiSpoiler.isVisible(player))
            .map((player) => ({
                key: `player:${player.id || slugify(player.name)}`,
                type: "player",
                id: player.id || slugify(player.name),
                label: player.name || player.id || "Giocatore",
                meta: player.role || "Giocatore",
                url: `characters/character.html?id=${encodeURIComponent(player.id || "")}&type=player`,
                image: player.images?.avatar ? `../assets/${player.images.avatar}` : "",
                icon: "fa-dice-d20"
            }))
            .sort(compareEntityLabels);

        state.entities.item = (Array.isArray(items) ? items : [])
            .filter((item) => !window.WikiSpoiler || window.WikiSpoiler.isVisible(item))
            .map((item) => ({
                key: `item:${item.id || slugify(item.name)}`,
                type: "item",
                id: item.id || slugify(item.name),
                label: item.name || "Oggetto",
                meta: [item.type, item.rarity, item.owner].filter(Boolean).join(" | "),
                url: `oggetti.html#${encodeURIComponent(item.id || slugify(item.name))}`,
                image: item.image ? `../assets/${item.image}` : "",
                icon: item.icon || "fa-wand-sparkles"
            }))
            .sort(compareEntityLabels);

        state.entities.creature = (Array.isArray(creatures) ? creatures : [])
            .filter((creature) => !window.WikiSpoiler || window.WikiSpoiler.isVisible(creature))
            .map((creature) => {
                const discovered = creature.discovered !== false;
                const label = discovered ? creature.name : (creature.mysteryName || "Creatura Misteriosa");
                return {
                    key: `creature:${slugify(creature.name || label)}`,
                    type: "creature",
                    id: slugify(creature.name || label),
                    label,
                    meta: [creature.category || "Bestiario", creature.details?.dndType].filter(Boolean).join(" | "),
                    url: "bestiario.html",
                    image: creature.image ? `../assets/${creature.image}` : "",
                    icon: "fa-book-dead"
                };
            })
            .sort(compareEntityLabels);
    }

    function setEditorEnabled(enabled) {
        [
            els.noteNewBtn,
            els.noteShared,
            els.noteTitle,
            els.noteDuplicateBtn,
            els.noteDeleteBtn,
            els.noteSaveBtn,
            els.noteEditor
        ].forEach((node) => {
            if (!node) return;
            if (node === els.noteEditor) node.setAttribute("contenteditable", enabled ? "true" : "false");
            else node.disabled = !enabled;
        });

        document.querySelectorAll("[data-format-command], [data-link-type]").forEach((button) => {
            button.disabled = !enabled;
        });
    }

    function normalizeNotes(value) {
        if (!Array.isArray(value)) return [];
        return value
            .filter((note) => note && typeof note === "object")
            .map((note) => ({
                id: String(note.id || createId()),
                title: String(note.title || "Appunto senza titolo"),
                html: sanitizeNoteHtml(note.html || ""),
                links: normalizeLinks(note.links),
                shared: note.shared === true,
                createdAt: note.createdAt || new Date().toISOString(),
                updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
            }));
    }

    function normalizeLinks(links) {
        if (!Array.isArray(links)) return [];
        return links
            .filter((link) => link && typeof link === "object")
            .map((link) => ({
                key: String(link.key || `${link.type}:${link.id}`),
                type: String(link.type || ""),
                id: String(link.id || ""),
                label: String(link.label || link.id || "Voce"),
                url: String(link.url || "#"),
                image: String(link.image || ""),
                icon: String(link.icon || getEntityIcon(link.type))
            }))
            .filter((link) => link.type && link.id);
    }

    function createNote() {
        const now = new Date().toISOString();
        return {
            id: createId(),
            title: "Nuovo appunto",
            html: NOTE_PLACEHOLDER,
            links: [],
            shared: false,
            createdAt: now,
            updatedAt: now
        };
    }

    function createId() {
        return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function getSelectedNote() {
        return state.notes.find((note) => note.id === state.selectedId) || null;
    }

    function buildNoteExcerpt(note) {
        const text = htmlToText(note.html);
        if (text) return text.slice(0, 96);
        if (note.links?.length) return note.links.map((link) => link.label).join(", ").slice(0, 96);
        if (note.shared) return "Blocco condiviso";
        return "Appunto vuoto";
    }

    function sanitizeNoteHtml(html) {
        const template = document.createElement("template");
        template.innerHTML = String(html || NOTE_PLACEHOLDER);
        const allowedTags = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BLOCKQUOTE", "DIV"]);
        const cleanNode = (node) => {
            [...node.childNodes].forEach((child) => {
                if (child.nodeType === Node.TEXT_NODE) return;
                if (child.nodeType !== Node.ELEMENT_NODE || !allowedTags.has(child.tagName)) {
                    child.replaceWith(...child.childNodes);
                    return;
                }
                [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
                cleanNode(child);
            });
        };
        cleanNode(template.content);
        const cleaned = template.innerHTML.trim();
        return cleaned || NOTE_PLACEHOLDER;
    }

    function htmlToText(html) {
        const div = document.createElement("div");
        div.innerHTML = sanitizeNoteHtml(html);
        return (div.textContent || "").replace(/\s+/g, " ").trim();
    }

    function formatDateTime(value) {
        if (!value) return "Mai";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Mai";
        return date.toLocaleString("it-IT", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function formatTime(date) {
        return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    }

    function setStatus(message, type = "info") {
        if (!els.notesSyncStatus) return;
        els.notesSyncStatus.textContent = message;
        els.notesSyncStatus.dataset.status = type;
    }

    const notesStore = {
        async load() {
            const token = getAuthToken();
            if (!token || !state.ownerDiscordId) {
                throw new Error("Login richiesto");
            }

            try {
                const url = new URL(`${getApiBase()}/api/notes`);
                url.searchParams.set("page", NOTES_PAGE_ID);
                url.searchParams.set("ownerDiscordId", state.currentDiscordId);
                if (state.isDm) {
                    url.searchParams.set("targetDiscordId", state.ownerDiscordId);
                }

                const response = await fetch(url.toString(), {
                    method: "GET",
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const responseOwner = String(data?.note?.ownerDiscordId || "").trim();
                if (responseOwner && responseOwner !== state.ownerDiscordId && responseOwner !== state.currentDiscordId) {
                    throw new Error(`Owner appunti inatteso: ${responseOwner}`);
                }
                return parseRemoteNoteContent(data?.note?.content || "");
            } catch (error) {
                console.error("Errore caricamento appunti remoti:", error);
                setStatus("Cloud non raggiungibile, uso copia locale", "error");
            }

            try {
                const raw = window.localStorage.getItem(getLocalStorageKey());
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        },
        async save(notes) {
            if (!canWriteNotes()) {
                throw new Error("Login richiesto");
            }

            const payload = serializeRemoteNoteContent(notes);
            window.localStorage.setItem(getLocalStorageKey(), JSON.stringify(notes, null, 2));

            const token = getAuthToken();
            if (!token) throw new Error("Login richiesto");

            const response = await fetch(`${getApiBase()}/api/notes`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    page: NOTES_PAGE_ID,
                    content: payload,
                    ownerDiscordId: state.currentDiscordId,
                    ...(state.isDm
                        ? {
                            targetDiscordId: state.ownerDiscordId
                        }
                        : {})
                })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json().catch(() => null);
            if (!data?.ok) throw new Error("Risposta API non valida");
        }
    };

    function parseRemoteNoteContent(content) {
        const raw = String(content || "").trim();
        if (!raw) return [];

        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            if (Array.isArray(parsed?.notes)) return parsed.notes;
        } catch (_) {
            // Older/plain notes are converted to one readable rich-text note.
        }

        return [{
            id: createId(),
            title: "Appunto",
            html: `<p>${escapeHtml(raw).replace(/\n/g, "<br>")}</p>`,
            links: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }];
    }

    function serializeRemoteNoteContent(notes) {
        return JSON.stringify({
            version: NOTES_CONTENT_VERSION,
            page: NOTES_PAGE_ID,
            ownerDiscordId: state.currentDiscordId,
            targetDiscordId: state.ownerDiscordId,
            notes
        });
    }

    function getLocalStorageKey() {
        return `${STORAGE_KEY}:${state.ownerDiscordId}:${NOTES_PAGE_ID}`;
    }

    async function loadAccessContext() {
        const [config, players] = await Promise.all([
            fetchJson("../assets/data/next-session.json").catch(() => ({})),
            fetchJson("../assets/data/players.json").catch(() => [])
        ]);

        const dmDiscordId = String(config?.dmDiscordId || "").trim();
        state.isDm = Boolean(dmDiscordId) && state.currentDiscordId === dmDiscordId;

        const ownersById = new Map();
        ownersById.set(state.currentDiscordId, {
            discordId: state.currentDiscordId,
            name: state.isDm ? "DM" : state.currentUsername
        });

        if (state.isDm) {
            (Array.isArray(players) ? players : [])
                .filter((player) => player?.discordId)
                .forEach((player) => {
                    ownersById.set(String(player.discordId).trim(), {
                        discordId: String(player.discordId).trim(),
                        name: player.name || player.id || String(player.discordId).trim()
                    });
                });
        }

        state.owners = [...ownersById.values()]
            .filter((owner) => owner.discordId)
            .sort((a, b) => {
                if (a.discordId === state.currentDiscordId) return -1;
                if (b.discordId === state.currentDiscordId) return 1;
                return String(a.name || "").localeCompare(String(b.name || ""), "it", { sensitivity: "base" });
            });
    }

    function getAuthToken() {
        return typeof window.CriptaDiscordAuth?.getToken === "function"
            ? window.CriptaDiscordAuth.getToken()
            : "";
    }

    async function getVerifiedAuth() {
        return typeof window.CriptaDiscordAuth?.verify === "function"
            ? window.CriptaDiscordAuth.verify().catch(() => null)
            : null;
    }

    function getDiscordId(authState) {
        return String(authState?.user?.id || authState?.user?.sub || "").trim();
    }

    function canUseNotes() {
        return Boolean(state.ownerDiscordId);
    }

    function canWriteNotes() {
        return Boolean(state.ownerDiscordId) && state.ownerDiscordId === state.currentDiscordId;
    }

    function getApiBase() {
        return typeof DISCORD_WORKER_URL === "string"
            ? DISCORD_WORKER_URL
            : "https://sigillo-api.khuzoe.workers.dev";
    }

    async function fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    function compareEntityLabels(a, b) {
        return String(a.label || "").localeCompare(String(b.label || ""), "it", { sensitivity: "base" });
    }

    function compareNotesForList(a, b) {
        const createdDiff = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        if (createdDiff !== 0) return createdDiff;
        return String(b.id || "").localeCompare(String(a.id || ""));
    }

    function getEntityIcon(type) {
        return {
            npc: "fa-skull",
            player: "fa-dice-d20",
            item: "fa-wand-sparkles",
            creature: "fa-book-dead"
        }[type] || "fa-link";
    }

    function renderEntityThumb(entry) {
        const icon = escapeHtml(entry.icon || getEntityIcon(entry.type));
        const label = escapeHtml(entry.label || getEntityTypeLabel(entry.type));
        const image = String(entry.image || "");
        if (image) {
            return `
                <span class="notes-entity-thumb notes-entity-thumb--${escapeHtml(entry.type)}">
                    <img src="${escapeHtml(image)}" alt="${label}" loading="lazy" onerror="this.hidden=true; this.nextElementSibling.hidden=false;">
                    <i class="fas ${icon}" aria-hidden="true" hidden></i>
                </span>
            `;
        }

        return `
            <span class="notes-entity-thumb notes-entity-thumb--${escapeHtml(entry.type)}">
                <i class="fas ${icon}" aria-hidden="true"></i>
            </span>
        `;
    }

    function getNpcThumb(id) {
        const cleanId = slugify(id).replace(/-/g, "_");
        return cleanId ? `../assets/img/creatures/transp/${cleanId}_transp.webp` : "";
    }

    function getEntityTypeLabel(type) {
        return {
            npc: "NPC",
            player: "Giocatore",
            item: "Oggetto",
            creature: "Creatura",
            shared: "Condivisi"
        }[type] || "Voce";
    }

    function normalizeText(value) {
        return String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }

    function slugify(value) {
        return normalizeText(value)
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "voce";
    }

    function structuredCloneSafe(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function toCamel(id) {
        return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    }
})();
