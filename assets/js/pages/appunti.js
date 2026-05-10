(function () {
    const STORAGE_KEY = "cripta-appunti-v1";
    const AUTOSAVE_DELAY = 900;
    const PERIODIC_SAVE_MS = 15000;
    const NOTE_PLACEHOLDER = "<p></p>";
    const NOTES_CONTENT_VERSION = 1;

    const state = {
        pageKey: "",
        notes: [],
        selectedId: "",
        query: "",
        dirty: false,
        saveTimer: null,
        pickerType: "",
        entities: {
            npc: [],
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
        state.pageKey = getCurrentPageKey();

        const [notes] = await Promise.all([
            notesStore.load(),
            loadLinkableEntities()
        ]);

        state.notes = normalizeNotes(notes);
        if (!state.notes.length) state.notes = [createNote()];
        state.selectedId = state.notes[0].id;
        renderAll();
        setStatus(`Pronto: ${state.pageKey}`);

        window.setInterval(() => {
            if (state.dirty) saveNow();
        }, PERIODIC_SAVE_MS);
    }

    function bindElements() {
        [
            "note-new-btn",
            "notes-sync-status",
            "notes-search",
            "notes-list",
            "note-title",
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

        els.notesSearch?.addEventListener("input", (event) => {
            state.query = event.target.value.trim();
            renderNotesList();
        });

        els.notesList?.addEventListener("click", (event) => {
            const button = event.target.closest("[data-note-id]");
            if (!button) return;
            commitEditorToState();
            state.selectedId = button.dataset.noteId;
            renderAll();
        });

        els.noteTitle?.addEventListener("input", () => {
            const note = getSelectedNote();
            if (!note) return;
            note.title = els.noteTitle.value.trim();
            markDirty();
            renderNotesList();
        });

        els.noteEditor?.addEventListener("input", () => {
            const note = getSelectedNote();
            if (!note) return;
            note.html = sanitizeNoteHtml(els.noteEditor.innerHTML);
            markDirty();
            renderNotesList();
        });

        document.querySelectorAll("[data-format-command]").forEach((button) => {
            button.addEventListener("click", () => {
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
            const button = event.target.closest("[data-remove-link]");
            if (!button) return;
            const note = getSelectedNote();
            if (!note) return;
            note.links = (note.links || []).filter((link) => link.key !== button.dataset.removeLink);
            markDirty();
            renderLinks(note);
        });

        els.notesPickerSearch?.addEventListener("input", renderPickerResults);
        els.notesPickerResults?.addEventListener("click", (event) => {
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

    function renderNotesList() {
        const query = normalizeText(state.query);
        const notes = state.notes
            .filter((note) => {
                if (!query) return true;
                return normalizeText([note.title, htmlToText(note.html), ...(note.links || []).map((link) => link.label)].join(" ")).includes(query);
            })
            .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

        if (!notes.length) {
            els.notesList.innerHTML = '<p class="notes-empty">Nessun appunto trovato.</p>';
            return;
        }

        els.notesList.innerHTML = notes.map((note) => `
            <button class="notes-list-item ${note.id === state.selectedId ? "is-active" : ""}" type="button" data-note-id="${escapeHtml(note.id)}">
                <strong>${escapeHtml(note.title || "Appunto senza titolo")}</strong>
                <span>${escapeHtml(buildNoteExcerpt(note))}</span>
                <em>${escapeHtml(formatDateTime(note.updatedAt))}</em>
            </button>
        `).join("");
    }

    function renderEditor() {
        const note = getSelectedNote();
        setEditorEnabled(Boolean(note));
        if (!note) return;
        els.noteTitle.value = note.title || "";
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
                    <i class="fas ${escapeHtml(getEntityIcon(link.type))}" aria-hidden="true"></i>
                    <span>${escapeHtml(link.label)}</span>
                </a>
                <button type="button" data-remove-link="${escapeHtml(link.key)}" aria-label="Rimuovi collegamento ${escapeHtml(link.label)}">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
            </span>
        `).join("");
    }

    function createAndSelectNote() {
        commitEditorToState();
        const note = createNote();
        state.notes.unshift(note);
        state.selectedId = note.id;
        markDirty();
        renderAll();
        els.noteTitle?.focus();
    }

    function duplicateSelectedNote() {
        const note = getSelectedNote();
        if (!note) return;
        commitEditorToState();
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
        markDirty();
        renderAll();
    }

    function deleteSelectedNote() {
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

    function commitEditorToState() {
        const note = getSelectedNote();
        if (!note) return;
        note.title = els.noteTitle?.value.trim() || note.title || "Appunto senza titolo";
        note.html = sanitizeNoteHtml(els.noteEditor?.innerHTML || "");
        note.updatedAt = new Date().toISOString();
    }

    function markDirty() {
        const note = getSelectedNote();
        if (note) note.updatedAt = new Date().toISOString();
        state.dirty = true;
        setStatus("Modifiche non salvate");
        window.clearTimeout(state.saveTimer);
        state.saveTimer = window.setTimeout(saveNow, AUTOSAVE_DELAY);
    }

    async function saveNow() {
        window.clearTimeout(state.saveTimer);
        commitEditorToState();
        try {
            await notesStore.save(state.notes);
            state.dirty = false;
            setStatus(`Salvato ${formatTime(new Date())}`);
            renderNotesList();
            const note = getSelectedNote();
            if (note) els.noteUpdatedAt.textContent = `Ultima modifica: ${formatDateTime(note.updatedAt)}`;
        } catch (error) {
            console.error("Errore salvataggio appunti:", error);
            setStatus("Errore salvataggio", "error");
        }
    }

    function openPicker(type) {
        state.pickerType = type;
        const titleMap = {
            npc: "Collega NPC",
            item: "Collega oggetto",
            creature: "Collega creatura"
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
            <button class="notes-picker-result" type="button" data-picker-key="${escapeHtml(entry.key)}">
                <i class="fas ${escapeHtml(getEntityIcon(entry.type))}" aria-hidden="true"></i>
                <span>
                    <strong>${escapeHtml(entry.label)}</strong>
                    <em>${escapeHtml(entry.meta || getEntityTypeLabel(entry.type))}</em>
                </span>
            </button>
        `).join("");
    }

    function attachEntity(key) {
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
            url: entry.url
        });
        markDirty();
        renderLinks(note);
        closePicker();
    }

    async function loadLinkableEntities() {
        const [searchIndex, items, creatures] = await Promise.all([
            fetchJson("../assets/data/search-index.json").catch(() => ({ items: [] })),
            fetchJson("../assets/data/items.json").catch(() => []),
            fetchJson("../assets/data/bestiary.json").catch(() => [])
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
                url: `characters/character.html?id=${encodeURIComponent(entry.entityId || "")}`
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
                url: `oggetti.html#${encodeURIComponent(item.id || slugify(item.name))}`
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
                    url: "bestiario.html"
                };
            })
            .sort(compareEntityLabels);
    }

    function setEditorEnabled(enabled) {
        [
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
                url: String(link.url || "#")
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
            if (token) {
                try {
                    const response = await fetch(`${getApiBase()}/api/notes?page=${encodeURIComponent(state.pageKey)}`, {
                        method: "GET",
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const data = await response.json();
                    return parseRemoteNoteContent(data?.note?.content || "");
                } catch (error) {
                    console.error("Errore caricamento appunti remoti:", error);
                    setStatus("Cloud non raggiungibile, uso copia locale", "error");
                }
            }

            try {
                const raw = window.localStorage.getItem(getLocalStorageKey());
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        },
        async save(notes) {
            const payload = serializeRemoteNoteContent(notes);
            window.localStorage.setItem(getLocalStorageKey(), JSON.stringify(notes, null, 2));

            const token = getAuthToken();
            if (token) {
                const response = await fetch(`${getApiBase()}/api/notes`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        page: state.pageKey,
                        content: payload
                    })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json().catch(() => null);
                if (!data?.ok) throw new Error("Risposta API non valida");
            }
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
            page: state.pageKey,
            notes
        });
    }

    function getCurrentPageKey() {
        const params = new URLSearchParams(window.location.search);
        const explicitPage = params.get("page");
        if (explicitPage) return slugify(explicitPage);

        const path = window.location.pathname.split("/").pop() || "appunti";
        return slugify(path.replace(/\.html$/i, "")) || "appunti";
    }

    function getLocalStorageKey() {
        return `${STORAGE_KEY}:${state.pageKey}`;
    }

    function getAuthToken() {
        return typeof window.CriptaDiscordAuth?.getToken === "function"
            ? window.CriptaDiscordAuth.getToken()
            : "";
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

    function getEntityIcon(type) {
        return {
            npc: "fa-skull",
            item: "fa-wand-sparkles",
            creature: "fa-book-dead"
        }[type] || "fa-link";
    }

    function getEntityTypeLabel(type) {
        return {
            npc: "NPC",
            item: "Oggetto",
            creature: "Creatura"
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
