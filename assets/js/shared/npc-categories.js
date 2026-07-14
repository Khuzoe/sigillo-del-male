(() => {
    const cache = new Map();

    function campaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function normalizeId(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80);
    }

    function normalizeCategory(value = {}, index = 0) {
        const input = value && typeof value === "object" ? value : {};
        const name = String(input.name || input.label || "").trim().slice(0, 120);
        const id = normalizeId(input.id || name);
        if (!id || !name) return null;
        const orderValue = Number(input.order);
        const usageValue = Number(input.usageCount);
        const color = /^#[0-9a-f]{6}$/i.test(String(input.color || ""))
            ? String(input.color).toLowerCase()
            : "#b99a45";
        const icon = String(input.icon || "fa-folder-open").replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 64) || "fa-folder-open";
        return {
            id,
            name,
            order: Number.isFinite(orderValue) ? Math.round(orderValue) : ((index + 1) * 10),
            color,
            icon,
            archived: input.archived === true,
            mergedInto: normalizeId(input.mergedInto || ""),
            inferred: input.inferred === true,
            usageCount: Number.isFinite(usageValue) ? Math.max(0, Math.floor(usageValue)) : 0
        };
    }

    function normalizeRegistry(payload = {}) {
        const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;
        const categories = (Array.isArray(raw?.categories) ? raw.categories : [])
            .map(normalizeCategory)
            .filter(Boolean)
            .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "it"));
        return {
            campaignId: String(raw?.campaignId || payload?.campaignId || campaignId()),
            revision: Math.max(0, Math.floor(Number(raw?.revision ?? payload?.revision) || 0)),
            updatedAt: raw?.updatedAt || payload?.updatedAt || null,
            categories
        };
    }

    async function load({ force = false, token = "" } = {}) {
        const id = campaignId();
        if (!force && cache.has(id)) return structuredClone(cache.get(id));
        const authToken = String(token || window.CriptaDiscordAuth?.getToken?.() || "").trim();
        const payload = await window.CriptaApp.api.get("api/npc-categories", {
            cache: false,
            ...(authToken ? { token: authToken } : {})
        });
        const registry = normalizeRegistry(payload);
        cache.set(id, registry);
        return structuredClone(registry);
    }

    async function save(categories, expectedRevision, { token = "" } = {}) {
        const authToken = String(token || window.CriptaDiscordAuth?.getToken?.() || "").trim();
        if (!authToken) throw new Error("Accedi come DM per modificare le categorie.");
        const normalized = (Array.isArray(categories) ? categories : []).map(normalizeCategory).filter(Boolean);
        const payload = await window.CriptaApp.api.post("api/npc-categories", {
            expectedRevision: Math.max(0, Math.floor(Number(expectedRevision) || 0)),
            categories: normalized.map(({ usageCount, inferred, ...category }) => category)
        }, { token: authToken });
        const registry = normalizeRegistry(payload);
        cache.set(campaignId(), registry);
        window.CriptaApp.api.clearCache?.("api/managed-actors");
        return structuredClone(registry);
    }

    function resolve(registry, requestedId, fallbackName = "") {
        const categories = Array.isArray(registry?.categories) ? registry.categories : [];
        const byId = new Map(categories.map((category) => [category.id, category]));
        let id = normalizeId(requestedId || fallbackName);
        const visited = new Set();
        while (id && byId.has(id) && !visited.has(id)) {
            visited.add(id);
            const category = byId.get(id);
            if (!category.mergedInto || !byId.has(category.mergedInto)) return category;
            id = category.mergedInto;
        }
        return byId.get(normalizeId(fallbackName)) || null;
    }

    function clear() {
        cache.delete(campaignId());
    }

    window.CriptaNpcCategories = { clear, load, normalizeCategory, normalizeId, normalizeRegistry, resolve, save };
})();
