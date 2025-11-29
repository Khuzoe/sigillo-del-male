document.addEventListener("DOMContentLoaded", function() {
    const pathSegments = window.location.pathname.split("/").filter(Boolean);
    const currentPage = pathSegments[pathSegments.length - 1] || "index.html";

    const rootSegment = pathSegments[0] ? `/${pathSegments[0]}/` : "/";
    const siteRoot = new URL(rootSegment, window.location.origin);

    const sidebarUrl = new URL("sidebar.html", siteRoot).href;

    fetch(sidebarUrl)
        .then(response => {
            if (!response.ok) throw new Error("Errore caricamento sidebar");
            return response.text();
        })
        .then(html => {
            const container = document.getElementById("sidebar-container");
            if (container) {
                container.innerHTML = html;

                fixPaths(container, siteRoot);

                setActiveLink(currentPage);
            }
        })
        .catch(err => console.error("Errore sidebar:", err));
});

function fixPaths(container, siteRoot) {
    const links = container.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http') && !href.startsWith('#')) {
            link.setAttribute('href', new URL(href, siteRoot).href);
        }
    });

    const images = container.querySelectorAll('img');
    images.forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http')) {
            img.setAttribute('src', new URL(src, siteRoot).href);
        }
    });
}

function setActiveLink(currentPage) {
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

    const targetLink = Array.from(document.querySelectorAll('.nav-links a')).find(a => {
        const href = a.getAttribute('href') || "";
        return href.includes(currentPage);
    });

    if (targetLink) {
        targetLink.classList.add('active');
    } else if (currentPage === "index.html" || currentPage === "") {
        const homeLink = document.querySelector('.nav-links a[href*="index.html"]');
        if (homeLink) homeLink.classList.add('active');
    }
}
