document.addEventListener('DOMContentLoaded', function() {
    const mapContainer = document.getElementById('map-container');
    const mapWrapper = document.getElementById('map-wrapper');

    let scale = 1;
    const minScale = 1;
    const maxScale = 5;
    
    let pan = { x: 0, y: 0 };
    let isPanning = false;
    let startPoint = { x: 0, y: 0 };
    
    // This will hold the calculated initial offset
    let initialOffset = { x: 0, y: 0 };

    const applyTransform = () => {
        const containerRect = mapContainer.getBoundingClientRect();
        // Use offsetWidth/Height to get the raw, untransformed dimensions
        const scaledWidth = mapWrapper.offsetWidth * scale;
        const scaledHeight = mapWrapper.offsetHeight * scale;

        // Prevent panning beyond the image boundaries
        // maxPan is the top-left limit (most positive value)
        // minPan is the bottom-right limit (most negative value)
        const maxPanX = initialOffset.x;
        const minPanX = containerRect.width - scaledWidth - initialOffset.x;
        const maxPanY = initialOffset.y;
        const minPanY = containerRect.height - scaledHeight - initialOffset.y;

        pan.x = Math.max(minPanX, Math.min(maxPanX, pan.x));
        pan.y = Math.max(minPanY, Math.min(maxPanY, pan.y));

        mapWrapper.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
    };
    
    const setInitialPosition = () => {
        const containerRect = mapContainer.getBoundingClientRect();
        // Use offsetWidth/Height to get the raw, untransformed dimensions
        const mapWidth = mapWrapper.offsetWidth;
        const mapHeight = mapWrapper.offsetHeight;
        
        const scaleRatio = Math.min(containerRect.width / mapWidth, containerRect.height / mapHeight);
        const newWidth = mapWidth * scaleRatio;
        const newHeight = mapHeight * scaleRatio;

        initialOffset.x = (containerRect.width - newWidth) / 2;
        initialOffset.y = (containerRect.height - newHeight) / 2;
        
        // On resize, reset the view to default
        scale = 1;
        pan.x = initialOffset.x;
        pan.y = initialOffset.y;

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
        e.preventDefault();
        isPanning = true;
        mapContainer.style.cursor = 'grabbing';
        startPoint = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    });
    
    document.addEventListener('mouseup', () => {
        isPanning = false;
        mapContainer.style.cursor = 'grab';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();
        pan.x = e.clientX - startPoint.x;
        pan.y = e.clientY - startPoint.y;
        applyTransform();
    });
    
    // Use timeout to ensure image dimensions are available on first load
    setTimeout(setInitialPosition, 50);
    window.addEventListener('resize', setInitialPosition);


    // --- Points Of Interest ---
    const pointsOfInterest = [
        { id: 'poi-1', x: 25, y: 30, title: 'Cristalli Verdi' },
        { id: 'poi-2', x: 70, y: 25, title: 'Vulcano' },
        { id: 'poi-3', x: 75, y: 80, title: 'Regno di Ghiaccio' },
        { id: 'poi-4', x: 20, y: 80, title: 'Isole Fluttuanti' },
        { id: 'poi-5', x: 50, y: 60, title: 'Foresta Viola' }
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

        mapWrapper.appendChild(poiElement);
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
