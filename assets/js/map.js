document.addEventListener('DOMContentLoaded', async function() {
    const mapContainer = document.getElementById('map-container');
    const mapContent = document.getElementById('map-content');
    const mapImage = document.getElementById('map-image');
    const infoPanel = document.getElementById('info-panel');

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
        const scaledWidth = imageDimensions.width * scale;
        const scaledHeight = imageDimensions.height * scale;
        const minPanX = mapContainer.clientWidth - imageDimensions.left - scaledWidth;
        const maxPanX = -imageDimensions.left;
        const minPanY = mapContainer.clientHeight - imageDimensions.top - scaledHeight;
        const maxPanY = -imageDimensions.top;
        pan.x = Math.max(minPanX, Math.min(maxPanX, pan.x));
        pan.y = Math.max(minPanY, Math.min(maxPanY, pan.y));
        mapContent.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    };

    const setInitialPosition = () => {
        const containerRatio = mapContainer.clientWidth / mapContainer.clientHeight;
        const imageRatio = mapImage.naturalWidth / mapImage.naturalHeight;
        if (containerRatio > imageRatio) {
            imageDimensions.height = mapContainer.clientHeight;
            imageDimensions.width = imageDimensions.height * imageRatio;
        } else {
            imageDimensions.width = mapContainer.clientWidth;
            imageDimensions.height = imageDimensions.width / imageRatio;
        }
        imageDimensions.left = (mapContainer.clientWidth - imageDimensions.width) / 2;
        imageDimensions.top = (mapContainer.clientHeight - imageDimensions.height) / 2;
        scale = 1;
        pan.x = imageDimensions.left;
        pan.y = imageDimensions.top;
        applyTransform();
    };

    mapContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = mapContainer.getBoundingClientRect();
        const oldScale = scale;
        const delta = e.deltaY > 0 ? -0.2 : 0.2;
        scale = Math.max(minScale, Math.min(scale + delta, maxScale));
        if (scale === oldScale) return;
        const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        pan.x = mouse.x - (mouse.x - pan.x) * (scale / oldScale);
        pan.y = mouse.y - (mouse.y - pan.y) * (scale / oldScale);
        applyTransform();
    });

    mapContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        isPanning = true;
        mapContainer.style.cursor = 'grabbing';
        startPoint = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    });

    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            mapContainer.style.cursor = 'grab';
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

        const rect = mapContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const contentX = (mouseX - pan.x) / scale;
        const contentY = (mouseY - pan.y) / scale;
        const percentX = (contentX / mapContent.clientWidth) * 100;
        const percentY = (contentY / mapContent.clientHeight) * 100;
        console.log(`{ "id": "new-poi", "x": ${percentX.toFixed(2)}, "y": ${percentY.toFixed(2)}, "title": "New Point", "flavor": "Flavor text", "desc": "Description" },`);
    });

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
