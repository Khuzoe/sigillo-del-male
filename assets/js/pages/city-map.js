window.CriptaApp.onPageReady("city-map", () => {
    const root = document.querySelector("[data-city-map]");
    if (!root) return;
    const app = window.CriptaApp;
    const scope = app.createPageScope("city-map");
    const el = name => root.querySelector("[data-city-" + name + "]");
    const params = new URLSearchParams(location.search);
    const mapId = params.get("mappa");
    const byScene = params.get("da-scena");
    const sourceScene = params.get("origine");
    const previewQuery = params.get("view") === "player" ? "?view=player" : "";
    const status = el("status");
    const base = "api/city-maps";
    const mapPath = base + "/" + encodeURIComponent(mapId || "");
    const pointPath = id => mapPath + "/points/" + encodeURIComponent(id);
    const form = name => el(name).elements;
    const mapForm = form("map-form");
    const pointForm = form("point-form");
    const noteForm = form("note-form");
    const createForm = form("create-form");
    const stage = el("stage");
    const image = el("image");
    const viewport = el("viewport");
    const audiences = { personal: "Solo io", group: "Gruppo", dm: "Solo DM" };
    let map, points = [], selected, draft, editingNote, canEdit, preview;
    let scenes = [], locations = [], choices, loadingNotes = 0;
    let imageUrl, imageKey, zoom = 1, placing = false, movingPin, panning;
    const busy = new WeakSet();

    function pageUrl(path, values = {}) {
        const target = new URL(path, location.href);
        target.searchParams.set("campaign", app.campaigns.currentId());
        if (params.has("embed")) target.searchParams.set("embed", "1");
        for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
        return target.href;
    }

    function setStatus(message) { status.textContent = message; }

    async function request(path, method = "GET", body) {
        const token = app.auth.getToken();
        if (!token) {
            el("login").hidden = false;
            throw new Error("Accedi con il tuo account per vedere le mappe della campagna.");
        }
        const headers = { Authorization: "Bearer " + token };
        if (body && !(body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(body);
        }
        const response = await fetch(app.urls.api(path), { method, body, headers, signal: scope.signal, cache: "no-store" });
        if (response.status === 401) el("login").hidden = false;
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const failure = new Error(error.error || "Operazione sulla mappa non disponibile.");
            failure.status = response.status;
            throw failure;
        }
        return response;
    }

    async function json(...args) { return (await request(...args)).json(); }

    async function action(control, operation) {
        if (busy.has(control)) return;
        busy.add(control);
        const buttons = control.matches("form") ? [...control.querySelectorAll('button[type="submit"]')] : [control];
        for (const button of buttons) button.disabled = true;
        setStatus("");
        try { await operation(); }
        catch (error) { if (!scope.signal.aborted) setStatus(error.message); }
        finally {
            busy.delete(control);
            for (const button of buttons) button.disabled = false;
        }
    }

    function submit(name, handler) {
        const node = el(name);
        scope.listen(node, "submit", event => {
            event.preventDefault();
            void action(node, handler);
        });
    }

    const sceneValue = entry => entry ? entry.worldId + "/" + entry.sceneId : "";
    function options(select, placeholder, items, value) {
        select.replaceChildren(new Option(placeholder, ""));
        for (const item of items) select.add(new Option(item.label, item.value));
        if (value && ![...select.options].some(option => option.value === value)) {
            select.add(new Option(value + " · collegamento esistente", value));
        }
        select.value = value || "";
    }

    async function loadChoices() {
        choices ??= Promise.allSettled([
            json("api/foundry-maps"),
            window.CriptaLocations.loadLocations(),
        ]).then(([foundry, places]) => {
            if (foundry.status === "fulfilled") scenes = foundry.value.maps;
            if (places.status === "fulfilled") locations = places.value;
            if (scope.signal.aborted) return;
            for (const select of root.querySelectorAll("[data-city-scenes]")) {
                fillScenes(select, select.value);
            }
            for (const select of root.querySelectorAll("[data-city-locations]")) {
                fillLocations(select, select.value);
            }
            if (sourceScene && !scenes.some(entry => sceneValue(entry) === sourceScene)) {
                setStatus("La scena di origine non è pubblicata in questa campagna.");
            }
        });
        return choices;
    }

    function fillScenes(select, value) {
        options(select, "Nessuna scena", scenes.map(entry => ({
            value: sceneValue(entry), label: entry.title + " · " + entry.worldId,
        })), value);
    }

    function fillLocations(select, value) {
        options(select, "Nessun luogo collegato", locations.map(entry => ({
            value: entry.id, label: entry.title,
        })), value);
    }

    function updateSource() {
        const foundry = createForm.source.value === "foundry";
        el("source").hidden = !foundry;
        el("upload").hidden = foundry;
        createForm.file.required = !foundry;
        createForm.scene.required = foundry;
        const entry = scenes.find(item => sceneValue(item) === createForm.scene.value);
        if (foundry && entry && !createForm.title.value.trim()) createForm.title.value = entry.title;
    }

    function readScene(value) {
        const [worldId, sceneId] = value.split("/");
        return worldId && sceneId ? { worldId, sceneId } : null;
    }

    async function loadList() {
        const data = await json(base);
        if (scope.signal.aborted) return;
        el("list").hidden = false;
        el("create").hidden = !data.canEdit;
        const links = data.maps.map(entry => {
            const li = document.createElement("li");
            const link = document.createElement("a");
            link.href = pageUrl("city-map.html", { mappa: entry.id });
            link.textContent = entry.title;
            li.append(link, entry.published ? "" : " · Bozza");
            return li;
        });
        el("links").replaceChildren(...links);
        if (!links.length) setStatus("Nessuna mappa della città disponibile.");
        if (!data.canEdit) return;
        await loadChoices();
        if (sourceScene) {
            el("create").open = true;
            createForm.source.value = "foundry";
            if (scenes.some(entry => sceneValue(entry) === sourceScene)) createForm.scene.value = sourceScene;
        }
        updateSource();
    }

    function attachLink(name, href) {
        const row = el(name);
        row.hidden = !href;
        if (href) row.querySelector("a").href = href;
    }

    function locationLink(id) {
        return id ? pageUrl("locations/location.html", { id }) : "";
    }

    async function updateImage() {
        if (map.alignmentNeeded && !canEdit) {
            el("detail").hidden = true;
            setStatus("La mappa è in revisione. Riaprila dopo la conferma del DM.");
            return;
        }
        const review = canEdit && map.alignmentNeeded && map.sourceRevision;
        const query = review ? "?review=" + encodeURIComponent(map.sourceRevision) : previewQuery;
        const key = (map.sourceRevision || "") + query;
        if (imageUrl && imageKey === key) return;
        const blob = await (await request(mapPath + "/image" + query)).blob();
        if (scope.signal.aborted) return;
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = URL.createObjectURL(blob);
        imageKey = key;
        image.src = imageUrl;
        image.alt = "Mappa di " + map.title;
    }

    async function loadMap(selectId = selected?.id || params.get("punto")) {
        const data = await json(mapPath + previewQuery);
        if (scope.signal.aborted) return;
        ({ map, points, canEdit, preview } = data);
        el("title").textContent = map.title + (preview ? " · Anteprima giocatori" : "");
        document.title = map.title + " | Mappe della campagna";
        el("detail").hidden = false;
        el("settings").hidden = !canEdit;
        el("add").hidden = !canEdit;
        el("alignment").hidden = !canEdit || !map.alignmentNeeded || !map.sourceRevision;
        attachLink("location", locationLink(map.locationId));
        if (canEdit) {
            mapForm.title.value = map.title;
            fillLocations(mapForm.locationId, map.locationId);
            mapForm.published.checked = map.published;
            el("preview").href = pageUrl("city-map.html", { mappa: mapId, view: "player" });
            el("import").hidden = Boolean(map.source || map.job);
            el("import-status").textContent = map.source ? "Sfondo da una scena Foundry." : map.job
                ? (map.job.completed ? "Scena creata in " : "In attesa della conferma GM in ") + map.job.worldId
                : "";
        }
        if (preview) {
            el("back").href = pageUrl("city-map.html", { mappa: mapId });
            el("back").textContent = "Torna alla vista DM";
        }
        options(el("point-list"), "Seleziona un punto", points.map(point => ({
            value: point.id, label: point.title + (point.revealed ? "" : " · Solo DM"),
        })), selectId);
        selectPoint(points.find(point => point.id === selectId));
        await updateImage();
    }

    function resetNote() {
        editingNote = null;
        noteForm.text.value = "";
        const allowed = canEdit ? ["dm", "personal", "group"] : ["personal", "group"];
        noteForm.audience.replaceChildren(...allowed.map(value => new Option(audiences[value], value)));
        el("note-cancel").hidden = true;
    }

    function selectPoint(point) {
        selected = point;
        draft = null;
        placing = false;
        stage.classList.remove("is-placing");
        el("point-list").value = point?.id || "";
        el("point").hidden = !point;
        el("point-form").hidden = !canEdit || !point;
        resetNote();
        el("notes").replaceChildren();
        loadingNotes++;
        if (point) {
            el("point-title").textContent = point.title;
            el("point-description").textContent = point.description;
            attachLink("point-location", locationLink(point.locationId));
            attachLink("point-scene", point.detail ? pageUrl("mappa.html", { scena: sceneValue(point.detail) }) : "");
            el("note-form").hidden = Boolean(preview);
            if (canEdit) openPointForm(point);
            void loadNotes(point);
        }
        renderPins();
    }

    function openPointForm(point) {
        draft = { ...point };
        el("point-form").hidden = false;
        el("point-form-title").textContent = point.id ? "Modifica punto" : "Nuovo punto";
        pointForm.title.value = point.title || "";
        pointForm.description.value = point.description || "";
        fillLocations(pointForm.locationId, point.locationId);
        fillScenes(pointForm.scene, sceneValue(point.detail));
        pointForm.revealed.checked = Boolean(point.revealed);
        pointForm.detailShared.checked = Boolean(point.detailShared);
        setCoordinates(point.x, point.y);
    }

    function setCoordinates(x, y) {
        draft.x = x;
        draft.y = y;
        pointForm.x.value = (x * 100).toFixed(3);
        pointForm.y.value = (y * 100).toFixed(3);
    }

    function mapCoordinates(event) {
        const rect = stage.getBoundingClientRect();
        const fraction = value => Math.max(0, Math.min(1, value));
        return {
            x: fraction((event.clientX - rect.left) / rect.width),
            y: fraction((event.clientY - rect.top) / rect.height),
        };
    }

    function renderPins() {
        const list = draft && !draft.id ? [...points, draft] : points;
        el("pins").replaceChildren(...list.map((point, index) => {
            const position = draft?.id === point.id && draft ? draft : point;
            const pin = document.createElement("button");
            pin.type = "button";
            pin.className = "city-pin";
            pin.classList.toggle("is-selected", point.id === selected?.id);
            pin.classList.toggle("is-secret", !point.revealed);
            pin.style.left = position.x * 100 + "%";
            pin.style.top = position.y * 100 + "%";
            pin.textContent = index + 1;
            pin.title = point.title || "Nuovo punto";
            pin.setAttribute("aria-label", pin.title);
            pin.addEventListener("click", event => {
                event.stopPropagation();
                if (point.id && (point.id !== selected?.id || !canEdit)) selectPoint(point);
            });
            if (canEdit) {
                pin.addEventListener("pointerdown", event => {
                    if (event.button !== 0 || placing) return;
                    event.stopPropagation();
                    movingPin = { pin, point, id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
                    pin.setPointerCapture(event.pointerId);
                });
            }
            return pin;
        }));
    }

    async function loadNotes(point = selected) {
        if (!point) return;
        const requestId = ++loadingNotes;
        try {
            const data = await json(pointPath(point.id) + "/notes" + previewQuery);
            if (scope.signal.aborted || requestId !== loadingNotes) return;
            el("notes").replaceChildren(...data.notes.map(renderNote));
        } catch (error) {
            if (!scope.signal.aborted && requestId === loadingNotes) setStatus(error.message);
        }
    }

    function renderNote(note) {
        const li = document.createElement("li");
        const meta = document.createElement("small");
        meta.textContent = note.author + " · " + audiences[note.audience] + " · " + new Date(note.createdAt).toLocaleString("it-IT");
        const content = document.createElement("p");
        content.textContent = note.text;
        const controls = document.createElement("div");
        controls.className = "city-toolbar";
        const button = (label, handler) => {
            const node = document.createElement("button");
            node.type = "button";
            node.textContent = label;
            node.addEventListener("click", handler);
            controls.append(node);
            return node;
        };
        if (note.canEdit) button("Modifica", () => {
            editingNote = note;
            noteForm.text.value = note.text;
            noteForm.audience.value = note.audience;
            el("note-cancel").hidden = false;
            noteForm.text.focus();
        });
        const point = selected;
        if (note.canDelete) {
            const remove = button("Elimina", () => {
                if (!window.confirm("Eliminare questa nota?")) return;
                void action(remove, async () => {
                    await json(pointPath(point.id) + "/notes/" + note.id, "DELETE", { revision: note.revision });
                    if (selected?.id === point.id) {
                        if (editingNote?.id === note.id) resetNote();
                        await loadNotes();
                    }
                });
            });
        }
        li.append(meta, content, controls);
        return li;
    }

    el("back").href = pageUrl(mapId ? "city-map.html" : "mappa.html");
    if (mapId) el("back").textContent = "Mappe della campagna";
    scope.listen(el("login"), "click", () => app.auth.promptDeviceLogin());
    scope.listen(createForm.source, "change", updateSource);
    scope.listen(createForm.scene, "change", updateSource);
    submit("create-form", async () => {
        const data = { title: createForm.title.value.trim(), locationId: createForm.locationId.value };
        let body;
        if (createForm.source.value === "foundry") {
            const link = readScene(createForm.scene.value);
            if (!link) throw new Error("Scegli una scena Foundry pubblicata.");
            body = { ...data, ...link };
        } else {
            const file = createForm.file.files[0];
            if (!file) throw new Error("Scegli un’immagine.");
            const blob = await window.CriptaMedia.convertImageFileToWebpBlob(file, { maxEdge: 3072, quality: .88 });
            body = new FormData();
            body.set("title", data.title);
            body.set("locationId", data.locationId);
            body.set("image", blob, "background.webp");
        }
        const result = await json(base, "POST", body);
        location.assign(pageUrl("city-map.html", { mappa: result.id }));
    });

    submit("map-form", async () => {
        await json(mapPath, "PUT", {
            revision: map.revision, title: mapForm.title.value, locationId: mapForm.locationId.value, published: mapForm.published.checked,
        });
        await loadMap();
        setStatus(map.published ? "Mappa disponibile al gruppo." : "Bozza salvata.");
    });

    submit("import", async () => {
        const { job } = await json(mapPath + "/import", "POST", { worldId: form("import").world.value.trim() });
        await loadMap();
        setStatus(job.completed ? "La scena è già collegata." : "Apri Wiki Sync → Importa scene dal sito nel mondo " + job.worldId + ".");
    });

    scope.listen(el("align"), "click", () => action(el("align"), async () => {
        await json(mapPath + "/align", "POST", { revision: map.revision, sourceRevision: map.sourceRevision });
        await loadMap();
        setStatus("Allineamento confermato.");
    }));

    scope.listen(el("point-list"), "change", event => selectPoint(points.find(point => point.id === event.target.value)));
    scope.listen(el("add"), "click", () => {
        placing = true;
        stage.classList.add("is-placing");
        setStatus("Scegli sulla mappa dove aggiungere il punto.");
    });
    scope.listen(stage, "click", event => {
        if (!placing || !imageUrl) return;
        const position = mapCoordinates(event);
        selectPoint();
        openPointForm(position);
        renderPins();
        pointForm.title.focus();
        setStatus("Inserisci i dettagli e salva il punto.");
    });
    scope.listen(el("point-cancel"), "click", () => selectPoint(selected));
    scope.listen(viewport, "pointerdown", event => {
        if (event.target !== image || event.pointerType === "touch" || event.button !== 0 || placing) return;
        panning = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture(event.pointerId);
    });
    scope.listen(viewport, "pointermove", event => {
        if (panning?.id === event.pointerId) {
            viewport.scrollLeft = panning.left + panning.x - event.clientX;
            viewport.scrollTop = panning.top + panning.y - event.clientY;
        }
        if (movingPin?.id !== event.pointerId) return;
        if (!movingPin.moved && Math.hypot(event.clientX - movingPin.startX, event.clientY - movingPin.startY) < 4) return;
        movingPin.moved = true;
        const position = mapCoordinates(event);
        movingPin.pin.style.left = position.x * 100 + "%";
        movingPin.pin.style.top = position.y * 100 + "%";
        movingPin.position = position;
    });
    for (const eventType of ["pointerup", "pointercancel"]) {
        scope.listen(viewport, eventType, event => {
            if (panning?.id === event.pointerId) panning = null;
            if (movingPin?.id !== event.pointerId) return;
            const { point, moved, position } = movingPin;
            movingPin = null;
            if (!moved || eventType === "pointercancel") {
                if (moved) renderPins();
                return;
            }
            if (point.id && point.id !== selected?.id) selectPoint(point);
            if (!draft) openPointForm(point);
            setCoordinates(position.x, position.y);
            renderPins();
            setStatus("Salva il punto per confermare la nuova posizione.");
        });
    }
    for (const button of root.querySelectorAll("[data-city-zoom]")) {
        scope.listen(button, "click", () => {
            const mode = button.dataset.cityZoom;
            zoom = mode === "reset" ? 1 : Math.max(1, Math.min(4, zoom * (mode === "in" ? 1.25 : .8)));
            stage.style.width = zoom * 100 + "%";
        });
    }
    for (const key of ["x", "y"]) {
        scope.listen(pointForm[key], "change", () => {
            if (!draft || !pointForm[key].validity.valid) return;
            draft[key] = Number(pointForm[key].value) / 100;
            renderPins();
        });
    }

    submit("point-form", async () => {
        const id = draft?.id;
        const data = {
            revision: draft?.revision, title: pointForm.title.value, description: pointForm.description.value,
            locationId: pointForm.locationId.value, x: Number(pointForm.x.value) / 100, y: Number(pointForm.y.value) / 100,
            revealed: pointForm.revealed.checked, detail: readScene(pointForm.scene.value), detailShared: pointForm.detailShared.checked,
        };
        const result = await json(id ? pointPath(id) : mapPath + "/points", id ? "PUT" : "POST", data);
        await loadMap(result.id);
        setStatus("Punto salvato.");
    });
    scope.listen(el("note-cancel"), "click", resetNote);
    submit("note-form", async () => {
        if (!selected) return;
        const point = selected;
        const note = editingNote;
        await json(pointPath(point.id) + "/notes" + (note ? "/" + note.id : ""), note ? "PUT" : "POST", {
            revision: note?.revision, text: noteForm.text.value, audience: noteForm.audience.value,
        });
        if (selected?.id === point.id) {
            resetNote();
            await loadNotes();
        }
    });

    scope.signal.addEventListener("abort", () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, { once: true });
    void (async () => {
        await app.campaigns.ready();
        if (scope.signal.aborted) return;
        if (byScene) {
            const link = readScene(byScene);
            if (!link) throw new Error("Scena non valida.");
            try {
                const result = await json(base + "/by-scene/" + encodeURIComponent(link.worldId) + "/" + encodeURIComponent(link.sceneId));
                if (!scope.signal.aborted) location.replace(pageUrl("city-map.html", { mappa: result.id }));
            } catch (error) {
                if (error.status !== 404) throw error;
                await loadList();
                setStatus("Questa scena non ha una mappa città disponibile. Puoi consultare le altre mappe della campagna.");
            }
            return;
        }
        if (!mapId) return loadList();
        await loadMap();
        if (!canEdit || scope.signal.aborted) return;
        await loadChoices();
        if (!map.source && !map.job) {
            const data = await json(base + "/worlds");
            const list = root.querySelector("#city-foundry-worlds");
            list.replaceChildren(...data.worlds.map(id => new Option(id, id)));
            if (data.worlds.length === 1) form("import").world.value = data.worlds[0];
        }
    })().catch(error => { if (!scope.signal.aborted) setStatus(error.message); });
});
