document.addEventListener('DOMContentLoaded', () => {
    const mapModal = document.getElementById('map-modal');
    const openBtn = document.getElementById('open-fullscreen-btn');
    const closeBtn = document.getElementById('close-fullscreen-btn');
    const togglePoiBtn = document.getElementById('toggle-poi-btn');

    const mainMapContainer = document.getElementById('map-container');
    const fullscreenMapContainer = document.getElementById('fullscreen-map-container');
    const mapContent = document.getElementById('map-content');

    let poisVisible = true;

    // Funzione per aprire il modal
    const openFullscreen = () => {
        // Sposta il contenuto della mappa nel contenitore del modal
        fullscreenMapContainer.appendChild(mapContent);
        mapModal.classList.add('visible');
        // Nasconde la sidebar per un'esperienza a schermo intero completa
        document.getElementById('sidebar-container').style.display = 'none';
        // Notifica a map.js che il contenitore è cambiato
        if (window.updateActiveMapContainer) {
            window.updateActiveMapContainer(true);
        }
    };

    // Funzione per chiudere il modal
    const closeFullscreen = () => {
        // Riporta il contenuto della mappa nel suo contenitore originale
        mainMapContainer.appendChild(mapContent);
        mapModal.classList.remove('visible');
        // Mostra di nuovo la sidebar
        document.getElementById('sidebar-container').style.display = 'block';
        // Notifica a map.js che il contenitore è cambiato
        if (window.updateActiveMapContainer) {
            window.updateActiveMapContainer(false);
        }
    };

    // Funzione per mostrare/nascondere i POI
    const togglePois = () => {
        poisVisible = !poisVisible;
        const poiElements = mapContent.querySelectorAll('.poi');
        poiElements.forEach(poi => {
            poi.style.display = poisVisible ? 'block' : 'none';
        });

        // Aggiorna lo stile del pulsante per dare un feedback visivo
        if (poisVisible) {
            togglePoiBtn.style.color = '#fff';
            togglePoiBtn.style.borderColor = 'var(--gold-dim)';
        } else {
            togglePoiBtn.style.color = '#666';
            togglePoiBtn.style.borderColor = '#444';
        }
    };

    // Associa gli eventi ai pulsanti
    openBtn.addEventListener('click', openFullscreen);
    closeBtn.addEventListener('click', closeFullscreen);
    togglePoiBtn.addEventListener('click', togglePois);

    // Chiudi il modal anche premendo il tasto 'Escape'
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mapModal.classList.contains('visible')) {
            closeFullscreen();
        }
    });
});