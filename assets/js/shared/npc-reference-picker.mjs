export const NPC_REFERENCE_PAGE_SIZE = 24;
export const npcReferenceKey = npc => `${npc.managedActorWorldId}:${npc.managedActorId}`;
export const normalizeNpcReferenceSearch = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").trim();
export function filterNpcReferences(npcs, { search = "", categoryId = "", kind = "all" } = {}) {
    const terms = normalizeNpcReferenceSearch(search).split(/\s+/).filter(Boolean);
    return npcs.filter(npc => {
        const category = npc.categoryId || "uncategorized";
        if (categoryId && category !== categoryId && npc.categoryGroupId !== categoryId) return false;
        if (kind !== "all" && (npc.kind === "creature" ? "creature" : "person") !== kind) return false;
        const text = normalizeNpcReferenceSearch([npc.name, npc.role, npc.category, npc.categoryGroupName, npc.managedActorWorldId].join(" "));
        return terms.every(term => text.includes(term));
    }).sort((left, right) => String(left.name).localeCompare(String(right.name), "it", { sensitivity: "base", numeric: true }) || npcReferenceKey(left).localeCompare(npcReferenceKey(right)));
}
export function npcReferencePage(npcs, filters = {}, page = 0) {
    const matches = filterNpcReferences(npcs, filters), pages = Math.max(1, Math.ceil(matches.length / NPC_REFERENCE_PAGE_SIZE));
    const current = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pages - 1), start = current * NPC_REFERENCE_PAGE_SIZE;
    return { items: matches.slice(start, start + NPC_REFERENCE_PAGE_SIZE), total: matches.length, pages, page: current, start: matches.length ? start + 1 : 0, end: Math.min(start + NPC_REFERENCE_PAGE_SIZE, matches.length) };
}

export function openNpcReferencePicker({ npcs, references, limit = 3, categories = [], usable, resolveImageUrl, onApply }) {
    if (document.querySelector("[data-npc-reference-picker]")) return;
    const focus = document.activeElement, selected = new Set(references.map(reference => `${reference.worldId}:${reference.actorId}`));
    const catalog = [...new Map(npcs.map(npc => [npcReferenceKey(npc), npc])).values()];
    const dialog = document.createElement("dialog");
    dialog.className = "npc-avatar-generator npc-reference-picker";
    dialog.dataset.npcReferencePicker = "";
    dialog.setAttribute("aria-labelledby", "npc-reference-picker-title");
    dialog.innerHTML = `<header><div><small>RIFERIMENTI VISIVI</small><h2 id="npc-reference-picker-title">Scegli NPC di esempio</h2></div><button type="button" data-picker-close aria-label="Chiudi selezione NPC">×</button></header>
        <div class="npc-reference-picker__filters">
          <label class="npc-reference-picker__search">Cerca NPC<input type="search" data-picker-search placeholder="Nome, ruolo, categoria o mondo" autocomplete="off"></label>
          <label>Categoria<select data-picker-category><option value="">Tutte le categorie</option></select></label>
          <label>Tipo<select data-picker-kind><option value="all">Tutti gli NPC</option><option value="person">Personaggi</option><option value="creature">Creature del Bestiario</option></select></label>
          <button type="button" data-picker-reset>Azzera filtri</button>
        </div>
        <p class="npc-reference-picker__count" data-picker-count role="status" aria-live="polite"></p>
        <div class="npc-reference-picker__results" data-picker-results role="group" aria-label="NPC della campagna"></div>
        <div class="npc-reference-picker__pagination"><button type="button" data-picker-previous>Precedenti</button><span data-picker-page></span><button type="button" data-picker-next>Successivi</button></div>
        <footer><span data-picker-selection role="status" aria-live="polite"></span><div><button type="button" data-picker-clear>Deseleziona tutti</button><button type="button" data-picker-close>Annulla</button><button type="button" class="npc-avatar-generator__confirm" data-picker-apply>Usa riferimenti</button></div></footer>`;
    document.body.appendChild(dialog);
    const el = selector => dialog.querySelector(selector);
    const usedCategories = new Map();
    for (const npc of catalog) usedCategories.set(npc.categoryId || "uncategorized", npc.categoryGroupName && npc.categoryGroupName !== npc.category ? `${npc.categoryGroupName} / ${npc.category}` : npc.category || "Senza categoria");
    for (const category of categories) if (catalog.some(npc => npc.categoryId === category.id || npc.categoryGroupId === category.id)) usedCategories.set(category.id, category.parentName ? `${category.parentName} / ${category.name}` : category.name);
    for (const [id, name] of [...usedCategories].sort((a, b) => a[1].localeCompare(b[1], "it"))) el("[data-picker-category]").add(new Option(name, id));
    let page = 0, closed = false;
    function render() {
        const view = npcReferencePage(catalog, { search: el("[data-picker-search]").value, categoryId: el("[data-picker-category]").value, kind: el("[data-picker-kind]").value }, page);
        page = view.page;
        const root = el("[data-picker-results]"); root.replaceChildren();
        el("[data-picker-count]").textContent = `${view.start}–${view.end} di ${view.total} risultati · ${catalog.length} NPC nella campagna`;
        el("[data-picker-page]").textContent = `Pagina ${page + 1} di ${view.pages}`;
        el("[data-picker-previous]").disabled = page === 0;
        el("[data-picker-next]").disabled = page + 1 >= view.pages;
        el("[data-picker-selection]").textContent = `${selected.size} / ${limit} NPC selezionati`;
        el("[data-picker-clear]").disabled = !selected.size;
        el("[data-picker-apply]").textContent = `Usa riferimenti (${selected.size})`;
        for (const npc of view.items) {
            const id = npcReferenceKey(npc), checked = selected.has(id), avatar = usable(npc, "style"), token = usable(npc, "frame");
            const row = document.createElement("label"); row.className = "npc-reference-picker__card";
            row.classList.toggle("is-selected", checked); row.classList.toggle("is-unavailable", !avatar && !token);
            const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.disabled = !checked && (selected.size >= limit || (!avatar && !token));
            input.dataset.npcReferenceKey = id;
            input.setAttribute("aria-label", `Seleziona ${npc.name}`);
            const image = document.createElement("img"); image.alt = ""; image.loading = "lazy";
            const path = npc.images?.[avatar ? "avatar" : "token"] || npc.images?.avatar;
            if (path) image.src = resolveImageUrl(path); else image.hidden = true;
            const body = document.createElement("div"), title = document.createElement("strong"), category = document.createElement("span"), detail = document.createElement("small");
            title.textContent = npc.name;
            category.textContent = usedCategories.get(npc.categoryId || "uncategorized") || "Senza categoria";
            detail.textContent = [npc.kind === "creature" ? "Creatura" : "Personaggio", npc.archived ? "Archiviato" : "", !avatar && token ? "Solo cornice del token" : !avatar && !token ? "Immagine da salvare sulla wiki" : "", npc.managedActorWorldId].filter(Boolean).join(" · ");
            body.append(title, category, detail);
            input.addEventListener("change", () => {
                if (input.checked) selected.add(id); else selected.delete(id);
                render();
                for (const control of root.querySelectorAll("input")) if (control.dataset.npcReferenceKey === id) control.focus();
            });
            row.append(input, image, body); root.appendChild(row);
        }
        if (!view.total) { const empty = document.createElement("p"); empty.className = "npc-reference-picker__empty"; empty.textContent = "Nessun NPC corrisponde ai filtri. Prova un altro nome o azzera i filtri."; root.appendChild(empty); }
    }
    const updateFilters = () => { page = 0; render(); };
    el("[data-picker-search]").addEventListener("input", updateFilters);
    el("[data-picker-category]").addEventListener("change", updateFilters);
    el("[data-picker-kind]").addEventListener("change", updateFilters);
    el("[data-picker-reset]").addEventListener("click", () => { el("[data-picker-search]").value = ""; el("[data-picker-category]").value = ""; el("[data-picker-kind]").value = "all"; updateFilters(); el("[data-picker-search]").focus(); });
    el("[data-picker-previous]").addEventListener("click", () => { page--; render(); el("[data-picker-results]").scrollTop = 0; });
    el("[data-picker-next]").addEventListener("click", () => { page++; render(); el("[data-picker-results]").scrollTop = 0; });
    el("[data-picker-clear]").addEventListener("click", () => { selected.clear(); render(); });
    function close() { if (closed) return; closed = true; dialog.close(); dialog.remove(); if (focus?.isConnected) focus.focus(); }
    dialog.querySelectorAll("[data-picker-close]").forEach(button => button.addEventListener("click", close));
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    el("[data-picker-apply]").addEventListener("click", () => {
        const next = [];
        for (const reference of references) if (selected.has(`${reference.worldId}:${reference.actorId}`)) next.push({ ...reference });
        for (const npc of catalog) if (selected.has(npcReferenceKey(npc)) && !next.some(reference => reference.worldId === npc.managedActorWorldId && reference.actorId === npc.managedActorId)) next.push({ worldId: npc.managedActorWorldId, actorId: npc.managedActorId, name: npc.name, purpose: usable(npc, "style") ? "style" : "frame", note: "" });
        onApply(next); close();
    });
    render(); dialog.showModal(); el("[data-picker-search]").focus();
    return { close };
}
