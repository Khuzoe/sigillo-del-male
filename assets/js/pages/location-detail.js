window.CriptaApp.onPageReady("location", async function () {
    const root = document.getElementById("location-detail-root");
    const title = document.getElementById("location-title");
    const subtitle = document.getElementById("location-subtitle");
    if (!root || !window.CriptaLocations) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "";

    try {
        const locations = await window.CriptaLocations.loadLocations();
        const location = locations.find(entry => entry.id === id)
            || locations.find(entry => window.CriptaLocations.slugify(entry.title) === id);

        if (!location) {
            root.innerHTML = '<p class="locations-state locations-state--error">Luogo non trovato.</p>';
            if (title) title.textContent = "Luogo non trovato";
            if (subtitle) subtitle.textContent = "";
            return;
        }

        document.title = `${location.title} | Luoghi`;
        if (title) title.textContent = location.title;
        if (subtitle) subtitle.textContent = [location.group, window.CriptaLocations.getLocationTypeLabel(location)].filter(Boolean).join(" / ");
        const children = locations
            .filter(entry => entry.parentId === location.id)
            .sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || left.title.localeCompare(right.title, "it"));
        renderLocation(location, children);
    } catch (error) {
        console.error("Errore nel caricamento del luogo:", error);
        root.innerHTML = '<p class="locations-state locations-state--error">Impossibile caricare il luogo.</p>';
    }

    function renderLocation(location, children = []) {
        const type = window.CriptaLocations.getLocationTypeLabel(location);
        const image = window.CriptaLocations.isWebDisplayImage(location.image)
            ? window.CriptaLocations.resolveImageUrl(location.image)
            : "";
        const description = window.CriptaLocations.sanitizeLocationHtml(location.desc)
            || (location.summary ? `<p>${window.CriptaLocations.escapeHtml(location.summary)}</p>` : "");
        const tags = Array.isArray(location.tags) ? location.tags.filter(Boolean) : [];
        const interactive = normalizeInteractiveMap(location);

        root.innerHTML = `
            <article class="location-detail-card">
                <div class="location-detail-main">
                    <aside class="location-detail-image-panel">
                        <div class="location-detail-image-frame ${image ? "" : "location-detail-image-frame--empty"}">
                            ${image
                                ? `<img src="${window.CriptaLocations.escapeHtml(image)}" alt="${window.CriptaLocations.escapeHtml(location.imageAlt || location.title)}">`
                                : '<i class="fas fa-map-location-dot" aria-hidden="true"></i>'}
                        </div>
                        ${image && location.caption ? `<p class="location-detail-caption">${window.CriptaLocations.escapeHtml(location.caption)}</p>` : ""}
                        <div class="location-detail-meta">
                            <span class="location-detail-chip">${window.CriptaLocations.escapeHtml(type)}</span>
                            ${location.group ? `<span class="location-detail-chip">${window.CriptaLocations.escapeHtml(location.group)}</span>` : ""}
                            ${location.source ? `<span class="location-detail-chip">${window.CriptaLocations.escapeHtml(location.source === "foundry-journal" ? "Journal Foundry" : location.source)}</span>` : ""}
                        </div>
                        ${tags.length ? `<div class="location-detail-tags">${tags.map(tag => `<span>${window.CriptaLocations.escapeHtml(tag)}</span>`).join("")}</div>` : ""}
                    </aside>
                    <div class="location-detail-info-panel">
                        ${location.summary ? `<p class="location-detail-summary">${window.CriptaLocations.escapeHtml(location.summary)}</p>` : ""}
                        <div class="location-detail-description chapter-content">
                            ${description || "<p>Nessuna descrizione disponibile.</p>"}
                        </div>
                    </div>
                </div>
                ${children.length ? renderChildrenSection(children) : ""}
                ${interactive ? renderInteractiveMapSection(interactive) : ""}
            </article>
        `;
    }

    function renderChildrenSection(children) {
        return `
            <section class="location-detail-section">
                <h2>Luoghi collegati</h2>
                <div class="location-detail-children">
                    ${children.map(renderChildCard).join("")}
                </div>
            </section>
        `;
    }

    function renderChildCard(location) {
        const type = window.CriptaLocations.getLocationTypeLabel(location);
        const summary = location.summary || stripHtml(location.desc).slice(0, 180);
        return `
            <a class="location-child-card" href="${window.CriptaLocations.buildLocationUrl(location.id)}">
                <span>
                    <strong>${window.CriptaLocations.escapeHtml(location.title)}</strong>
                    <small>${window.CriptaLocations.escapeHtml(type)}</small>
                </span>
                ${summary ? `<p>${window.CriptaLocations.escapeHtml(summary)}</p>` : ""}
            </a>
        `;
    }

    function normalizeInteractiveMap(location) {
        const map = location.interactiveMap || location.map || {};
        const data = map.data || location.mapData || "";
        const image = map.image || location.mapImage || "";
        if (!data || !image) return null;
        return {
            data: String(data),
            image: String(image),
            title: map.title || location.title
        };
    }

    function renderInteractiveMapSection(map) {
        return `
            <section class="location-detail-section">
                <h2>Mappa interattiva</h2>
                <div class="location-detail-map-link">
                    <i class="fas fa-map" aria-hidden="true"></i>
                    <div>
                        <strong>${window.CriptaLocations.escapeHtml(map.title)}</strong>
                        <span>${window.CriptaLocations.escapeHtml(map.data)}</span>
                    </div>
                </div>
            </section>
        `;
    }

    function stripHtml(value) {
        const doc = new DOMParser().parseFromString(String(value || ""), "text/html");
        return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    }
});
