document.addEventListener('DOMContentLoaded', async function() {
    const mainMapContainer = document.getElementById('map-container');
    const fullscreenMapContainer = document.getElementById('fullscreen-map-container');
    const mapContent = document.getElementById('map-content');
    const mapImage = document.getElementById('map-image');
    const infoPanel = document.getElementById('info-panel');
    let activeMapContainer = mainMapContainer;

    let pointsOfInterest = [];

    // --- Data Loading ---
    async function loadMapData() {
        try {
            const response = await fetch('../assets/data/map.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            pointsOfInterest = data.pointsOfInterest;
            renderPOIs();
        } catch (error) {
            console.error("Could not load map data:", error);
            infoPanel.innerHTML = `<div class="info-panel-placeholder"><i class="fas fa-exclamation-triangle"></i><p>Errore nel caricamento dei dati della mappa.</p></div>`;
        }
    }

    // --- Rendering ---
    function renderPOIs() {
        // Clear existing POIs
        const existingPois = mapContent.querySelectorAll('.poi');
        existingPois.forEach(poi => poi.remove());
        
        pointsOfInterest.forEach(poiData => {
            const poiElement = document.createElement('div');
            poiElement.className = 'poi';
            poiElement.style.left = `${poiData.x}%`;
            poiElement.style.top = `${poiData.y}%`;
            poiElement.dataset.id = poiData.id;

            // Create and append the label
            const labelElement = document.createElement('span');
            labelElement.className = 'poi-label';
            labelElement.textContent = poiData.title;
            poiElement.appendChild(labelElement);

            poiElement.addEventListener('click', () => {
                updateInfoPanel(poiData.id);
                
                // Highlight the active POI
                document.querySelectorAll('.poi').forEach(p => p.classList.remove('active'));
                poiElement.classList.add('active');
            });

            mapContent.appendChild(poiElement);
        });
    }

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
        pan.x = imageDimensions.left;
        pan.y = imageDimensions.top;
        applyTransform();
    };

    document.body.addEventListener('wheel', (e) => {
        // Ascolta lo zoom solo se il cursore è sopra un contenitore della mappa
        if (!e.target.closest('.map-container')) return;
        e.preventDefault();
        const rect = activeMapContainer.getBoundingClientRect();
        const oldScale = scale;
        const delta = e.deltaY > 0 ? -0.2 : 0.2;
        scale = Math.max(minScale, Math.min(scale + delta, maxScale));
        if (scale === oldScale) return;
        const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        pan.x = mouse.x - (mouse.x - pan.x) * (scale / oldScale);
        pan.y = mouse.y - (mouse.y - pan.y) * (scale / oldScale);
        applyTransform();
    });

    document.body.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.map-container')) return;
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
        const dx = Math.abs(e.clientX - (startPoint.x + pan.x));
        const dy = Math.abs(e.clientY - (startPoint.y + pan.y));
        if (isPanning && (dx > 2 || dy > 2)) return;

        // Check if the click was on a POI
        if (e.target.classList.contains('poi')) {
            return;
        }

        const rect = activeMapContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const contentX = (mouseX - pan.x) / scale;
        const contentY = (mouseY - pan.y) / scale;
        const percentX = (contentX / mapContent.clientWidth) * 100;
        const percentY = (contentY / mapContent.clientHeight) * 100;
        console.log(`{ "id": "new-poi", "x": ${percentX.toFixed(2)}, "y": ${percentY.toFixed(2)}, "title": "New Point", "flavor": "Flavor text", "desc": "Description" },`);
    });

    // --- Fullscreen Handling ---
    // Expose a function to be called from map-fullscreen.js
    window.updateActiveMapContainer = (is_fullscreen) => {
        if (is_fullscreen) {
            activeMapContainer = fullscreenMapContainer;
        } else {
            activeMapContainer = mainMapContainer;
        }
        setInitialPosition(); // Recalculate dimensions and position
    };

    // --- Initialization ---
    if (mapImage.complete) {
        setInitialPosition();
        loadMapData();
    } else {
        mapImage.onload = () => {
            setInitialPosition();
            loadMapData();
        };
    }
    window.addEventListener('resize', setInitialPosition);
});
