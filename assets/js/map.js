const devMode = false;

document.addEventListener('DOMContentLoaded', function() {
    const mainMapContainer = document.getElementById('map-container');
    const fullscreenMapContainer = document.getElementById('fullscreen-map-container');
    const mapContent = document.getElementById('map-content');
    const mapImage = document.getElementById('map-image');
    const fogLayer = document.getElementById('map-fog-layer');
    const infoPanel = document.getElementById('info-panel');
    const infoPanelInner = document.getElementById('info-panel-inner');
    const closeInfoPanelBtn = document.getElementById('close-info-panel-btn');
    const emptyState = document.getElementById('map-empty-state');
    const poiList = document.getElementById('poi-list');
    const searchInput = document.getElementById('map-search-input');
    const poiPanel = document.getElementById('poi-panel');
    const toggleListBtn = document.getElementById('toggle-list-btn');
    const breadcrumbCurrent = document.getElementById('map-breadcrumb-current');
    const zoomReadout = document.getElementById('map-zoom-readout');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const resetViewBtn = document.getElementById('reset-view-btn');
    const backBtn = document.getElementById('back-btn');

    const defaultMapData = '../assets/data/maps/main_maps/map.json';
    const defaultMapImage = '../assets/img/maps/world_map.webp';
    const minScale = 1;
    const maxScale = 8;
    const typeColors = {
        Area: '#4CAF50',
        'Città': '#f44336',
        'Luogo Generico': '#2196F3'
    };

    let activeMapContainer = mainMapContainer;
    let pointsOfInterest = [];
    let fogAreas = [];
    let fogOfWar = { enabled: false, opacity: 0.88, revealedAreas: [] };
    let selectedPoiId = '';
    let mapHistory = [];
    let currentMapTitle = 'Mondo';
    let scale = 1;
    let pan = { x: 0, y: 0 };
    let isPanning = false;
    let didDrag = false;
    let startPoint = { x: 0, y: 0 };
    let dragOrigin = { x: 0, y: 0 };
    let imageDimensions = { width: 0, height: 0, left: 0, top: 0 };

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function renderMapIcon(iconValue, className, altText = '') {
        const catalogIcon = window.CriptaMapIcons?.get(iconValue);
        if (catalogIcon) {
            return `<i class="fas ${escapeHtml(catalogIcon.icon)} ${escapeHtml(className)}" aria-hidden="true" title="${escapeHtml(catalogIcon.label)}"></i>`;
        }
        return `<img src="${escapeHtml(iconValue)}" class="${escapeHtml(className)}" alt="${escapeHtml(altText)}">`;
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function getVisibleTypes() {
        return Array.from(document.querySelectorAll('.map-filter-chip.is-active'))
            .map(button => button.dataset.poiType)
            .filter(Boolean);
    }

    function getFilteredPois() {
        const visibleTypes = getVisibleTypes();
        const query = normalizeText(searchInput?.value || '');
        return pointsOfInterest.filter((poi) => {
            const type = poi.type || 'Luogo Generico';
            const visibility = poi.visibility || 'known';
            if (visibility === 'hidden' || visibility === 'dm') return false;
            const matchesType = visibleTypes.includes(type);
            const haystack = normalizeText(`${poi.title || ''} ${type} ${poi.flavor || ''}`);
            return matchesType && (!query || haystack.includes(query));
        });
    }

    function updateZoomReadout() {
        if (zoomReadout) {
            zoomReadout.textContent = `${Math.round(scale * 100)}%`;
        }
    }

    function updateBreadcrumb() {
        if (breadcrumbCurrent) {
            breadcrumbCurrent.textContent = currentMapTitle;
        }
    }

    async function loadMapData(mapPath) {
        try {
            const response = await fetch(mapPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            pointsOfInterest = Array.isArray(data.pointsOfInterest) ? data.pointsOfInterest : [];
            fogAreas = Array.isArray(data.fogAreas) ? data.fogAreas : [];
            fogOfWar = {
                enabled: Boolean(data.fogOfWar?.enabled),
                opacity: Number(data.fogOfWar?.opacity ?? 0.88),
                revealedAreas: Array.isArray(data.fogOfWar?.revealedAreas) ? data.fogOfWar.revealedAreas : []
            };
            selectedPoiId = '';
            renderFogAreas();
            renderPOIs();
            renderPoiList();
            closeInfoPanel();
            applyFiltersAndSearch();

            if (devMode) {
                initializeDevTools();
            }
        } catch (error) {
            console.error('Could not load map data:', error);
            if (infoPanelInner) {
                infoPanelInner.innerHTML = `
                    <div class="info-panel-content">
                        <p>Errore nel caricamento dei dati della mappa.</p>
                    </div>
                `;
            }
            infoPanel?.classList.add('is-open');
        }
    }

    function loadMap(mapDataPath, mapImagePath, title = 'Mondo') {
        mapContent.querySelectorAll('.poi').forEach(poi => poi.remove());
        currentMapTitle = title;
        updateBreadcrumb();
        mapImage.dataset.mapDataPath = mapDataPath;
        mapImage.src = mapImagePath;
        backBtn.style.display = mapHistory.length > 0 ? 'inline-flex' : 'none';
    }

    function renderPOIs() {
        mapContent.querySelectorAll('.poi').forEach(poi => poi.remove());

        pointsOfInterest.forEach((poiData) => {
            if (poiData.x == null || poiData.y == null) return;

            const poiElement = document.createElement('button');
            poiElement.type = 'button';
            poiElement.className = 'poi';
            poiElement.style.left = `${poiData.x}%`;
            poiElement.style.top = `${poiData.y}%`;
            poiElement.dataset.id = poiData.id;
            poiElement.dataset.type = poiData.type || 'Luogo Generico';
            poiElement.dataset.visibility = poiData.visibility || 'known';
            poiElement.setAttribute('aria-label', `Apri ${poiData.title || 'luogo'}`);

            if (poiData.icons && poiData.icons.length > 0) {
                const iconElement = document.createElement('span');
                iconElement.className = 'poi-icon';
                const catalogIcon = window.CriptaMapIcons?.get(poiData.icons[0]);
                if (catalogIcon) {
                    iconElement.innerHTML = `<i class="fas ${escapeHtml(catalogIcon.icon)}" aria-hidden="true"></i>`;
                } else {
                    iconElement.style.backgroundImage = `url('${poiData.icons[0]}')`;
                }
                poiElement.appendChild(iconElement);
            }

            const labelElement = document.createElement('span');
            labelElement.className = 'poi-label';
            labelElement.textContent = poiData.title || 'Luogo';
            poiElement.appendChild(labelElement);

            poiElement.addEventListener('click', (event) => {
                event.stopPropagation();
                selectPoi(poiData.id, { focus: true });
            });

            poiElement.addEventListener('dblclick', (event) => {
                event.stopPropagation();
                enterSubMap(poiData);
            });

            poiElement.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });

            mapContent.appendChild(poiElement);
        });
    }

    function renderFogAreas() {
        if (!fogLayer) return;
        if (fogOfWar.enabled) {
            const maskId = `fog-mask-${Math.random().toString(36).slice(2)}`;
            const softFilterId = `${maskId}-soft`;
            const revealedShapes = buildRevealedMaskShapes(fogOfWar.revealedAreas, softFilterId);
            fogLayer.innerHTML = `
                <svg class="fog-of-war-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" style="--fog-opacity: ${fogOfWar.opacity};">
                    <defs>
                        <filter id="${softFilterId}">
                            <feGaussianBlur stdDeviation="1.4"></feGaussianBlur>
                        </filter>
                        <mask id="${maskId}">
                            <rect x="0" y="0" width="100" height="100" fill="white"></rect>
                            ${revealedShapes}
                        </mask>
                    </defs>
                    <rect x="0" y="0" width="100" height="100" fill="black" mask="url(#${maskId})"></rect>
                </svg>
            `;
            return;
        }

        fogLayer.innerHTML = fogAreas.map((area) => {
            const shape = area.shape === 'circle' ? 'circle' : 'rect';
            const x = Number(area.x ?? 50);
            const y = Number(area.y ?? 50);
            const width = Number(area.width ?? 20);
            const height = Number(area.height ?? width);
            const opacity = Number(area.opacity ?? 0.86);
            return `
                <div
                    class="fog-area fog-area--${shape}"
                    style="left: ${x}%; top: ${y}%; width: ${width}%; height: ${height}%; --fog-opacity: ${opacity}; transform: translate(-50%, -50%);"
                ></div>
            `;
        }).join('');
    }

    function buildRevealedMaskShapes(revealedAreas, softFilterId) {
        return (revealedAreas || []).map((area) => {
            const shape = area.shape === 'rect' ? 'rect' : 'circle';
            const x = Number(area.x ?? 50);
            const y = Number(area.y ?? 50);
            const width = Number(area.width ?? 18);
            const height = Number(area.height ?? width);
            const filter = Number(area.softness ?? 0) > 0 ? ` filter="url(#${softFilterId})"` : '';

            if (shape === 'rect') {
                return `<rect x="${x - width / 2}" y="${y - height / 2}" width="${width}" height="${height}" fill="black"${filter}></rect>`;
            }

            return `<ellipse cx="${x}" cy="${y}" rx="${width / 2}" ry="${height / 2}" fill="black"${filter}></ellipse>`;
        }).join('');
    }

    function renderPoiList() {
        if (!poiList) return;
        const visiblePois = getFilteredPois();

        if (visiblePois.length === 0) {
            poiList.innerHTML = '<p class="poi-list-empty">Nessun luogo visibile con questi filtri.</p>';
            return;
        }

        poiList.innerHTML = visiblePois.map((poi) => {
            const type = poi.type || 'Luogo Generico';
            const color = typeColors[type] || typeColors['Luogo Generico'];
            return `
                <button class="poi-list-item ${poi.id === selectedPoiId ? 'is-active' : ''}" type="button" data-poi-id="${escapeHtml(poi.id)}" style="--poi-color: ${color};">
                    <span class="poi-list-dot" aria-hidden="true"></span>
                    <span>
                        <span class="poi-list-title">${escapeHtml(poi.title || 'Luogo')}</span>
                        <span class="poi-list-type">${escapeHtml(type)}</span>
                    </span>
                </button>
            `;
        }).join('');

        poiList.querySelectorAll('[data-poi-id]').forEach((button) => {
            button.addEventListener('click', () => {
                selectPoi(button.dataset.poiId, { focus: true });
            });
        });
    }

    function applyFiltersAndSearch() {
        const visibleIds = new Set(getFilteredPois().map(poi => poi.id));
        mapContent.querySelectorAll('.poi').forEach((poi) => {
            poi.classList.toggle('hidden', !visibleIds.has(poi.dataset.id));
        });

        if (selectedPoiId && !visibleIds.has(selectedPoiId)) {
            closeInfoPanel();
            selectedPoiId = '';
            updateActiveStates();
        }

        renderPoiList();
    }

    function updateActiveStates() {
        mapContent.querySelectorAll('.poi').forEach((poi) => {
            poi.classList.toggle('active', poi.dataset.id === selectedPoiId);
        });
        poiList?.querySelectorAll('.poi-list-item').forEach((item) => {
            item.classList.toggle('is-active', item.dataset.poiId === selectedPoiId);
        });
    }

    function selectPoi(poiId, options = {}) {
        const poiData = pointsOfInterest.find(poi => poi.id === poiId);
        if (!poiData) return;

        selectedPoiId = poiId;
        updateActiveStates();
        updateInfoPanel(poiData);
        infoPanel?.classList.add('is-open');
        emptyState.hidden = true;

        if (options.focus) {
            focusPoi(poiData);
        }
    }

    function closeInfoPanel() {
        infoPanel?.classList.remove('is-open');
        if (emptyState) emptyState.hidden = false;
    }

    function updateInfoPanel(poiData) {
        if (!infoPanelInner) return;

        const imageHtml = poiData.image
            ? `<img src="${escapeHtml(poiData.image)}" alt="${escapeHtml(poiData.title)}" class="info-panel-image">`
            : '';
        const isRumored = poiData.visibility === 'rumored';

        const iconsHtml = Array.isArray(poiData.icons) && poiData.icons.length > 0
            ? `<div class="info-panel-icons">${poiData.icons.map(iconPath => renderMapIcon(iconPath, 'info-panel-icon')).join('')}</div>`
            : '';

        const actionHtml = poiData.subMap && poiData.subMap.data && poiData.subMap.image
            ? '<div class="info-panel-actions"><button type="button" class="enter-button" id="enter-submap-btn">Apri area</button></div>'
            : '';

        infoPanelInner.innerHTML = `
            <div class="info-panel-header">
                <div class="info-panel-kicker">${escapeHtml(isRumored ? `${poiData.type || 'Luogo'} / Rumor` : poiData.type || 'Luogo')}</div>
                <h2 class="info-panel-title">${escapeHtml(poiData.title || 'Luogo')}</h2>
                ${isRumored ? '' : imageHtml}
                ${iconsHtml}
                ${poiData.flavor ? `<p class="info-panel-flavor">${escapeHtml(poiData.flavor)}</p>` : ''}
            </div>
            <div class="info-panel-content">
                ${isRumored ? '<p>Le informazioni su questo luogo non sono ancora confermate.</p>' : poiData.desc || ''}
                ${isRumored ? '' : actionHtml}
            </div>
        `;

        const enterBtn = infoPanelInner.querySelector('#enter-submap-btn');
        if (enterBtn) {
            enterBtn.addEventListener('click', () => enterSubMap(poiData));
        }
    }

    function enterSubMap(poiData) {
        if (!poiData.subMap || !poiData.subMap.data || !poiData.subMap.image) return;
        mapHistory.push({
            data: mapImage.dataset.mapDataPath || defaultMapData,
            image: mapImage.src,
            title: currentMapTitle
        });
        loadMap(poiData.subMap.data, poiData.subMap.image, poiData.title || 'Area');
    }

    function setInitialPosition() {
        const container = activeMapContainer;
        if (!container || !mapImage.naturalWidth || !mapImage.naturalHeight) return;

        const containerRatio = container.clientWidth / container.clientHeight;
        const imageRatio = mapImage.naturalWidth / mapImage.naturalHeight;

        if (containerRatio > imageRatio) {
            imageDimensions.height = container.clientHeight;
            imageDimensions.width = imageDimensions.height * imageRatio;
        } else {
            imageDimensions.width = container.clientWidth;
            imageDimensions.height = imageDimensions.width / imageRatio;
        }

        imageDimensions.left = (container.clientWidth - imageDimensions.width) / 2;
        imageDimensions.top = (container.clientHeight - imageDimensions.height) / 2;
        scale = 1;
        pan = { x: 0, y: 0 };

        mapContent.style.width = `${imageDimensions.width}px`;
        mapContent.style.height = `${imageDimensions.height}px`;
        mapContent.style.left = `${imageDimensions.left}px`;
        mapContent.style.top = `${imageDimensions.top}px`;
        applyTransform();
    }

    function applyTransform() {
        const container = activeMapContainer;
        if (!container) return;

        const scaledWidth = imageDimensions.width * scale;
        const scaledHeight = imageDimensions.height * scale;
        const minPanX = container.clientWidth - imageDimensions.left - scaledWidth;
        const maxPanX = -imageDimensions.left;
        const minPanY = container.clientHeight - imageDimensions.top - scaledHeight;
        const maxPanY = -imageDimensions.top;

        pan.x = Math.max(minPanX, Math.min(maxPanX, pan.x));
        pan.y = Math.max(minPanY, Math.min(maxPanY, pan.y));
        mapContent.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
        updateZoomReadout();
    }

    function zoomAt(center, nextScale) {
        const oldScale = scale;
        scale = Math.max(minScale, Math.min(nextScale, maxScale));
        if (scale === oldScale) return;

        if (scale === minScale) {
            setInitialPosition();
            return;
        }

        const contentRect = mapContent.getBoundingClientRect();
        const pointOnContentX = center.x - contentRect.left;
        const pointOnContentY = center.y - contentRect.top;

        pan.x -= pointOnContentX * (scale / oldScale - 1);
        pan.y -= pointOnContentY * (scale / oldScale - 1);
        applyTransform();
    }

    function focusPoi(poiData) {
        if (poiData.x == null || poiData.y == null) return;
        const container = activeMapContainer;
        const targetScale = Math.max(scale, 2.15);
        scale = Math.min(targetScale, maxScale);

        const poiX = imageDimensions.left + (imageDimensions.width * Number(poiData.x) / 100) * scale;
        const poiY = imageDimensions.top + (imageDimensions.height * Number(poiData.y) / 100) * scale;
        pan.x = (container.clientWidth / 2) - poiX;
        pan.y = (container.clientHeight / 2) - poiY;
        applyTransform();
    }

    document.querySelectorAll('.map-filter-chip').forEach((button) => {
        button.addEventListener('click', () => {
            const isActive = !button.classList.contains('is-active');
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            applyFiltersAndSearch();
        });
    });

    searchInput?.addEventListener('input', applyFiltersAndSearch);

    toggleListBtn?.addEventListener('click', () => {
        const isHidden = poiPanel.style.display === 'none';
        poiPanel.style.display = isHidden ? 'flex' : 'none';
        toggleListBtn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
    });

    closeInfoPanelBtn?.addEventListener('click', () => {
        selectedPoiId = '';
        updateActiveStates();
        closeInfoPanel();
    });

    zoomInBtn?.addEventListener('click', () => {
        const rect = activeMapContainer.getBoundingClientRect();
        zoomAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, scale + 0.5);
    });

    zoomOutBtn?.addEventListener('click', () => {
        const rect = activeMapContainer.getBoundingClientRect();
        zoomAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, scale - 0.5);
    });

    resetViewBtn?.addEventListener('click', setInitialPosition);

    backBtn?.addEventListener('click', () => {
        if (mapHistory.length === 0) return;
        const previousMap = mapHistory.pop();
        loadMap(previousMap.data, previousMap.image, previousMap.title);
    });

    document.body.addEventListener('wheel', (event) => {
        if (!event.target.closest('.map-container')) return;
        event.preventDefault();

        const delta = event.deltaY > 0 ? -0.28 : 0.28;
        zoomAt({ x: event.clientX, y: event.clientY }, scale + delta);
    }, { passive: false });

    document.body.addEventListener('mousedown', (event) => {
        if (!event.target.closest('#map-content') || scale <= minScale) return;
        if (event.button !== 0 || event.target.closest('.poi')) return;

        event.preventDefault();
        isPanning = true;
        didDrag = false;
        activeMapContainer.style.cursor = 'grabbing';
        startPoint = { x: event.clientX - pan.x, y: event.clientY - pan.y };
        dragOrigin = { x: event.clientX, y: event.clientY };
    });

    document.addEventListener('mouseup', () => {
        if (!isPanning) return;
        isPanning = false;
        activeMapContainer.style.cursor = scale > minScale ? 'grab' : 'default';
    });

    document.addEventListener('mousemove', (event) => {
        if (!isPanning) return;
        event.preventDefault();
        didDrag = Math.abs(event.clientX - dragOrigin.x) > 2 || Math.abs(event.clientY - dragOrigin.y) > 2;
        pan.x = event.clientX - startPoint.x;
        pan.y = event.clientY - startPoint.y;
        applyTransform();
    });

    mapContent.addEventListener('click', (event) => {
        if (didDrag || event.target.closest('.poi')) return;

        selectedPoiId = '';
        updateActiveStates();
        closeInfoPanel();

        if (!devMode) return;

        const rect = mapContent.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        const percentX = (clickX / rect.width) * 100;
        const percentY = (clickY / rect.height) * 100;
        handleDevMapClick(percentX, percentY);
    });

    window.updateActiveMapContainer = (isFullscreen) => {
        activeMapContainer = isFullscreen ? fullscreenMapContainer : mainMapContainer;
        setInitialPosition();
        const selectedPoi = pointsOfInterest.find(poi => poi.id === selectedPoiId);
        if (selectedPoi) {
            focusPoi(selectedPoi);
        }
    };

    mapImage.onload = () => {
        setInitialPosition();
        const mapDataPath = mapImage.dataset.mapDataPath || defaultMapData;
        loadMapData(mapDataPath);
    };

    loadMap(defaultMapData, defaultMapImage, 'Mondo');
    if (mapImage.complete) {
        mapImage.onload();
    }
    window.addEventListener('resize', setInitialPosition);

    let selectedDevPoi = null;

    function initializeDevTools() {
        const devToolsContainer = document.getElementById('dev-tools-container');
        const devPoiList = document.getElementById('dev-poi-list');
        const copyBtn = document.getElementById('dev-copy-btn');
        const toggleBtn = document.getElementById('dev-tools-toggle-btn');

        if (!devToolsContainer || !devPoiList || !copyBtn || !toggleBtn) return;

        toggleBtn.style.display = 'block';
        toggleBtn.addEventListener('click', () => {
            const isVisible = devToolsContainer.style.display === 'block';
            devToolsContainer.style.display = isVisible ? 'none' : 'block';
        });

        devPoiList.innerHTML = '';
        const poisToSet = pointsOfInterest.filter(p => p.x === null || p.y === null);

        poisToSet.forEach((poi) => {
            const li = document.createElement('li');
            li.textContent = `${poi.title} - (click to set)`;
            li.dataset.id = poi.id;
            li.style.cursor = 'pointer';
            li.addEventListener('click', () => {
                selectedDevPoi = poi.id;
                document.querySelectorAll('#dev-poi-list li').forEach(item => item.style.fontWeight = 'normal');
                li.style.fontWeight = 'bold';
            });
            devPoiList.appendChild(li);
        });

        copyBtn.addEventListener('click', () => {
            const updatedPois = pointsOfInterest.filter(p => poisToSet.find(ps => ps.id === p.id));
            const json = JSON.stringify(updatedPois, ['id', 'title', 'x', 'y'], 2);
            navigator.clipboard.writeText(json).then(() => {
                alert('POIs copied to clipboard!');
            });
        });
    }

    function handleDevMapClick(percentX, percentY) {
        if (selectedDevPoi) {
            const poi = pointsOfInterest.find(p => p.id === selectedDevPoi);
            if (poi) {
                poi.x = percentX;
                poi.y = percentY;
                renderPOIs();
                renderPoiList();
                selectedDevPoi = null;
            }
            return;
        }

        console.log(`{ "id": "new-poi", "x": ${percentX.toFixed(2)}, "y": ${percentY.toFixed(2)}, "title": "New Point", "flavor": "Flavor text", "desc": "Description" },`);
    }
});
