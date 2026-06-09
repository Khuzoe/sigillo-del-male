window.CriptaApp.onPageReady("mappa", async function () {
    const list = document.getElementById("locations-list");
    const count = document.getElementById("locations-count");
    const search = document.getElementById("locations-search");
    const groupFilters = document.getElementById("locations-group-filters");
    const typeFilters = document.getElementById("locations-type-filters");
    const groupToggle = document.getElementById("locations-group-toggle");
    if (!list || !window.CriptaLocations) return;

    const state = {
        locations: [],
        groups: new Set(),
        types: new Set()
    };

    try {
        state.locations = await window.CriptaLocations.loadLocations();
        state.groups = new Set(state.locations.map(location => location.group || "Senza categoria"));
        state.types = new Set(state.locations.map(location => window.CriptaLocations.getLocationTypeLabel(location)));
        renderFilters();
        renderLocations();
        search?.addEventListener("input", renderLocations);
        groupToggle?.addEventListener("change", renderLocations);
    } catch (error) {
        console.error("Errore nel caricamento dei luoghi:", error);
        list.innerHTML = '<p class="locations-state locations-state--error">Impossibile caricare la lista dei luoghi.</p>';
    }

    function renderFilters() {
        renderFilterGroup(groupFilters, Array.from(state.groups).sort((a, b) => a.localeCompare(b, "it")), "group");
        renderFilterGroup(typeFilters, Array.from(state.types).sort((a, b) => a.localeCompare(b, "it")), "type");
    }

    function renderFilterGroup(container, values, key) {
        if (!container) return;
        container.innerHTML = values.map(value => `
            <button class="locations-filter-chip is-active" type="button" data-filter-key="${key}" data-filter-value="${window.CriptaLocations.escapeHtml(value)}" aria-pressed="true">
                ${window.CriptaLocations.escapeHtml(value)}
            </button>
        `).join("");
        container.querySelectorAll(".locations-filter-chip").forEach(button => {
            button.addEventListener("click", () => {
                const active = !button.classList.contains("is-active");
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", active ? "true" : "false");
                renderLocations();
            });
        });
    }

    function getActiveValues(key) {
        return new Set(Array.from(document.querySelectorAll(`.locations-filter-chip.is-active[data-filter-key="${key}"]`))
            .map(button => button.dataset.filterValue || ""));
    }

    function getFilteredLocations() {
        const query = window.CriptaLocations.normalizeText(search?.value || "");
        const activeGroups = getActiveValues("group");
        const activeTypes = getActiveValues("type");
        return state.locations.filter(location => {
            const group = location.group || "Senza categoria";
            const type = window.CriptaLocations.getLocationTypeLabel(location);
            if (!activeGroups.has(group) || !activeTypes.has(type)) return false;
            if (!query) return true;
            const haystack = window.CriptaLocations.normalizeText([
                location.title,
                group,
                type,
                location.summary,
                location.desc,
                ...(location.tags || [])
            ].join(" "));
            return haystack.includes(query);
        });
    }

    function renderLocations() {
        const locations = getFilteredLocations();
        if (count) count.textContent = `${locations.length} ${locations.length === 1 ? "voce" : "voci"}`;
        if (!locations.length) {
            list.innerHTML = '<p class="locations-state">Nessun luogo disponibile con questi filtri.</p>';
            return;
        }

        if (!groupToggle?.checked) {
            list.innerHTML = `<div class="locations-flat-list">${locations.map(renderLocationCard).join("")}</div>`;
            return;
        }

        const groups = groupLocations(locations);
        list.innerHTML = groups.map(group => `
            <section class="npc-category-group location-category-group">
                <header class="npc-category-header">
                    <h2 class="npc-category-title">${window.CriptaLocations.escapeHtml(group.category)}</h2>
                    <span class="npc-category-count">${group.items.length}</span>
                </header>
                <div class="npc-category-list location-category-list">
                    ${group.items.map(renderLocationCard).join("")}
                </div>
            </section>
        `).join("");
    }

    function groupLocations(locations) {
        const groups = new Map();
        locations.forEach(location => {
            const category = location.group || "Senza categoria";
            const key = category.toLocaleLowerCase("it");
            if (!groups.has(key)) groups.set(key, { category, items: [] });
            groups.get(key).items.push(location);
        });
        return Array.from(groups.values()).sort((left, right) => {
            if (left.category === "Senza categoria" && right.category !== "Senza categoria") return 1;
            if (left.category !== "Senza categoria" && right.category === "Senza categoria") return -1;
            return left.category.localeCompare(right.category, "it");
        });
    }

    function renderLocationCard(location) {
        const image = window.CriptaLocations.isWebDisplayImage(location.image)
            ? window.CriptaLocations.resolveImageUrl(location.image)
            : "";
        const type = window.CriptaLocations.getLocationTypeLabel(location);
        const summary = location.summary || trimText(stripHtml(location.desc), 210);
        return `
            <a href="${window.CriptaLocations.buildLocationUrl(location.id)}" class="location-card">
                <div class="location-card-image ${image ? "" : "location-card-image--empty"}">
                    ${image
                        ? `<img src="${window.CriptaLocations.escapeHtml(image)}" alt="${window.CriptaLocations.escapeHtml(location.title)}" loading="lazy">`
                        : '<i class="fas fa-map-location-dot" aria-hidden="true"></i>'}
                </div>
                <div class="location-card-info">
                    <div class="location-card-header">
                        <h3 class="location-card-title">${window.CriptaLocations.escapeHtml(location.title)}</h3>
                        <span class="location-card-type">${window.CriptaLocations.escapeHtml(type)}</span>
                    </div>
                    ${summary ? `<p class="location-card-summary">${window.CriptaLocations.escapeHtml(summary)}</p>` : ""}
                </div>
                <i class="fas fa-chevron-right arrow-icon" aria-hidden="true"></i>
            </a>
        `;
    }

    function stripHtml(value) {
        const doc = new DOMParser().parseFromString(String(value || ""), "text/html");
        return doc.body.textContent || "";
    }

    function trimText(value, maxLength) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
    }
});
