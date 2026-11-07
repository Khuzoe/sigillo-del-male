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

    function normalizeRosterSection(value) {
        return String(value || "").trim().toLowerCase() === "other" ? "other" : "npc";
    }

    function isUncategorized(category = {}) {
        if (category.parentId) return false;
        const key = normalizeId(category.name || category.label || category.id).replace(/_/g, "-");
        return ["altri", "altri-npc", "senza-categoria"].includes(key);
    }

    function normalizeAssignment(registry, categoryId, categoryName = "") {
        const resolved = resolve(registry, categoryId, categoryName);
        if (isUncategorized(resolved || { id: categoryId, name: categoryName })) return { categoryId: "", category: "" };
        return { categoryId: normalizeId(resolved?.id || categoryId || categoryName), category: String(resolved?.name || categoryName).trim() };
    }

    function normalizeCategory(value = {}, index = 0) {
        const input = value && typeof value === "object" ? value : {};
        const originalName = String(input.name || input.label || "").trim().slice(0, 120);
        const name = isUncategorized(input) ? "Senza categoria" : originalName;
        const id = normalizeId(input.id || originalName);
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
            parentId: normalizeId(input.parentId || ""),
            order: Number.isFinite(orderValue) ? Math.round(orderValue) : ((index + 1) * 10),
            color,
            icon,
            rosterSection: normalizeRosterSection(input.rosterSection),
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

    window.CriptaNpcCategories = { clear, isUncategorized, load, normalizeAssignment, normalizeCategory, normalizeId, normalizeRegistry, normalizeRosterSection, resolve, save };
})();
