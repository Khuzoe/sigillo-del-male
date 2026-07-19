(function () {
    "use strict";

    const API_ROOT = "api/economy";
    let cachedPayload = null;

    function token() {
        return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "").trim();
    }

    async function load(options = {}) {
        if (cachedPayload && !options.force) return structuredClone(cachedPayload);
        const authToken = token();
        const payload = await window.CriptaApp.api.get(API_ROOT, {
            cache: false,
            query: { _: Date.now() },
            ...(authToken ? { token: authToken } : {})
        });
        cachedPayload = payload;
        return structuredClone(payload);
    }

    async function save(registry, expectedVersion, worldId = "") {
        const authToken = token();
        if (!authToken) throw new Error("Accedi per modificare le valute.");
        const payload = await window.CriptaApp.api.post(API_ROOT, {
            registry,
            expectedVersion,
            worldId
        }, { token: authToken });
        cachedPayload = payload;
        window.CriptaApp.api?.clearCache?.(API_ROOT);
        window.dispatchEvent(new CustomEvent("cripta:economy-updated", { detail: payload }));
        return structuredClone(payload);
    }

    function currencies(registry, includeInactive = false) {
        return (Array.isArray(registry?.groups) ? registry.groups : [])
            .flatMap((group) => (Array.isArray(group?.currencies) ? group.currencies : [])
                .filter((currency) => includeInactive || currency.active !== false)
                .map((currency) => ({ ...currency, groupId: group.id, groupName: group.name, conversionMode: group.conversionMode })));
    }

    function currencyMap(registry, includeInactive = true) {
        return new Map(currencies(registry, includeInactive).map((currency) => [currency.id, currency]));
    }

    function formatCost(value, registry) {
        const map = currencyMap(registry);
        const components = Array.isArray(value?.cost?.components)
            ? value.cost.components
            : Array.isArray(value?.components)
                ? value.components
                : [{ currencyId: value?.price?.denomination || value?.denomination || "gp", amount: value?.price?.value ?? value?.value ?? 0 }];
        return components.filter((entry) => Number(entry?.amount) > 0).map((entry) => {
            const currency = map.get(String(entry.currencyId || "").toLowerCase());
            const amount = new Intl.NumberFormat("it-IT", { maximumFractionDigits: Math.max(0, Number(currency?.precision ?? 4)) }).format(Number(entry.amount) || 0);
            return `${amount} ${currency?.symbol || currency?.name || entry.currencyId || ""}`.trim();
        }).join(" + ") || "0";
    }

    window.CriptaEconomyService = { load, save, currencies, currencyMap, formatCost };
})();
