window.CriptaApp.onPageReady("mappa", () => {
    const panel = document.querySelector("[data-foundry-map-panel]");
    if (!panel) return;
    const scope = window.CriptaApp.createPageScope("mappa:foundry-snapshots");
    const status = panel.querySelector("[data-map-status]");
    const login = panel.querySelector("[data-map-login]");
    const select = panel.querySelector("[data-map-select]");
    const dm = panel.querySelector("[data-map-dm]");
    const full = panel.querySelector("[data-map-full]");
    const image = panel.querySelector("[data-map-image]");
    const query = new URLSearchParams(location.search).get("scena");
    let url, maps, pending, requestId = 0;

    const fetchMap = async (suffix = "") => {
        const token = window.CriptaApp.auth.getToken();
        if (!token) {
            login.hidden = false;
            throw new Error("Accedi al sito per vedere le mappe della campagna.");
        }
        const response = await fetch(window.CriptaApp.urls.api("api/foundry-maps" + suffix), {
            signal: scope.signal, cache: "no-store", headers: { Authorization: "Bearer " + token },
        });
        if (!response.ok) {
            if (response.status === 401) login.hidden = false;
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || "Mappe temporaneamente non disponibili.");
        }
        return response;
    };
    const clearImage = () => {
        full.hidden = true;
        if (url) URL.revokeObjectURL(url);
        url = null;
        full.removeAttribute("href");
        image.removeAttribute("src");
    };
    scope.signal.addEventListener("abort", clearImage, { once: true });
    async function render() {
        const selection = maps.find(map => map.worldId + "/" + map.sceneId === select.value);
        if (!selection) return;
        const id = ++requestId;
        clearImage();
        status.textContent = "Caricamento della mappa…";
        try {
            const path = "/" + encodeURIComponent(selection.worldId) + "/" + encodeURIComponent(selection.sceneId);
            const response = await fetchMap(path + (dm.checked ? "?view=dm" : ""));
            const blob = await response.blob();
            if (id !== requestId || scope.signal.aborted) return;
            url = URL.createObjectURL(blob);
            full.href = image.src = url;
            image.alt = selection.title;
            full.hidden = false;
            status.textContent = (dm.checked ? "Vista DM" : "Vista giocatori") + " · " + new Date(selection.updatedAt).toLocaleString("it-IT");
        } catch (error) { if (id === requestId && !scope.signal.aborted) status.textContent = error.message; }
    }
    async function load() {
        if (pending || maps) return;
        pending = true;
        status.textContent = "Caricamento delle scene…";
        try {
            const result = await (await fetchMap()).json();
            if (scope.signal.aborted) return;
            maps = result.maps;
            if (!maps.length) { status.textContent = "Nessuna mappa pubblicata in questa campagna."; return; }
            for (const map of maps) select.add(new Option(map.title, map.worldId + "/" + map.sceneId));
            panel.querySelector("[data-map-controls]").hidden = false;
            panel.querySelector("[data-map-dm-control]").hidden = !result.canReadDm;
            if (query) {
                if (![...select.options].some(option => option.value === query)) {
                    status.textContent = "La scena del collegamento non è pubblicata in questa campagna.";
                    return;
                }
                select.value = query;
            }
            await render();
        } catch (error) { if (!scope.signal.aborted) status.textContent = error.message; }
        finally { pending = false; }
    }
    scope.listen(panel, "toggle", () => { if (panel.open) void load(); });
    scope.listen(login, "click", () => window.CriptaApp.auth.promptDeviceLogin());
    scope.listen(select, "change", render);
    scope.listen(dm, "change", render);
    if (query) {
        panel.open = true;
        void load();
    }
});
