(function () {
    "use strict";

    const API = window.CriptaEconomyService;
    const S = {
        payload: null,
        draft: null,
        editing: false,
        dirty: false,
        saving: false,
        leaveGuard: null,
        iconFiles: new Map(),
        iconPreviews: new Map()
    };
    let root;

    window.CriptaApp.onPageReady("economia", init);

    async function init() {
        root = document.getElementById("economy-root");
        if (!root) return;
        if (!root.dataset.bound) {
            root.dataset.bound = "true";
            root.addEventListener("click", onClick);
            root.addEventListener("input", onInput);
            root.addEventListener("change", onInput);
        }
        S.leaveGuard?.();
        S.leaveGuard = window.CriptaApp.navigation?.addLeaveGuard?.("economy-editor", () => S.dirty ? ({
            active: true,
            message: "Hai modifiche non salvate nelle valute. Continuare senza salvarle?",
            discard: () => { S.dirty = false; }
        }) : null);
        await reload();
    }

    async function reload(force = false) {
        clearPendingIcons();
        try {
            S.payload = await API.load({ force });
            S.draft = clone(S.payload.registry);
            S.editing = false;
            S.dirty = false;
            render();
        } catch (error) {
            console.error("Registro valute non disponibile", error);
            root.innerHTML = `<div class="economy-error"><i class="fa-solid fa-triangle-exclamation"></i><h1>Il registro non si è aperto</h1><p>${esc(error?.message || error)}</p><button data-action="reload">Riprova</button></div>`;
        }
    }

    function render() {
        const registry = S.draft || { groups: [] };
        const groups = Array.isArray(registry.groups) ? registry.groups : [];
        const activeCount = API.currencies(registry).length;
        const archivedCount = API.currencies(registry, true).filter((currency) => currency.active === false).length;
        root.innerHTML = `
            <header class="economy-hero archive-hero archive-hero--economy">
                <div class="archive-hero__copy">
                    <div class="archive-hero__eyebrow"><span></span>Regole del mondo</div>
                    <h1>Economia</h1>
                    <div class="archive-hero__meta">
                        <span><i class="fa-solid fa-coins"></i>${activeCount} ${activeCount === 1 ? "valuta attiva" : "valute attive"}</span>
                        <span><i class="fa-solid fa-layer-group"></i>${groups.length} ${groups.length === 1 ? "gruppo" : "gruppi"}</span>
                    </div>
                </div>
                <div class="archive-hero__sigil" aria-hidden="true"><span class="archive-hero__orbit"></span><span class="archive-hero__emblem"><i class="fa-solid fa-scale-balanced"></i></span></div>
            </header>
            <section class="economy-toolbar">
                <div><span>Registro condiviso</span><strong>${S.editing ? "Configurazione valute" : "Valute della campagna"}</strong></div>
                <div class="economy-toolbar__actions">
                    ${S.editing ? `
                        <button class="economy-button economy-button--quiet" data-action="cancel" ${S.saving ? "disabled" : ""}><i class="fa-solid fa-xmark"></i>Annulla</button>
                        <button class="economy-button economy-button--primary" data-action="save" ${S.saving ? "disabled" : ""}><i class="fa-solid ${S.saving ? "fa-spinner fa-spin" : "fa-floppy-disk"}"></i>${S.saving ? "Salvataggio…" : "Salva valute"}</button>
                    ` : S.payload?.permissions?.canEdit ? '<button class="economy-button economy-button--primary" data-action="edit"><i class="fa-solid fa-sliders"></i>Configura</button>' : ""}
                </div>
            </section>
            ${S.editing ? renderEditor(groups) : renderDirectory(groups)}
            ${archivedCount && !S.editing ? `<p class="economy-archive-note"><i class="fa-solid fa-box-archive"></i>${archivedCount} ${archivedCount === 1 ? "valuta archiviata resta" : "valute archiviate restano"} disponibile per i dati esistenti.</p>` : ""}
        `;
    }

    function renderDirectory(groups) {
        return `<div class="economy-directory">${groups.map((group) => {
            const currencies = (group.currencies || []).filter((currency) => currency.active !== false).sort(sortCurrency);
            if (!currencies.length) return "";
            return `<section class="economy-group-card">
                <header><div><span>${group.conversionMode === "automatic" ? "Cambio automatico" : "Valute indipendenti"}</span><h2>${esc(group.name)}</h2></div><i class="fa-solid ${group.conversionMode === "automatic" ? "fa-arrows-rotate" : "fa-coins"}"></i></header>
                <div class="economy-currency-grid">${currencies.map((currency) => renderCurrencyCard(currency, group)).join("")}</div>
            </section>`;
        }).join("") || '<div class="economy-empty"><i class="fa-solid fa-coins"></i><strong>Nessuna valuta configurata</strong></div>'}</div>`;
    }

    function renderCurrencyCard(currency, group) {
        const base = currency.id === group.baseCurrencyId;
        const relative = group.conversionMode === "automatic"
            ? base ? "Unità di base" : `Vale ${format(currency.factor)} unità base`
            : "Saldo indipendente";
        return `<article class="economy-currency-card" style="--currency-accent:${safeColor(currency.color)}">
            <span class="economy-currency-card__coin">${currencyIconMarkup(currency, "card")}</span>
            <div><span>${esc(currency.symbol)}</span><h3>${esc(currency.name)}</h3><p>${esc(relative)}</p></div>
            ${base && group.conversionMode === "automatic" ? '<em>Base</em>' : ""}
        </article>`;
    }

    function renderEditor(groups) {
        return `<div class="economy-editor">
            ${groups.map((group) => renderGroupEditor(group)).join("")}
            <button class="economy-add-group" data-action="add-group"><i class="fa-solid fa-layer-group"></i><span><strong>Nuovo gruppo</strong><small>Per valute indipendenti o con un proprio cambio.</small></span></button>
        </div>`;
    }

    function renderGroupEditor(group) {
        const currencies = Array.isArray(group.currencies) ? group.currencies : [];
        return `<section class="economy-group-editor" data-group-card="${esc(group.id)}">
            <header class="economy-group-editor__head">
                <label><span>Nome del gruppo</span><input type="text" maxlength="60" value="${esc(group.name)}" data-group-id="${esc(group.id)}" data-field="group-name"></label>
                <label><span>Rapporto tra valute</span><select data-group-id="${esc(group.id)}" data-field="conversion-mode"><option value="none" ${group.conversionMode !== "automatic" ? "selected" : ""}>Indipendenti</option><option value="automatic" ${group.conversionMode === "automatic" ? "selected" : ""}>Cambio automatico</option></select></label>
                ${currencies.length ? `<label><span>Unità di base</span><select data-group-id="${esc(group.id)}" data-field="base-currency">${currencies.map((currency) => `<option value="${esc(currency.id)}" ${currency.id === group.baseCurrencyId ? "selected" : ""}>${esc(currency.name)} (${esc(currency.symbol)})</option>`).join("")}</select></label>` : ""}
            </header>
            <div class="economy-currency-editor-list">${currencies.map((currency) => renderCurrencyEditor(currency, group)).join("")}</div>
            <button class="economy-inline-add" data-action="add-currency" data-group-id="${esc(group.id)}"><i class="fa-solid fa-plus"></i>Aggiungi valuta</button>
        </section>`;
    }

    function renderCurrencyEditor(currency, group) {
        const archived = currency.active === false;
        return `<article class="economy-currency-editor ${archived ? "is-archived" : ""}">
            <div class="economy-icon-field">
                <span>Icona</span>
                <button type="button" class="economy-icon-picker" data-action="choose-icon" data-currency-id="${esc(currency.id)}" title="Scegli icona">${currencyIconMarkup(currency, "editor")}</button>
                <input type="file" accept="image/*" data-icon-input data-currency-id="${esc(currency.id)}" hidden>
                ${currency.icon || S.iconFiles.has(currency.id) ? `<button type="button" class="economy-icon-remove" data-action="remove-icon" data-currency-id="${esc(currency.id)}" title="Rimuovi icona"><i class="fa-solid fa-xmark"></i></button>` : ""}
            </div>
            <div class="economy-currency-editor__identity"><span class="economy-dot" style="--currency-accent:${safeColor(currency.color)}"></span><code>${esc(currency.id)}</code>${archived ? "<em>Archiviata</em>" : ""}</div>
            <label><span>Nome</span><input type="text" maxlength="60" value="${esc(currency.name)}" data-group-id="${esc(group.id)}" data-currency-id="${esc(currency.id)}" data-field="currency-name"></label>
            <label><span>Sigla</span><input type="text" maxlength="16" value="${esc(currency.symbol)}" data-group-id="${esc(group.id)}" data-currency-id="${esc(currency.id)}" data-field="currency-symbol"></label>
            <label><span>Valore relativo</span><input type="number" min="0.0001" step="any" value="${esc(currency.factor)}" data-group-id="${esc(group.id)}" data-currency-id="${esc(currency.id)}" data-field="currency-factor"></label>
            <label><span>Decimali</span><input type="number" min="0" max="4" step="1" value="${esc(currency.precision)}" data-group-id="${esc(group.id)}" data-currency-id="${esc(currency.id)}" data-field="currency-precision"></label>
            <label class="economy-color-field"><span>Colore</span><input type="color" value="${safeColor(currency.color)}" data-group-id="${esc(group.id)}" data-currency-id="${esc(currency.id)}" data-field="currency-color"></label>
            <button class="economy-archive-button" data-action="toggle-currency" data-group-id="${esc(group.id)}" data-currency-id="${esc(currency.id)}" title="${archived ? "Ripristina" : "Archivia"}"><i class="fa-solid ${archived ? "fa-rotate-left" : "fa-box-archive"}"></i></button>
        </article>`;
    }

    async function onClick(event) {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const action = button.dataset.action;
        if (action === "reload") return reload(true);
        if (action === "edit") {
            clearPendingIcons();
            S.draft = clone(S.payload.registry);
            S.editing = true;
            S.dirty = false;
            return render();
        }
        if (action === "cancel") {
            clearPendingIcons();
            S.draft = clone(S.payload.registry);
            S.editing = false;
            S.dirty = false;
            return render();
        }
        if (action === "add-group") return addGroup();
        if (action === "add-currency") return addCurrency(button.dataset.groupId);
        if (action === "toggle-currency") return toggleCurrency(button.dataset.groupId, button.dataset.currencyId);
        if (action === "choose-icon") {
            root.querySelector(`[data-icon-input][data-currency-id="${CSS.escape(button.dataset.currencyId)}"]`)?.click();
            return;
        }
        if (action === "remove-icon") return removeCurrencyIcon(button.dataset.currencyId);
        if (action === "save") return save();
    }

    function onInput(event) {
        const iconInput = event.target.closest("[data-icon-input]");
        if (iconInput) {
            if (event.type === "change" && iconInput.files?.[0]) {
                setCurrencyIcon(iconInput.dataset.currencyId, iconInput.files[0]);
            }
            return;
        }
        const input = event.target.closest("[data-field]");
        if (!input || !S.editing) return;
        const group = S.draft.groups.find((candidate) => candidate.id === input.dataset.groupId);
        if (!group) return;
        const field = input.dataset.field;
        if (field === "group-name") group.name = input.value;
        if (field === "conversion-mode") group.conversionMode = input.value === "automatic" ? "automatic" : "none";
        if (field === "base-currency") group.baseCurrencyId = input.value;
        const currency = group.currencies.find((candidate) => candidate.id === input.dataset.currencyId);
        if (currency) {
            if (field === "currency-name") currency.name = input.value;
            if (field === "currency-symbol") currency.symbol = input.value;
            if (field === "currency-factor") currency.factor = Math.max(0.0001, Number(input.value) || 1);
            if (field === "currency-precision") currency.precision = Math.max(0, Math.min(4, Math.floor(Number(input.value) || 0)));
            if (field === "currency-color") currency.color = safeColor(input.value);
        }
        S.dirty = true;
        if (["conversion-mode", "base-currency", "currency-color"].includes(field)) render();
    }

    function addGroup() {
        const groupId = uniqueId("group", S.draft.groups.map((group) => group.id));
        const currencyId = uniqueCurrencyId();
        S.draft.groups.push({
            id: groupId, name: "Nuovo gruppo", conversionMode: "none", baseCurrencyId: currencyId, order: 0,
            currencies: [newCurrency(currencyId)]
        });
        S.dirty = true;
        render();
        root.querySelector(`[data-group-id="${CSS.escape(groupId)}"][data-field="group-name"]`)?.focus();
    }

    function addCurrency(groupId) {
        const group = S.draft.groups.find((candidate) => candidate.id === groupId);
        if (!group) return;
        const currencyId = uniqueCurrencyId();
        group.currencies.push(newCurrency(currencyId));
        if (!group.baseCurrencyId) group.baseCurrencyId = currencyId;
        S.dirty = true;
        render();
        root.querySelector(`[data-currency-id="${CSS.escape(currencyId)}"][data-field="currency-name"]`)?.focus();
    }

    function newCurrency(id) {
        return {
            id, name: "Nuova valuta", symbol: "NV", factor: 1, precision: 0, order: 0,
            color: "#d8a94d", icon: "", active: true,
            storage: { kind: "flag", path: `flags.khuzoe-merchant.wallet.${id}` }
        };
    }

    function toggleCurrency(groupId, currencyId) {
        const currency = S.draft.groups.find((group) => group.id === groupId)?.currencies.find((entry) => entry.id === currencyId);
        if (!currency) return;
        currency.active = currency.active === false;
        S.dirty = true;
        render();
    }

    async function save() {
        if (S.saving) return;
        S.saving = true;
        render();
        try {
            await uploadPendingIcons();
            const payload = await API.save(S.draft, S.payload.version, S.payload.worldId);
            S.payload = payload;
            S.draft = clone(payload.registry);
            clearPendingIcons();
            S.dirty = false;
            S.editing = false;
            toast("Valute aggiornate. Foundry riceverà la modifica in automatico.");
        } catch (error) {
            if (Number(error?.status) === 409) toast("Il registro è cambiato: ricaricalo prima di salvare.", true);
            else toast(error?.message || "Salvataggio non riuscito.", true);
        } finally {
            S.saving = false;
            render();
        }
    }

    function findCurrency(currencyId) {
        for (const group of Array.isArray(S.draft?.groups) ? S.draft.groups : []) {
            const currency = (Array.isArray(group?.currencies) ? group.currencies : [])
                .find((candidate) => candidate.id === currencyId);
            if (currency) return currency;
        }
        return null;
    }

    function setCurrencyIcon(currencyId, file) {
        if (!file?.type?.startsWith("image/")) {
            toast("Scegli un file immagine.", true);
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            toast("L'immagine supera 8 MB.", true);
            return;
        }
        const currency = findCurrency(currencyId);
        if (!currency) return;
        revokePreview(currencyId);
        S.iconFiles.set(currencyId, file);
        S.iconPreviews.set(currencyId, URL.createObjectURL(file));
        S.dirty = true;
        render();
    }

    function removeCurrencyIcon(currencyId) {
        const currency = findCurrency(currencyId);
        if (!currency) return;
        revokePreview(currencyId);
        S.iconFiles.delete(currencyId);
        currency.icon = "";
        S.dirty = true;
        render();
    }

    async function uploadPendingIcons() {
        if (!S.iconFiles.size) return;
        if (!window.CriptaMedia?.uploadBlob) throw new Error("Il servizio immagini non ? disponibile.");
        for (const [currencyId, file] of S.iconFiles) {
            const currency = findCurrency(currencyId);
            if (!currency) continue;
            const blob = await createCurrencyIconBlob(file);
            const uploaded = await window.CriptaMedia.uploadBlob(blob, {
                folder: "economy/currencies",
                fileName: `${currencyId}.webp`,
                type: "image/webp"
            });
            currency.icon = uploaded.path;
        }
    }

    async function createCurrencyIconBlob(file) {
        const image = await loadImage(file);
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = Math.max(0, (image.naturalWidth - size) / 2);
        const sourceY = Math.max(0, (image.naturalHeight - size) / 2);
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d", { alpha: true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, sourceX, sourceY, size, size, 0, 0, 128, 128);
        return new Promise((resolve, reject) => canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error("Conversione dell'icona non riuscita.")),
            "image/webp",
            0.9
        ));
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Immagine non leggibile."));
            };
            image.src = url;
        });
    }

    function currencyIconMarkup(currency, context) {
        const url = currencyIconUrl(currency);
        if (url) return `<img src="${esc(url)}" alt="" loading="${context === "card" ? "lazy" : "eager"}">`;
        if (context === "editor") return `<span>${esc(String(currency.symbol || currency.id).slice(0, 3))}</span>`;
        return '<i class="fa-solid fa-coins"></i>';
    }

    function currencyIconUrl(currency) {
        const preview = S.iconPreviews.get(currency.id);
        if (preview) return preview;
        if (!currency.icon) return "";
        const resolved = window.CriptaMedia?.resolveUrl
            ? window.CriptaMedia.resolveUrl(currency.icon)
            : String(currency.icon);
        return window.CriptaMedia?.appendVersion
            ? window.CriptaMedia.appendVersion(resolved, S.payload?.registry?.revision || S.payload?.version)
            : resolved;
    }

    function revokePreview(currencyId) {
        const preview = S.iconPreviews.get(currencyId);
        if (preview) URL.revokeObjectURL(preview);
        S.iconPreviews.delete(currencyId);
    }

    function clearPendingIcons() {
        for (const currencyId of S.iconPreviews.keys()) revokePreview(currencyId);
        S.iconFiles.clear();
    }

    function uniqueCurrencyId() {
        return uniqueId("currency", API.currencies(S.draft, true).map((currency) => currency.id));
    }

    function uniqueId(prefix, used) {
        const set = new Set(used);
        let id;
        do id = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        while (set.has(id));
        return id.slice(0, 40);
    }

    function sortCurrency(left, right) {
        return Number(right.order || 0) - Number(left.order || 0) || String(left.name).localeCompare(String(right.name), "it");
    }

    function safeColor(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : "#d8a94d";
    }

    function format(value) {
        return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 }).format(Number(value) || 0);
    }

    function toast(message, error = false) {
        const host = document.getElementById("economy-toasts");
        if (!host) return;
        const node = document.createElement("div");
        node.className = `economy-toast ${error ? "is-error" : ""}`;
        node.innerHTML = `<i class="fa-solid ${error ? "fa-triangle-exclamation" : "fa-circle-check"}"></i><span>${esc(message)}</span>`;
        host.appendChild(node);
        window.setTimeout(() => node.remove(), 4200);
    }

    function clone(value) {
        return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
    }

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
    }
})();
