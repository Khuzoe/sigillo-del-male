const devMode = true;
document.addEventListener('DOMContentLoaded', function() {
    const mainMapContainer = document.getElementById('map-container');
    const fullscreenMapContainer = document.getElementById('fullscreen-map-container');
    const mapContent = document.getElementById('map-content');
    const mapImage = document.getElementById('map-image');
    const infoPanel = document.getElementById('info-panel');
    let activeMapContainer = mainMapContainer;

    function adjustInfoPanelHeight() {
        // We need a slight delay to ensure the containers have their final dimensions.
        setTimeout(() => {
            const filterContainer = document.getElementById('filter-container');
            const mapContainer = mainMapContainer;

            if (filterContainer && mapContainer) {
                const filterStyle = getComputedStyle(filterContainer);
                const marginBottom = parseFloat(filterStyle.marginBottom);
                const totalHeight = filterContainer.offsetHeight + mapContainer.offsetHeight + marginBottom;
                
                if (totalHeight > 0) {
                    infoPanel.style.height = `${totalHeight}px`;
                    infoPanel.style.minHeight = `${totalHeight}px`;
                }
            }
        }, 100); 
    }

    let pointsOfInterest = [];
    const defaultMapData = '../assets/data/maps/main_maps/map.json';
    const defaultMapImage = '../assets/img/maps/world_map.webp';
    const backBtn = document.getElementById('back-btn');
    let mapHistory = [];

    // --- Data Loading & Map Switching ---
    async function loadMapData(mapPath) {
        try {
            const response = await fetch(mapPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            pointsOfInterest = data.pointsOfInterest;
            renderPOIs();
            filterPOIs(); // Apply filters on initial load
            if (devMode) {
                initializeDevTools();
            }
            // Clear info panel when loading a new map
            infoPanel.innerHTML = '<div class="info-panel-placeholder"><p>Seleziona un punto di interesse sulla mappa per visualizzare i dettagli.</p></div>';
        } catch (error) {
            console.error("Could not load map data:", error);
            infoPanel.innerHTML = `<div class="info-panel-placeholder"><i class="fas fa-exclamation-triangle"></i><p>Errore nel caricamento dei dati della mappa.</p></div>`;
        }
    }

    function loadMap(mapDataPath, mapImagePath) {
        // Clear existing POIs immediately
        const existingPois = mapContent.querySelectorAll('.poi');
        existingPois.forEach(poi => poi.remove());

        mapImage.dataset.mapDataPath = mapDataPath; // Store the data path
        mapImage.src = mapImagePath;

        // Update back button visibility
        if (mapHistory.length > 0) {
            backBtn.style.display = 'block';
        } else {
            backBtn.style.display = 'none';
        }
        // The onload event will handle the rest
    }

    // --- Rendering ---
    function renderPOIs() {
        // Clear existing POIs before rendering new ones
        const existingPois = mapContent.querySelectorAll('.poi');
        existingPois.forEach(poi => poi.remove());
        
        pointsOfInterest.forEach(poiData => {
            const poiElement = document.createElement('div');
            poiElement.className = 'poi';
            poiElement.style.left = `${poiData.x}%`;
            poiElement.style.top = `${poiData.y}%`;
            poiElement.dataset.id = poiData.id;
            poiElement.dataset.type = poiData.type || 'Luogo Generico'; // Add data-type attribute

            const labelElement = document.createElement('span');
            labelElement.className = 'poi-label';
            labelElement.textContent = poiData.title;
            poiElement.appendChild(labelElement);

            poiElement.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent map click event from firing
                updateInfoPanel(poiData.id);
                document.querySelectorAll('.poi').forEach(p => p.classList.remove('active'));
                poiElement.classList.add('active');
            });

            mapContent.appendChild(poiElement);
        });
    }

    function filterPOIs() {
        const checkedTypes = Array.from(document.querySelectorAll('input[name="poi-type"]:checked')).map(cb => cb.value);
        document.querySelectorAll('.poi').forEach(poi => {
            if (checkedTypes.includes(poi.dataset.type)) {
                poi.classList.remove('hidden');
            } else {
                poi.classList.add('hidden');
            }
        });
    }

    document.querySelectorAll('input[name="poi-type"]').forEach(checkbox => {
        checkbox.addEventListener('change', filterPOIs);
    });

    function updateInfoPanel(poiId) {
        const poiData = pointsOfInterest.find(p => p.id === poiId);
        if (!poiData) return;

        infoPanel.innerHTML = `
            <div class="info-panel-header">
                <h2 class="title">${poiData.title}</h2>
                <p class="flavor-text">${poiData.flavor}</p>
            </div>
            <div class="info-panel-content">
                ${poiData.desc}
            </div>
        `;

        // Check for subMap and add 'ENTRA' button
        if (poiData.subMap && poiData.subMap.data && poiData.subMap.image) {
            const contentDiv = infoPanel.querySelector('.info-panel-content');
            
            const enterButton = document.createElement('button');
            enterButton.textContent = 'ENTRA';
            enterButton.className = 'enter-button'; // Add a class for styling
            enterButton.addEventListener('click', () => {
                // Push current map to history before loading the new one
                mapHistory.push({
                    data: mapImage.dataset.mapDataPath,
                    image: mapImage.src
                });
                loadMap(poiData.subMap.data, poiData.subMap.image);
            });

            contentDiv.appendChild(document.createElement('hr'));
            contentDiv.appendChild(enterButton);
        }
    }

    function resetPoiSelection() {
        document.querySelectorAll('.poi.active').forEach(p => p.classList.remove('active'));
        infoPanel.innerHTML = `
            <div class="info-panel-placeholder">
                <i class="fas fa-map-marked-alt"></i>
                <p>Seleziona un punto di interesse per visualizzare i dettagli.</p>
            </div>`;
    }

    // --- Dev Tools ---
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

        poisToSet.forEach(poi => {
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

    function updateDevToolsUI(poiId, x, y) {
        const li = document.querySelector(`#dev-poi-list li[data-id="${poiId}"]`);
        if (li) {
            li.textContent = `${li.textContent.split(' - ')[0]} - x: ${x.toFixed(2)}, y: ${y.toFixed(2)}`;
            li.style.fontWeight = 'normal';
            li.style.color = 'lime';
        }
    }

    // --- Map Interaction Logic ---
    let scale = 1;
    const minScale = 1;
    const maxScale = 8;
    let pan = { x: 0, y: 0 };
    let isPanning = false;
    let startPoint = { x: 0, y: 0 };
    let imageDimensions = { width: 0, height: 0, left: 0, top: 0 };

    const applyTransform = () => {
        const container = activeMapContainer;
        const scaledWidth = imageDimensions.width * scale;
        const scaledHeight = imageDimensions.height * scale;
        const minPanX = container.clientWidth - imageDimensions.left - scaledWidth;
        const maxPanX = -imageDimensions.left;
        const minPanY = container.clientHeight - imageDimensions.top - scaledHeight;
        const maxPanY = -imageDimensions.top;
        pan.x = Math.max(minPanX, Math.min(maxPanX, pan.x));
        pan.y = Math.max(minPanY, Math.min(maxPanY, pan.y));
        mapContent.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    };

    const setInitialPosition = () => {
        const container = activeMapContainer;
        if (!container) return;
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
        pan.x = 0; // Reset pan
        pan.y = 0; // Reset pan
        mapContent.style.width = `${imageDimensions.width}px`;
        mapContent.style.height = `${imageDimensions.height}px`;
        mapContent.style.left = `${imageDimensions.left}px`;
        mapContent.style.top = `${imageDimensions.top}px`;
        mapContent.style.transform = `translate(0px, 0px) scale(1)`; // Reset transform
        
        // Adjust the info panel height to match the map container
        if (container === mainMapContainer) {
            adjustInfoPanelHeight();
        }
    };

    document.body.addEventListener('wheel', (e) => {
        if (!e.target.closest('.map-container')) return;
        
        // Prevent page scrolling while zooming the map
        e.preventDefault();

        const rect = activeMapContainer.getBoundingClientRect();
        const oldScale = scale;
        const delta = e.deltaY > 0 ? -0.2 : 0.2;
        scale = Math.max(minScale, Math.min(scale + delta, maxScale));

        if (scale === oldScale) return;

        if (scale === minScale) {
            setInitialPosition();
        } else {
            const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const contentRect = mapContent.getBoundingClientRect();
            const mouseOnContentX = mouse.x - contentRect.left;
            const mouseOnContentY = mouse.y - contentRect.top;

            const newPanX = pan.x - mouseOnContentX * (scale / oldScale - 1);
            const newPanY = pan.y - mouseOnContentY * (scale / oldScale - 1);

            pan.x = newPanX;
            pan.y = newPanY;
            
            applyTransform();
        }
    }, { passive: false });

    document.body.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#map-content') || scale <= minScale) return;
        if (e.button !== 0) return;
        e.preventDefault();
        isPanning = true;
        activeMapContainer.style.cursor = 'grabbing';
        startPoint = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    });

    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            activeMapContainer.style.cursor = 'grab';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();
        pan.x = e.clientX - startPoint.x;
        pan.y = e.clientY - startPoint.y;
        applyTransform();
    });

    mapContent.addEventListener('click', (e) => {
        if (isPanning && (Math.abs(e.clientX - (startPoint.x + pan.x)) > 2 || Math.abs(e.clientY - (startPoint.y + pan.y)) > 2)) return;
        
        // If a POI was clicked, its own handler will manage the state.
        if (e.target.closest('.poi')) {
            return;
        }

        // If the map background is clicked, reset the active POI.
        resetPoiSelection();

        const rect = mapContent.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const percentX = (clickX / rect.width) * 100;
        const percentY = (clickY / rect.height) * 100;

        // Dev tools logic for placing or logging POIs.
        if (devMode) {
            if (selectedDevPoi) {
                const poi = pointsOfInterest.find(p => p.id === selectedDevPoi);
                if (poi) {
                    poi.x = percentX;
                    poi.y = percentY;
                    updateDevToolsUI(selectedDevPoi, percentX, percentY);
                    renderPOIs();
                    selectedDevPoi = null;
                }
            } else {
                console.log(`{ "id": "new-poi", "x": ${percentX.toFixed(2)}, "y": ${percentY.toFixed(2)}, "title": "New Point", "flavor": "Flavor text", "desc": "Description" },`);
            }
        }
    });

    // --- Fullscreen Handling ---
    window.updateActiveMapContainer = (is_fullscreen) => {
        activeMapContainer = is_fullscreen ? fullscreenMapContainer : mainMapContainer;
        setInitialPosition();
    };

    backBtn.addEventListener('click', () => {
        if (mapHistory.length > 0) {
            const previousMap = mapHistory.pop();
            loadMap(previousMap.data, previousMap.image);
        }
    });

    // --- Initialization ---
    mapImage.onload = () => {
        setInitialPosition();
        const mapDataPath = mapImage.dataset.mapDataPath || defaultMapData;
        loadMapData(mapDataPath);
    };

    if (mapImage.complete) {
        mapImage.onload();
    }
    
    // Initial load
    loadMap(defaultMapData, defaultMapImage);

    // Adjust panel on load and resize
    window.addEventListener('resize', setInitialPosition);
    adjustInfoPanelHeight(); // Also call it once on initial load
});