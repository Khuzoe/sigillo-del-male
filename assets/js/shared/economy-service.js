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

    function costComponents(value, registry) {
        const map = currencyMap(registry);
        const components = Array.isArray(value?.cost?.components)
            ? value.cost.components
            : Array.isArray(value?.components)
                ? value.components
                : [{ currencyId: value?.price?.denomination || value?.denomination || "gp", amount: value?.price?.value ?? value?.value ?? 0 }];
        return components.filter((entry) => Number(entry?.amount) > 0).map((entry) => {
            const currencyId = String(entry.currencyId || "").trim().toLowerCase();
            const currency = map.get(currencyId) || null;
            const amount = Number(entry.amount) || 0;
            const precision = Math.max(0, Math.min(8, Number(currency?.precision ?? 4)));
            return {
                currencyId,
                currency,
                amount,
                formattedAmount: new Intl.NumberFormat("it-IT", { maximumFractionDigits: precision }).format(amount),
                label: String(currency?.symbol || currency?.name || entry.currencyId || "").trim(),
                icon: String(currency?.icon || "").trim()
            };
        });
    }

    function formatCost(value, registry) {
        return costComponents(value, registry)
            .map((entry) => `${entry.formattedAmount} ${entry.label}`.trim())
            .join(" + ") || "0";
    }

    window.CriptaEconomyService = { load, save, currencies, currencyMap, costComponents, formatCost };
})();
