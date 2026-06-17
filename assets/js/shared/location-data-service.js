(function () {
    const TYPE_LABELS = {
        city: "Città",
        region: "Area",
        map: "Mappa",
        plane: "Piano",
        landmark: "Punto d'interesse",
        district: "Distretto",
        shop: "Attività",
        legend: "Leggenda",
        place: "Luogo"
    };

    function escapeHtml(value) {
        return window.CriptaApp.utils.escapeHtml(value);
    }

    function normalizeText(value) {
        return window.CriptaApp.utils.normalizeText(value);
    }

    function slugify(value) {
        return window.CriptaApp.utils.slugify(value, "luogo");
    }

    function isPlaceholderText(value) {
        const normalized = normalizeText(value).trim();
        return !normalized || normalized === "description" || normalized === "flavor text" || normalized === "descrizione" || normalized === "---";
    }

    function isWebDisplayImage(value) {
        const image = String(value || "").trim();
        return /^(https?:|data:|blob:)/i.test(image)
            || image.startsWith("media/")
            || image.startsWith("/media/")
            || image.startsWith("assets/")
            || image.startsWith("../assets/")
            || image.startsWith("../../assets/");
    }

    function resolveImageUrl(path) {
        const value = String(path || "").trim();
        if (!value) return "";
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith("media/")) return window.CriptaApp.urls.api(value);
        if (value.startsWith("/media/")) return window.CriptaApp.urls.api(value.slice(1));
        if (value.startsWith("assets/")) return window.CriptaApp.urls.site(value);
        return new URL(value, window.location.href).toString();
    }

    function getLocationTypeLabel(location) {
        const type = String(location?.type || "place").trim();
        return TYPE_LABELS[type] || "Luogo";
    }

    function normalizeLocation(entry) {
        if (!entry || typeof entry !== "object") return null;
        const title = String(entry.title || entry.name || "").trim();
        const id = String(entry.id || slugify(title)).trim();
        if (!id || !title) return null;
        const summary = String(entry.summary || entry.flavor || "").trim();
        const desc = String(entry.desc || entry.description || entry.contentHtml || "").trim();
        return {
            ...entry,
            id,
            title,
            type: String(entry.type || "place").trim(),
            group: String(entry.group || entry.category || "").trim(),
            summary: isPlaceholderText(summary) ? "" : summary,
            desc: isPlaceholderText(desc) ? "" : desc,
            image: String(entry.image || entry.imagePath || "").trim(),
            tags: Array.isArray(entry.tags) ? entry.tags.map(String).filter(Boolean) : []
        };
    }

    async function loadLocations() {
        let list = [];
        try {
            const payload = await window.CriptaApp?.api?.get?.("api/data/locations");
            if (Array.isArray(payload?.data)) list = payload.data;
        } catch (error) {
            console.warn("Luoghi online non disponibili, uso JSON statico.", error);
        }

        if (!list.length) {
            try {
                const payload = await window.CriptaApp?.data?.json?.("locations.json");
                list = Array.isArray(payload) ? payload : payload?.data;
            } catch (error) {
                console.warn("locations.json non disponibile.", error);
            }
        }

        return (Array.isArray(list) ? list : [])
            .map(normalizeLocation)
            .filter(Boolean)
            .sort((left, right) => left.title.localeCompare(right.title, "it"));
    }

    function buildLocationUrl(id) {
        const target = new URL(`${window.CriptaApp.getBasePath()}pages/locations/location.html`, window.location.href);
        target.searchParams.set("id", String(id || ""));
        const campaignId = window.CriptaApp?.campaigns?.currentId?.();
        if (campaignId && campaignId !== window.CriptaApp?.campaigns?.defaultId) {
            target.searchParams.set("campaign", campaignId);
        }
        return target.toString();
    }

    function sanitizeLocationHtml(html) {
        const raw = String(html || "").trim();
        if (!raw) return "";
        const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
        doc.querySelectorAll("script, style, iframe, object, embed").forEach(node => node.remove());
        doc.querySelectorAll("img").forEach(img => {
            const source = img.getAttribute("src") || "";
            if (!isWebDisplayImage(source)) {
                const figure = img.closest("figure");
                (figure || img).remove();
                return;
            }
            img.setAttribute("src", resolveImageUrl(source));
            img.setAttribute("loading", "lazy");
        });
        doc.querySelectorAll("a").forEach(anchor => {
            anchor.setAttribute("rel", "noopener noreferrer");
        });
        return doc.body.firstElementChild?.innerHTML || "";
    }

    window.CriptaLocations = {
        escapeHtml,
        normalizeText,
        slugify,
        isWebDisplayImage,
        resolveImageUrl,
        getLocationTypeLabel,
        normalizeLocation,
        loadLocations,
        buildLocationUrl,
        sanitizeLocationHtml
    };
})();
