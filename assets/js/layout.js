document.addEventListener("DOMContentLoaded", function () {
    // 1. TROVIAMO LA "BASE PATH" (La radice del sito relativa alla pagina corrente)
    // Cerchiamo il tag script che ha caricato questo file
    const scriptTag = document.querySelector('script[src*="layout.js"]');
    let basePath = "";

    if (scriptTag) {
        const src = scriptTag.getAttribute("src");
        // Esempio: se src è "../../assets/js/layout.js", la basePath diventa "../../"
        // Esempio: se src è "assets/js/layout.js", la basePath diventa "" (stringa vuota)
        basePath = src.replace("assets/js/layout.js", "");
    }

    // 2. CARICHIAMO LA SIDEBAR
    // Metodo ibrido: se una pagina espone già window.SIDEBAR_HTML, usiamo quello.
    // Altrimenti proviamo fetch (per dev server).

    if (window.SIDEBAR_HTML) {
        initSidebar(window.SIDEBAR_HTML, basePath);
    } else {
        const sidebarUrl = basePath + "sidebar.html";
        fetch(sidebarUrl)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.text();
            })
            .then(html => initSidebar(html, basePath))
            .catch(err => console.error("Errore caricamento sidebar:", err));
    }
});

function initSidebar(html, basePath) {
    const container = document.getElementById("sidebar-container");
    if (container) {
        container.innerHTML = html;
        fixPaths(container, basePath);
        setActiveLink();
    }
}

function fixPaths(container, basePath) {
    // Se siamo nella root (basePath vuoto), non serve correggere nulla
    if (!basePath) return;

    // Correggi i link (<a>)
    const links = container.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href');
        // Ignora link assoluti (http), ancore (#) o mailto
        if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
            link.setAttribute('href', basePath + href);
        }
    });

    // Correggi le immagini (<img>)
    const images = container.querySelectorAll('img');
    images.forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
            img.setAttribute('src', basePath + src);
        }
    });
}

function setActiveLink() {
    // Ottieni il nome del file corrente (es. "rabberduscolanderson.html" o "index.html")
    const path = window.location.pathname;
    const page = path.split("/").pop() || "index.html";

    // Rimuovi la classe active da tutti
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

    // Cerca il link che corrisponde
    let targetLink = null;

    // Metodo 1: Controllo esatto del href (utile se i link nella sidebar sono specifici)
    // Nota: i link sono stati modificati da fixPaths, quindi controlliamo la parte finale
    const allLinks = document.querySelectorAll('.nav-links a');

    allLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.endsWith(page)) {
            targetLink = link;
        }
    });

    // Se non troviamo corrispondenza esatta, proviamo con l'attributo data-page (più sicuro)
    // Assicurati che nella tua sidebar.html i link abbiano data-page="nome"
    if (!targetLink) {
        // Logica di fallback per index
        if (page === "index.html" || page === "") {
            targetLink = document.querySelector('.nav-links a[href*="index.html"]');
        }
    }

    if (targetLink) {
        targetLink.classList.add('active');
    }
}
