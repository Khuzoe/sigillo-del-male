(function () {
    const DEFAULT_DATA_URL = '../assets/data/maps/main_maps/map.json';
    const DEFAULT_OUTPUT_NAME = 'map.json';
    const TYPE_COLORS = {
        Area: '#4CAF50',
        'Città': '#f44336',
        'Luogo Generico': '#2196F3'
    };

    const state = {
        data: { pointsOfInterest: [] },
        selectedId: '',
        selectedFogId: '',
        mode: 'poi',
        drag: null
    };

    let idEditedManually = false;

    const els = {
        canvas: document.getElementById('map-editor-canvas'),
        image: document.getElementById('map-editor-image'),
        status: document.getElementById('editor-status'),
        list: document.getElementById('poi-editor-list'),
        fogList: document.getElementById('fog-editor-list'),
        form: document.getElementById('poi-form'),
        fogForm: document.getElementById('fog-form'),
        output: document.getElementById('json-output'),
        fileInput: document.getElementById('json-file-input'),
        imageFileInput: document.getElementById('poi-image-file'),
        subMapImageFileInput: document.getElementById('poi-submap-image-file'),
        iconPicker: document.getElementById('poi-icon-picker'),
        reloadDefault: document.getElementById('reload-default-btn'),
        add: document.getElementById('add-poi-btn'),
        duplicate: document.getElementById('duplicate-poi-btn'),
        delete: document.getElementById('delete-poi-btn'),
        addFog: document.getElementById('add-fog-btn'),
        deleteFog: document.getElementById('delete-fog-btn'),
        modePoi: document.getElementById('mode-poi-btn'),
        modeFog: document.getElementById('mode-fog-btn'),
        modeBrush: document.getElementById('mode-brush-btn'),
        modeErase: document.getElementById('mode-erase-btn'),
        fogEnabled: document.getElementById('fog-enabled'),
        fogGlobalOpacity: document.getElementById('fog-global-opacity'),
        brushSize: document.getElementById('brush-size'),
        brushSoftness: document.getElementById('brush-softness'),
        simplifyReveal: document.getElementById('simplify-reveal-btn'),
        clearReveal: document.getElementById('clear-reveal-btn'),
        copy: document.getElementById('copy-json-btn'),
        download: document.getElementById('download-json-btn')
    };

    const fields = {
        id: document.getElementById('poi-id'),
        title: document.getElementById('poi-title'),
        type: document.getElementById('poi-type'),
        visibility: document.getElementById('poi-visibility'),
        x: document.getElementById('poi-x'),
        y: document.getElementById('poi-y'),
        flavor: document.getElementById('poi-flavor'),
        desc: document.getElementById('poi-desc'),
        image: document.getElementById('poi-image'),
        subMapData: document.getElementById('poi-submap-data'),
        subMapImage: document.getElementById('poi-submap-image')
    };

    const fogFields = {
        id: document.getElementById('fog-id'),
        shape: document.getElementById('fog-shape'),
        x: document.getElementById('fog-x'),
        y: document.getElementById('fog-y'),
        width: document.getElementById('fog-width'),
        height: document.getElementById('fog-height'),
        softness: document.getElementById('fog-softness')
    };

    function setStatus(message, kind = '') {
        els.status.textContent = message;
        els.status.classList.toggle('is-error', kind === 'error');
        els.status.classList.toggle('is-ok', kind === 'ok');
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function roundCoord(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    function slugify(value) {
        return String(value || 'nuovo-luogo')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'nuovo-luogo';
    }

    function uniqueId(base, currentId = '') {
        const normalized = base.startsWith('poi-') ? base : `poi-${base}`;
        let candidate = normalized;
        let suffix = 2;
        const ids = new Set(state.data.pointsOfInterest.map(poi => poi.id).filter(id => id !== currentId));
        while (ids.has(candidate)) {
            candidate = `${normalized}-${suffix}`;
            suffix += 1;
        }
        return candidate;
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function getSelectedPoi() {
        return state.data.pointsOfInterest.find(poi => poi.id === state.selectedId) || null;
    }

    function getSelectedFog() {
        return (state.data.fogOfWar?.revealedAreas || []).find(area => area.id === state.selectedFogId) || null;
    }

    function normalizePoi(poi) {
        const normalized = {
            ...poi,
            id: String(poi.id || uniqueId(slugify(poi.title))).trim(),
            x: poi.x == null ? 50 : roundCoord(poi.x),
            y: poi.y == null ? 50 : roundCoord(poi.y),
            title: String(poi.title || 'Nuovo luogo').trim(),
            type: String(poi.type || 'Luogo Generico').trim(),
            flavor: String(poi.flavor || '').trim(),
            desc: String(poi.desc || '').trim()
        };

        const visibility = String(poi.visibility || 'known').trim();
        if (visibility && visibility !== 'known') {
            normalized.visibility = visibility;
        } else {
            delete normalized.visibility;
        }

        if (poi.image) normalized.image = String(poi.image).trim();
        if (Array.isArray(poi.icons) && poi.icons.length > 0) {
            normalized.icons = poi.icons
                .map(icon => window.CriptaMapIcons?.normalize(icon) || String(icon).trim())
                .filter(Boolean);
        }
        if (poi.subMap && poi.subMap.data && poi.subMap.image) {
            normalized.subMap = {
                data: String(poi.subMap.data).trim(),
                image: String(poi.subMap.image).trim()
            };
        }

        return normalized;
    }

    function normalizeFog(area) {
        return {
            ...area,
            id: String(area.id || uniqueIdForFog('fog-area')).trim(),
            shape: area.shape === 'circle' ? 'circle' : 'rect',
            x: roundCoord(clamp(Number(area.x ?? 50), 0, 100)),
            y: roundCoord(clamp(Number(area.y ?? 50), 0, 100)),
            width: roundCoord(clamp(Number(area.width ?? 20), 1, 100)),
            height: roundCoord(clamp(Number(area.height ?? area.width ?? 20), 1, 100)),
            softness: roundCoord(clamp(Number(area.softness ?? 10), 0, 30))
        };
    }

    function uniqueIdForFog(base, currentId = '') {
        const normalized = base.startsWith('fog-') ? base : `fog-${base}`;
        let candidate = normalized;
        let suffix = 2;
        const ids = new Set((state.data.fogOfWar?.revealedAreas || []).map(area => area.id).filter(id => id !== currentId));
        while (ids.has(candidate)) {
            candidate = `${normalized}-${suffix}`;
            suffix += 1;
        }
        return candidate;
    }

    function setData(data) {
        const points = Array.isArray(data?.pointsOfInterest) ? data.pointsOfInterest : [];
        state.data = {
            ...data,
            pointsOfInterest: points.map(normalizePoi),
            fogOfWar: {
                enabled: Boolean(data?.fogOfWar?.enabled),
                opacity: Math.round(clamp(Number(data?.fogOfWar?.opacity ?? 0.88), 0.25, 1) * 100) / 100,
                revealedAreas: (Array.isArray(data?.fogOfWar?.revealedAreas)
                    ? data.fogOfWar.revealedAreas
                    : []
                ).map(normalizeFog)
            }
        };
        state.selectedId = state.data.pointsOfInterest[0]?.id || '';
        state.selectedFogId = state.data.fogOfWar.revealedAreas[0]?.id || '';
        renderAll();
        setStatus(`Caricati ${state.data.pointsOfInterest.length} POI e ${state.data.fogOfWar.revealedAreas.length} aree rivelate.`, 'ok');
    }

    async function loadDefaultData() {
        try {
            const response = await fetch(DEFAULT_DATA_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setData(await response.json());
        } catch (error) {
            setStatus(`Impossibile caricare il JSON di default: ${error.message}. Avvia il sito in locale oppure importa il file JSON.`, 'error');
        }
    }

    function readFormIntoSelected() {
        const poi = getSelectedPoi();
        if (!poi) return;

        const nextId = uniqueId(fields.id.value.trim() || slugify(fields.title.value), poi.id);
        poi.id = nextId;
        poi.title = fields.title.value.trim() || 'Nuovo luogo';
        poi.type = fields.type.value;
        poi.visibility = fields.visibility.value === 'known' ? 'known' : fields.visibility.value;
        poi.x = roundCoord(clamp(Number(fields.x.value || 0), 0, 100));
        poi.y = roundCoord(clamp(Number(fields.y.value || 0), 0, 100));
        poi.flavor = fields.flavor.value.trim();
        poi.desc = fields.desc.value.trim();

        const image = fields.image.value.trim();
        if (image) poi.image = image;
        else delete poi.image;

        const icons = getSelectedIconKeys();
        if (icons.length > 0) poi.icons = icons;
        else delete poi.icons;

        const subMapData = fields.subMapData.value.trim();
        const subMapImage = fields.subMapImage.value.trim();
        if (subMapData && subMapImage) {
            poi.subMap = { data: subMapData, image: subMapImage };
        } else {
            delete poi.subMap;
        }

        state.selectedId = nextId;
    }

    function readFogFormIntoSelected() {
        const area = getSelectedFog();
        if (!area) return;

        const nextId = uniqueIdForFog(fogFields.id.value.trim() || 'fog-area', area.id);
        area.id = nextId;
        area.shape = fogFields.shape.value === 'circle' ? 'circle' : 'rect';
        area.x = roundCoord(clamp(Number(fogFields.x.value || 0), 0, 100));
        area.y = roundCoord(clamp(Number(fogFields.y.value || 0), 0, 100));
        area.width = roundCoord(clamp(Number(fogFields.width.value || 1), 1, 100));
        area.height = roundCoord(clamp(Number(fogFields.height.value || 1), 1, 100));
        area.softness = roundCoord(clamp(Number(fogFields.softness.value || 10), 0, 30));
        state.selectedFogId = nextId;
    }

    function fillForm() {
        const poi = getSelectedPoi();
        const disabled = !poi;
        idEditedManually = false;
        Object.values(fields).forEach(field => {
            field.disabled = disabled;
        });
        els.duplicate.disabled = disabled;
        els.delete.disabled = disabled;

        if (!poi) {
            els.form.reset();
            renderIconPicker([]);
            return;
        }

        fields.id.value = poi.id || '';
        fields.title.value = poi.title || '';
        fields.type.value = poi.type || 'Luogo Generico';
        fields.visibility.value = poi.visibility || 'known';
        fields.x.value = poi.x ?? 50;
        fields.y.value = poi.y ?? 50;
        fields.flavor.value = poi.flavor || '';
        fields.desc.value = poi.desc || '';
        fields.image.value = poi.image || '';
        fields.subMapData.value = poi.subMap?.data || '';
        fields.subMapImage.value = poi.subMap?.image || '';
        renderIconPicker(poi.icons || []);
    }

    function fillFogForm() {
        els.fogEnabled.value = state.data.fogOfWar?.enabled ? 'true' : 'false';
        els.fogGlobalOpacity.value = state.data.fogOfWar?.opacity ?? 0.88;

        const area = getSelectedFog();
        const disabled = !area;
        Object.values(fogFields).forEach(field => {
            field.disabled = disabled;
        });
        els.deleteFog.disabled = disabled;

        if (!area) {
            els.fogForm.reset();
            return;
        }

        fogFields.id.value = area.id || '';
        fogFields.shape.value = area.shape || 'rect';
        fogFields.x.value = area.x ?? 50;
        fogFields.y.value = area.y ?? 50;
        fogFields.width.value = area.width ?? 20;
        fogFields.height.value = area.height ?? 20;
        fogFields.softness.value = area.softness ?? 10;
    }

    function renderIconPicker(activeIcons = []) {
        const active = new Set(activeIcons.map(icon => window.CriptaMapIcons?.normalize(icon) || icon));
        els.iconPicker.innerHTML = (window.CriptaMapIcons?.list || []).map(icon => `
            <button class="map-icon-choice ${active.has(icon.key) ? 'is-active' : ''}" type="button" data-icon-key="${escapeHtml(icon.key)}" aria-pressed="${active.has(icon.key) ? 'true' : 'false'}">
                <i class="fas ${escapeHtml(icon.icon)}" aria-hidden="true"></i>
                <span>${escapeHtml(icon.label)}</span>
            </button>
        `).join('');

        els.iconPicker.querySelectorAll('[data-icon-key]').forEach(button => {
            button.addEventListener('click', () => {
                button.classList.toggle('is-active');
                button.setAttribute('aria-pressed', button.classList.contains('is-active') ? 'true' : 'false');
                handleFormInput();
            });
        });
    }

    function getSelectedIconKeys() {
        return Array.from(els.iconPicker.querySelectorAll('.map-icon-choice.is-active'))
            .map(button => button.dataset.iconKey)
            .filter(Boolean);
    }

    function markerColor(type) {
        return TYPE_COLORS[type] || TYPE_COLORS['Luogo Generico'];
    }

    function firstCatalogIcon(poi) {
        const iconKey = Array.isArray(poi.icons) ? poi.icons.find(icon => window.CriptaMapIcons?.isCatalogIcon(icon)) : '';
        return iconKey ? window.CriptaMapIcons.get(iconKey) : null;
    }

    function renderMarkers() {
        els.canvas.querySelectorAll('.editor-marker').forEach(marker => marker.remove());
        state.data.pointsOfInterest.forEach((poi) => {
            const marker = document.createElement('button');
            marker.type = 'button';
            marker.className = `editor-marker ${poi.id === state.selectedId ? 'is-active' : ''}`;
            marker.dataset.poiId = poi.id;
            marker.style.left = `${poi.x}%`;
            marker.style.top = `${poi.y}%`;
            marker.style.setProperty('--marker-color', markerColor(poi.type));
            marker.setAttribute('aria-label', `Seleziona ${poi.title}`);
            const icon = firstCatalogIcon(poi);
            marker.innerHTML = `
                ${icon ? `<i class="fas ${escapeHtml(icon.icon)} editor-marker-icon" aria-hidden="true"></i>` : ''}
                <span class="editor-marker-label">${escapeHtml(poi.title)}</span>
            `;
            marker.addEventListener('pointerdown', startDrag);
            marker.addEventListener('click', (event) => {
                event.stopPropagation();
                selectPoi(poi.id);
            });
            els.canvas.appendChild(marker);
        });
    }

    function renderFogAreas() {
        els.canvas.querySelectorAll('.editor-fog').forEach(area => area.remove());
        const opacity = state.data.fogOfWar?.enabled ? state.data.fogOfWar.opacity ?? 0.88 : 0;
        els.canvas.style.setProperty('--global-fog-opacity', opacity);
        (state.data.fogOfWar?.revealedAreas || []).forEach((area) => {
            const fog = document.createElement('button');
            fog.type = 'button';
            fog.className = `editor-fog editor-fog--${area.shape === 'circle' ? 'circle' : 'rect'} ${area.id === state.selectedFogId ? 'is-active' : ''}`;
            fog.dataset.fogId = area.id;
            fog.style.left = `${area.x}%`;
            fog.style.top = `${area.y}%`;
            fog.style.width = `${area.width}%`;
            fog.style.height = `${area.height}%`;
            fog.style.transform = 'translate(-50%, -50%)';
            fog.setAttribute('aria-label', `Seleziona ${area.id}`);
            fog.addEventListener('pointerdown', startFogDrag);
            fog.addEventListener('click', (event) => {
                event.stopPropagation();
                selectFog(area.id);
            });
            els.canvas.appendChild(fog);
        });
    }

    function renderList() {
        if (state.data.pointsOfInterest.length === 0) {
            els.list.innerHTML = '<p class="map-editor-status">Nessun POI presente.</p>';
            return;
        }

        els.list.innerHTML = state.data.pointsOfInterest.map((poi) => `
            <button type="button" class="${poi.id === state.selectedId ? 'is-active' : ''}" data-poi-id="${escapeHtml(poi.id)}">
                <span class="map-editor-dot" style="--dot-color: ${markerColor(poi.type)};" aria-hidden="true"></span>
                <span>
                    <span class="map-editor-list-title">${escapeHtml(poi.title)}</span>
                    <span class="map-editor-list-meta">${escapeHtml(poi.type)} / ${escapeHtml(poi.visibility || 'known')} - ${poi.x}, ${poi.y}</span>
                </span>
            </button>
        `).join('');

        els.list.querySelectorAll('[data-poi-id]').forEach(button => {
            button.addEventListener('click', () => selectPoi(button.dataset.poiId));
        });
    }

    function renderFogList() {
        const fogAreas = state.data.fogOfWar?.revealedAreas || [];
        if (fogAreas.length === 0) {
            els.fogList.innerHTML = '<p class="map-editor-status">Nessuna nebbia presente.</p>';
            return;
        }

        els.fogList.innerHTML = fogAreas.map((area) => `
            <button type="button" class="${area.id === state.selectedFogId ? 'is-active' : ''}" data-fog-id="${escapeHtml(area.id)}">
                <span class="map-editor-dot" style="--dot-color: #1b1b1b;" aria-hidden="true"></span>
                <span>
                    <span class="map-editor-list-title">${escapeHtml(area.id)}</span>
                    <span class="map-editor-list-meta">${escapeHtml(area.shape)} - ${area.x}, ${area.y} - ${area.width}x${area.height}</span>
                </span>
            </button>
        `).join('');

        els.fogList.querySelectorAll('[data-fog-id]').forEach(button => {
            button.addEventListener('click', () => selectFog(button.dataset.fogId));
        });
    }

    function validateData() {
        const errors = [];
        const ids = new Set();

        state.data.pointsOfInterest.forEach((poi, index) => {
            if (!poi.id) errors.push(`POI ${index + 1}: ID mancante.`);
            if (ids.has(poi.id)) errors.push(`ID duplicato: ${poi.id}.`);
            ids.add(poi.id);
            if (!poi.title) errors.push(`${poi.id}: titolo mancante.`);
            if (!poi.type) errors.push(`${poi.id}: tipo mancante.`);
            if (!Number.isFinite(Number(poi.x)) || poi.x < 0 || poi.x > 100) errors.push(`${poi.id}: X fuori range.`);
            if (!Number.isFinite(Number(poi.y)) || poi.y < 0 || poi.y > 100) errors.push(`${poi.id}: Y fuori range.`);
            if (poi.subMap && (!poi.subMap.data || !poi.subMap.image)) errors.push(`${poi.id}: sottomappa incompleta.`);
        });

        (state.data.fogOfWar?.revealedAreas || []).forEach((area) => {
            if (!area.id) errors.push('Nebbia: ID mancante.');
            if (!Number.isFinite(Number(area.x)) || area.x < 0 || area.x > 100) errors.push(`${area.id}: X nebbia fuori range.`);
            if (!Number.isFinite(Number(area.y)) || area.y < 0 || area.y > 100) errors.push(`${area.id}: Y nebbia fuori range.`);
            if (!Number.isFinite(Number(area.width)) || area.width <= 0) errors.push(`${area.id}: larghezza nebbia non valida.`);
            if (!Number.isFinite(Number(area.height)) || area.height <= 0) errors.push(`${area.id}: altezza nebbia non valida.`);
        });

        return errors;
    }

    function updateOutput() {
        const cleanData = {
            ...state.data,
            pointsOfInterest: state.data.pointsOfInterest.map(normalizePoi),
            fogOfWar: {
                enabled: Boolean(state.data.fogOfWar?.enabled),
                opacity: Math.round(clamp(Number(state.data.fogOfWar?.opacity ?? 0.88), 0.25, 1) * 100) / 100,
                revealedAreas: (state.data.fogOfWar?.revealedAreas || []).map(normalizeFog)
            }
        };
        els.output.value = JSON.stringify(cleanData, null, 2);

        const errors = validateData();
        if (errors.length > 0) {
            setStatus(errors[0], 'error');
        } else {
            setStatus(`${cleanData.pointsOfInterest.length} POI e ${cleanData.fogOfWar.revealedAreas.length} aree rivelate validi.`, 'ok');
        }
    }

    function renderAll() {
        fillForm();
        fillFogForm();
        renderFogAreas();
        renderMarkers();
        renderList();
        renderFogList();
        updateOutput();
        updateModeButtons();
    }

    function selectPoi(id) {
        readFogFormIntoSelected();
        readFormIntoSelected();
        state.selectedId = id;
        state.mode = 'poi';
        idEditedManually = false;
        renderAll();
    }

    function selectFog(id) {
        readFormIntoSelected();
        readFogFormIntoSelected();
        state.selectedFogId = id;
        state.mode = 'fog';
        renderAll();
    }

    function updateModeButtons() {
        els.modePoi.classList.toggle('is-active', state.mode === 'poi');
        els.modeFog.classList.toggle('is-active', state.mode === 'fog');
        els.modeBrush.classList.toggle('is-active', state.mode === 'brush');
        els.modeErase.classList.toggle('is-active', state.mode === 'erase');
        els.canvas.classList.toggle('is-poi-mode', state.mode === 'poi');
        els.canvas.classList.toggle('is-fog-mode', state.mode === 'fog');
        els.canvas.classList.toggle('is-brush-mode', state.mode === 'brush');
        els.canvas.classList.toggle('is-erase-mode', state.mode === 'erase');
    }

    function addPoiAt(x = 50, y = 50) {
        readFormIntoSelected();
        const title = 'Nuovo luogo';
        const poi = normalizePoi({
            id: uniqueId(slugify(title)),
            title,
            type: 'Luogo Generico',
            x,
            y,
            flavor: '',
            desc: '<p>Descrizione.</p>'
        });
        state.data.pointsOfInterest.push(poi);
        state.selectedId = poi.id;
        state.mode = 'poi';
        idEditedManually = false;
        renderAll();
    }

    function addFogAt(x = 50, y = 50) {
        readFormIntoSelected();
        readFogFormIntoSelected();
        if (!state.data.fogOfWar) state.data.fogOfWar = { enabled: true, opacity: 0.88, revealedAreas: [] };
        if (!Array.isArray(state.data.fogOfWar.revealedAreas)) state.data.fogOfWar.revealedAreas = [];
        state.data.fogOfWar.enabled = true;
        const area = normalizeFog({
            id: uniqueIdForFog('fog-area'),
            shape: 'rect',
            x,
            y,
            width: 22,
            height: 16,
            softness: 10
        });
        state.data.fogOfWar.revealedAreas.push(area);
        state.selectedFogId = area.id;
        state.mode = 'fog';
        renderAll();
    }

    function addBrushRevealAt(x, y) {
        if (!state.data.fogOfWar) state.data.fogOfWar = { enabled: true, opacity: 0.88, revealedAreas: [] };
        if (!Array.isArray(state.data.fogOfWar.revealedAreas)) state.data.fogOfWar.revealedAreas = [];
        state.data.fogOfWar.enabled = true;

        const size = roundCoord(clamp(Number(els.brushSize.value || 8), 2, 30));
        const softness = roundCoord(clamp(Number(els.brushSoftness.value || 10), 0, 30));
        const tooClose = state.data.fogOfWar.revealedAreas.some(area => {
            if (area.shape !== 'circle') return false;
            const distance = Math.hypot(Number(area.x) - x, Number(area.y) - y);
            return distance < size * 0.28;
        });
        if (tooClose) return;

        const area = normalizeFog({
            id: uniqueIdForFog('reveal'),
            shape: 'circle',
            x,
            y,
            width: size,
            height: size,
            softness
        });
        state.data.fogOfWar.revealedAreas.push(area);
        state.selectedFogId = area.id;
        fillFogForm();
        renderFogAreas();
        renderFogList();
        updateOutput();
    }

    function eraseRevealAt(x, y) {
        const areas = state.data.fogOfWar?.revealedAreas || [];
        const radius = clamp(Number(els.brushSize.value || 8), 2, 30) / 2;
        const before = areas.length;
        state.data.fogOfWar.revealedAreas = areas.filter((area) => {
            const width = Number(area.width || 0);
            const height = Number(area.height || width);
            const areaRadius = Math.max(width, height) / 2;
            const distance = Math.hypot(Number(area.x) - x, Number(area.y) - y);
            return distance > radius + areaRadius * 0.65;
        });
        if (state.data.fogOfWar.revealedAreas.length === before) return;
        state.selectedFogId = state.data.fogOfWar.revealedAreas[0]?.id || '';
        fillFogForm();
        renderFogAreas();
        renderFogList();
        updateOutput();
    }

    function simplifyRevealAreas() {
        const areas = state.data.fogOfWar?.revealedAreas || [];
        const before = areas.length;
        const manualAreas = areas.filter(area => area.shape !== 'circle');
        const circles = areas
            .filter(area => area.shape === 'circle')
            .map(area => ({
                ...area,
                radius: Math.max(Number(area.width || 0), Number(area.height || area.width || 0)) / 2
            }))
            .sort((a, b) => b.radius - a.radius);

        const finalCircles = removeCoveredCircles(circles);

        const simplified = [...manualAreas, ...finalCircles.map(({ radius, ...area }) => area)];

        state.data.fogOfWar.revealedAreas = simplified;
        const stillExists = simplified.some(area => area.id === state.selectedFogId);
        state.selectedFogId = stillExists ? state.selectedFogId : simplified[0]?.id || '';
        renderAll();
        setStatus(`Semplificazione: ${before} -> ${simplified.length} aree rivelate.`, 'ok');
    }

    function isCircleRedundant(circle, existing) {
        const distance = Math.hypot(Number(existing.x) - Number(circle.x), Number(existing.y) - Number(circle.y));
        const contained = distance + circle.radius <= existing.radius * 1.04;
        if (contained) return true;

        const similarSize = Math.abs(circle.radius - existing.radius) <= Math.max(circle.radius, existing.radius) * 0.12;
        const nearlySameCenter = distance <= Math.max(circle.radius, existing.radius) * 0.2;
        return similarSize && nearlySameCenter;
    }

    function removeCoveredCircles(circles) {
        let remaining = [...circles].sort((a, b) => a.radius - b.radius);
        let removedAny = true;

        while (removedAny) {
            removedAny = false;

            for (let index = 0; index < remaining.length; index += 1) {
                const circle = remaining[index];
                const others = remaining.filter((_, otherIndex) => otherIndex !== index);
                const redundantBySingle = others.some(existing => isCircleRedundant(circle, existing));
                const coveredByUnion = isCircleCoveredByUnion(circle, others);

                if (!redundantBySingle && !coveredByUnion) continue;

                remaining.splice(index, 1);
                removedAny = true;
                break;
            }
        }

        return remaining.sort((a, b) => b.radius - a.radius);
    }

    function isCircleCoveredByUnion(circle, others) {
        if (others.length === 0) return false;

        const samples = sampleCircle(circle);
        return samples.every(point => others.some(other => isPointInsideCircle(point, other, 0.08)));
    }

    function sampleCircle(circle) {
        const samples = [{ x: Number(circle.x), y: Number(circle.y) }];
        const rings = [0.45, 0.82, 1];
        const steps = 16;

        rings.forEach((ring) => {
            for (let step = 0; step < steps; step += 1) {
                const angle = (Math.PI * 2 * step) / steps;
                samples.push({
                    x: Number(circle.x) + Math.cos(angle) * circle.radius * ring,
                    y: Number(circle.y) + Math.sin(angle) * circle.radius * ring
                });
            }
        });

        return samples;
    }

    function isPointInsideCircle(point, circle, tolerance = 0) {
        const distance = Math.hypot(point.x - Number(circle.x), point.y - Number(circle.y));
        return distance <= circle.radius + tolerance;
    }


    function clearRevealAreas() {
        if (!state.data.fogOfWar) return;
        state.data.fogOfWar.revealedAreas = [];
        state.selectedFogId = '';
        renderAll();
    }

    function duplicateSelected() {
        const poi = getSelectedPoi();
        if (!poi) return;
        readFormIntoSelected();
        const copy = normalizePoi({
            ...poi,
            id: uniqueId(slugify(`${poi.title}-copia`)),
            title: `${poi.title} copia`,
            x: clamp(Number(poi.x) + 1, 0, 100),
            y: clamp(Number(poi.y) + 1, 0, 100)
        });
        state.data.pointsOfInterest.push(copy);
        state.selectedId = copy.id;
        idEditedManually = false;
        renderAll();
    }

    function deleteSelected() {
        const poi = getSelectedPoi();
        if (!poi) return;
        const currentIndex = state.data.pointsOfInterest.findIndex(item => item.id === poi.id);
        state.data.pointsOfInterest = state.data.pointsOfInterest.filter(item => item.id !== poi.id);
        const nextIndex = Math.max(0, currentIndex - 1);
        state.selectedId = state.data.pointsOfInterest[nextIndex]?.id || '';
        renderAll();
    }

    function deleteSelectedFog() {
        const area = getSelectedFog();
        if (!area) return;
        const areas = state.data.fogOfWar?.revealedAreas || [];
        const currentIndex = areas.findIndex(item => item.id === area.id);
        state.data.fogOfWar.revealedAreas = areas.filter(item => item.id !== area.id);
        const nextIndex = Math.max(0, currentIndex - 1);
        state.selectedFogId = state.data.fogOfWar.revealedAreas[nextIndex]?.id || '';
        renderAll();
    }

    function canvasPointFromEvent(event) {
        const rect = els.canvas.getBoundingClientRect();
        return {
            x: roundCoord(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100)),
            y: roundCoord(clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100))
        };
    }

    function startDrag(event) {
        const marker = event.currentTarget;
        const poi = state.data.pointsOfInterest.find(item => item.id === marker.dataset.poiId);
        if (!poi) return;

        event.preventDefault();
        event.stopPropagation();
        state.selectedId = poi.id;
        state.mode = 'poi';
        state.drag = { id: poi.id, didMove: false };
        marker.setPointerCapture(event.pointerId);
        fillForm();
        renderList();
        updateModeButtons();
    }

    function startFogDrag(event) {
        const fog = event.currentTarget;
        const area = (state.data.fogOfWar?.revealedAreas || []).find(item => item.id === fog.dataset.fogId);
        if (!area) return;

        event.preventDefault();
        event.stopPropagation();
        state.selectedFogId = area.id;
        state.mode = 'fog';
        state.drag = { id: area.id, kind: 'fog' };
        fog.setPointerCapture(event.pointerId);
        fillFogForm();
        renderFogList();
        updateModeButtons();
    }

    function handlePointerMove(event) {
        if (!state.drag) return;
        if (state.drag.kind === 'brush') {
            const point = canvasPointFromEvent(event);
            if (state.mode === 'brush') addBrushRevealAt(point.x, point.y);
            else eraseRevealAt(point.x, point.y);
            return;
        }

        if (state.drag.kind === 'fog') {
            const area = (state.data.fogOfWar?.revealedAreas || []).find(item => item.id === state.drag.id);
            if (!area) return;
            const point = canvasPointFromEvent(event);
            area.x = point.x;
            area.y = point.y;
            fogFields.x.value = point.x;
            fogFields.y.value = point.y;
            renderFogAreas();
            renderFogList();
            updateOutput();
            return;
        }

        const poi = state.data.pointsOfInterest.find(item => item.id === state.drag.id);
        if (!poi) return;

        const point = canvasPointFromEvent(event);
        poi.x = point.x;
        poi.y = point.y;
        state.drag.didMove = true;
        fields.x.value = point.x;
        fields.y.value = point.y;
        renderMarkers();
        renderList();
        updateOutput();
    }

    function handlePointerUp() {
        state.drag = null;
    }

    function handleCanvasClick(event) {
        if (event.target.closest('.editor-marker')) return;
        if (event.target.closest('.editor-fog')) return;
        const point = canvasPointFromEvent(event);
        if (state.mode === 'brush') {
            addBrushRevealAt(point.x, point.y);
            return;
        }
        if (state.mode === 'erase') {
            eraseRevealAt(point.x, point.y);
            return;
        }
        if (state.mode === 'fog') {
            addFogAt(point.x, point.y);
            return;
        }
        addPoiAt(point.x, point.y);
    }

    function handleFormInput() {
        if (document.activeElement === fields.id) {
            idEditedManually = true;
        }

        if (document.activeElement === fields.title && !idEditedManually) {
            const poi = getSelectedPoi();
            fields.id.value = uniqueId(slugify(fields.title.value), poi?.id || '');
        }

        readFormIntoSelected();
        renderMarkers();
        renderList();
        updateOutput();
    }

    function handleFogFormInput() {
        readFogFormIntoSelected();
        renderFogAreas();
        renderFogList();
        updateOutput();
    }

    function handleFogSettingsInput() {
        if (!state.data.fogOfWar) state.data.fogOfWar = { enabled: false, opacity: 0.88, revealedAreas: [] };
        state.data.fogOfWar.enabled = els.fogEnabled.value === 'true';
        state.data.fogOfWar.opacity = Math.round(clamp(Number(els.fogGlobalOpacity.value || 0.88), 0.25, 1) * 100) / 100;
        renderFogAreas();
        updateOutput();
    }

    async function copyJson() {
        try {
            await navigator.clipboard.writeText(els.output.value);
            setStatus('JSON copiato negli appunti.', 'ok');
        } catch (_) {
            els.output.select();
            setStatus('Copia automatica non disponibile: seleziona il testo esportato.', 'error');
        }
    }

    function downloadJson() {
        const blob = new Blob([els.output.value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = DEFAULT_OUTPUT_NAME;
        link.click();
        URL.revokeObjectURL(url);
    }

    function deriveRepoPath(file) {
        const relativePath = file.webkitRelativePath || file.name || '';
        const normalized = relativePath.replace(/\\/g, '/');
        const assetsIndex = normalized.indexOf('assets/');
        if (assetsIndex >= 0) {
            return `../${normalized.slice(assetsIndex)}`;
        }
        return `../assets/img/maps/${file.name}`;
    }

    function setFieldFromFile(input, file) {
        if (!file) return;
        input.value = deriveRepoPath(file);
        handleFormInput();
        setStatus(`Path impostato: ${input.value}`, 'ok');
    }

    function importJsonFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                setData(JSON.parse(String(reader.result || '{}')));
            } catch (error) {
                setStatus(`JSON non valido: ${error.message}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    function syncCanvasAspectRatio() {
        if (els.image.naturalWidth && els.image.naturalHeight) {
            els.canvas.style.aspectRatio = `${els.image.naturalWidth} / ${els.image.naturalHeight}`;
        }
    }

    els.image.addEventListener('load', syncCanvasAspectRatio);
    if (els.image.complete) syncCanvasAspectRatio();

    els.canvas.addEventListener('click', handleCanvasClick);
    els.canvas.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.editor-marker') || event.target.closest('.editor-fog')) return;
        if (state.mode !== 'brush' && state.mode !== 'erase') return;
        event.preventDefault();
        const point = canvasPointFromEvent(event);
        state.drag = { kind: 'brush' };
        els.canvas.setPointerCapture(event.pointerId);
        if (state.mode === 'brush') addBrushRevealAt(point.x, point.y);
        else eraseRevealAt(point.x, point.y);
    });
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    els.form.addEventListener('input', handleFormInput);
    els.fogForm.addEventListener('input', handleFogFormInput);
    els.fogEnabled.addEventListener('change', handleFogSettingsInput);
    els.fogGlobalOpacity.addEventListener('input', handleFogSettingsInput);
    els.add.addEventListener('click', () => addPoiAt());
    els.addFog.addEventListener('click', () => addFogAt());
    els.duplicate.addEventListener('click', duplicateSelected);
    els.delete.addEventListener('click', deleteSelected);
    els.deleteFog.addEventListener('click', deleteSelectedFog);
    els.modePoi.addEventListener('click', () => {
        state.mode = 'poi';
        updateModeButtons();
    });
    els.modeFog.addEventListener('click', () => {
        state.mode = 'fog';
        updateModeButtons();
    });
    els.modeBrush.addEventListener('click', () => {
        state.mode = 'brush';
        updateModeButtons();
    });
    els.modeErase.addEventListener('click', () => {
        state.mode = 'erase';
        updateModeButtons();
    });
    els.simplifyReveal.addEventListener('click', simplifyRevealAreas);
    els.clearReveal.addEventListener('click', clearRevealAreas);
    els.copy.addEventListener('click', copyJson);
    els.download.addEventListener('click', downloadJson);
    els.reloadDefault.addEventListener('click', loadDefaultData);
    els.fileInput.addEventListener('change', () => importJsonFile(els.fileInput.files[0]));
    els.imageFileInput.addEventListener('change', () => setFieldFromFile(fields.image, els.imageFileInput.files[0]));
    els.subMapImageFileInput.addEventListener('change', () => setFieldFromFile(fields.subMapImage, els.subMapImageFileInput.files[0]));

    loadDefaultData();
}());
