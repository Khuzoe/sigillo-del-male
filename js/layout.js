document.addEventListener("DOMContentLoaded", function() {
    // 1. Capiamo dove ci troviamo
    const path = window.location.pathname;
    const pageName = path.split("/").pop() || "index.html"; // es: "giocatori.html"
    const isPagesFolder = path.includes("/pages/"); // True se siamo in una sottocartella

    // 2. Determiniamo il percorso per trovare sidebar.html
    // Se siamo in /pages/, dobbiamo tornare indietro di uno (../)
    const rootPrefix = isPagesFolder ? "../" : "./";
    const sidebarUrl = rootPrefix + "sidebar.html";

    // 3. Carichiamo la Sidebar
    fetch(sidebarUrl)
        .then(response => {
            if (!response.ok) throw new Error("Errore caricamento sidebar");
            return response.text();
        })
        .then(html => {
            // Inseriamo l'HTML nel contenitore
            const container = document.getElementById("sidebar-container");
            if (container) {
                container.innerHTML = html;
                
                // 4. Correggiamo i percorsi (Link e Immagini)
                // Se siamo dentro /pages/, dobbiamo aggiungere "../" a tutti i link e le immagini
                if (isPagesFolder) {
                    fixPaths(container);
                }

                // 5. Attiviamo il link corrente (Highlight)
                setActiveLink(pageName);
            }
        })
        .catch(err => console.error("Errore sidebar:", err));
});

// Funzione per correggere i percorsi (aggiunge ../ se necessario)
function fixPaths(container) {
    // Corregge i link <a>
    const links = container.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href');
        // Non toccare link assoluti (http) o ancore (#)
        if (href && !href.startsWith('http') && !href.startsWith('#')) {
            link.setAttribute('href', '../' + href);
        }
    });

    // Corregge le immagini <img>
    const images = container.querySelectorAll('img');
    images.forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http')) {
            img.setAttribute('src', '../' + src);
        }
    });
}

// Funzione per illuminare il tasto della pagina corrente
function setActiveLink(currentPage) {
    // Rimuove 'active' da tutti
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

    // Cerca il link che corrisponde alla pagina attuale
    // Nota: usiamo includes perché l'href potrebbe essere "pages/giocatori.html" o "../pages/giocatori.html"
    const targetLink = Array.from(document.querySelectorAll('.nav-links a')).find(a => {
        return a.getAttribute('href').includes(currentPage);
    });

    if (targetLink) {
        targetLink.classList.add('active');
    } else {
        // Fallback: se siamo sulla home (index.html o root), illumina il primo link
        if (currentPage === "index.html" || currentPage === "") {
             const homeLink = document.querySelector('.nav-links a[href*="index.html"]');
             if(homeLink) homeLink.classList.add('active');
        }
    }
}