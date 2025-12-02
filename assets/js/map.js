document.addEventListener('DOMContentLoaded', function() {
    const mapContainer = document.getElementById('map-container');
    const mapContent = document.getElementById('map-content');
    const mapImage = document.getElementById('map-image');

    let scale = 1;
    const minScale = 1;
    const maxScale = 8; // Increased max zoom
    
    let pan = { x: 0, y: 0 };
    let isPanning = false;
    let startPoint = { x: 0, y: 0 };
    
    // This will hold the true dimensions of the displayed image inside the container
    let imageDimensions = { width: 0, height: 0, left: 0, top: 0 };

    const applyTransform = () => {
        const scaledWidth = imageDimensions.width * scale;
        const scaledHeight = imageDimensions.height * scale;

        // Clamp panning to keep the image within the container view
        const minPanX = mapContainer.clientWidth - imageDimensions.left - scaledWidth;
        const maxPanX = -imageDimensions.left;
        const minPanY = mapContainer.clientHeight - imageDimensions.top - scaledHeight;
        const maxPanY = -imageDimensions.top;
        
        pan.x = Math.max(minPanX, Math.min(maxPanX, pan.x));
        pan.y = Math.max(minPanY, Math.min(maxPanY, pan.y));
        
        mapContent.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    };
    
    const setInitialPosition = () => {
        // Calculate the actual size and position of the 'contained' image
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
        
        // Reset view
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
        if (e.button !== 0) return; // Only pan on left-click
        e.preventDefault();
        isPanning = true;
        mapContainer.style.cursor = 'grabbing';
        startPoint = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    });
    
    document.addEventListener('mouseup', (e) => {
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
    
    // --- NEW: Coordinate logging feature ---
    mapContent.addEventListener('click', (e) => {
        // This check prevents logging a coordinate when a pan drag ends
        const dx = Math.abs(e.clientX - (startPoint.x + pan.x));
        const dy = Math.abs(e.clientY - (startPoint.y + pan.y));
        if (isPanning && (dx > 2 || dy > 2)) {
             return;
        }

        const rect = mapContainer.getBoundingClientRect();
        
        // Mouse position relative to the container
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Position of the click on the scaled and panned content
        const contentX = (mouseX - pan.x) / scale;
        const contentY = (mouseY - pan.y) / scale;
        
        // Calculate the percentage relative to the content wrapper's dimensions
        const percentX = (contentX / mapContent.clientWidth) * 100;
        const percentY = (contentY / mapContent.clientHeight) * 100;

        console.log(`{ x: ${percentX.toFixed(2)}, y: ${percentY.toFixed(2)}, title: 'New Point' },`);
    });

    // --- Initialization ---
    mapImage.onload = setInitialPosition;
    if (mapImage.complete) {
        setInitialPosition();
    }
    window.addEventListener('resize', setInitialPosition);


    // --- Points Of Interest ---
    const pointsOfInterest = [
        { id: 'poi-1', x: 25, y: 30, title: 'Cristalli Verdi' },
        { id: 'poi-2', x: 70, y: 25, title: 'Vulcano' },
        { id: 'poi-3', x: 75, y: 80, title: 'Regno di Ghiaccio' },
        { id: 'poi-4', x: 20, y: 80, title: 'Isole Fluttuanti' },
        { id: 'poi-5', x: 50, y: 60, title: 'Foresta Viola' },
        { id: 'poi-6', x: 66.62, y: 36.22, title: 'New Point' }
    ];

    pointsOfInterest.forEach(poiData => {
        const poiElement = document.createElement('div');
        poiElement.className = 'poi';
        poiElement.style.left = `${poiData.x}%`;
        poiElement.style.top = `${poiData.y}%`;

        const tooltip = document.createElement('div');
        tooltip.className = 'poi-tooltip';
        tooltip.textContent = poiData.title;
        poiElement.appendChild(tooltip);

        mapContent.appendChild(poiElement);
    });
    
    const style = document.createElement('style');
    style.innerHTML = `
        .poi-tooltip {
            position: absolute;
            bottom: 150%;
            left: 50%;
            transform: translateX(-50%);
            background-color: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 5px 10px;
            border-radius: 5px;
            white-space: nowrap;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s, visibility 0.2s;
            font-size: 14px;
            font-family: 'Montserrat', sans-serif;
            pointer-events: none;
        }
        .poi:hover .poi-tooltip {
            opacity: 1;
            visibility: visible;
        }
    `;
    document.head.appendChild(style);
});
