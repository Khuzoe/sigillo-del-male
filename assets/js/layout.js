const SIDEBAR_CACHE_KEY = "wiki_sidebar_html_v1";
const prefetchedUrls = new Set();

document.addEventListener("DOMContentLoaded", function () {
    const scriptTag = document.querySelector('script[src*="layout.js"]');
    let basePath = "";

    if (scriptTag) {
        const src = scriptTag.getAttribute("src") || "";
        basePath = src.replace("assets/js/layout.js", "");
    }

    bindPrefetchForLinks(document);
    loadSidebar(basePath);
});

function loadSidebar(basePath) {
    if (window.SIDEBAR_HTML) {
        cacheSidebar(window.SIDEBAR_HTML);
        initSidebar(window.SIDEBAR_HTML, basePath);
        return;
    }

    const cached = readSidebarCache();
    if (cached) {
        initSidebar(cached, basePath);
        fetchSidebar(basePath, cached);
        return;
    }

    renderSidebarSkeleton();
    fetchSidebar(basePath, "");
}

function fetchSidebar(basePath, previousHtml) {
    const sidebarUrl = basePath + "sidebar.html";

    fetch(sidebarUrl)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.text();
        })
        .then(html => {
            if (!html) return;
            cacheSidebar(html);

            // If there was no cache, render now.
            // If cache exists but differs, refresh rendered sidebar.
            if (!previousHtml || previousHtml !== html) {
                initSidebar(html, basePath);
            }
        })
        .catch(err => {
            if (!previousHtml) {
                console.error("Errore caricamento sidebar:", err);
            }
        });
}

function readSidebarCache() {
    try {
        return window.sessionStorage.getItem(SIDEBAR_CACHE_KEY) || "";
    } catch (_) {
        return "";
    }
}

function cacheSidebar(html) {
    try {
        window.sessionStorage.setItem(SIDEBAR_CACHE_KEY, html);
    } catch (_) {
        // Ignore quota or privacy mode errors
    }
}

function initSidebar(html, basePath) {
    const container = document.getElementById("sidebar-container");
    if (!container) return;

    container.innerHTML = html;
    fixPaths(container, basePath);
    setActiveLink();
    bindPrefetchForLinks(container);
}

function renderSidebarSkeleton() {
    const container = document.getElementById("sidebar-container");
    if (!container) return;
    if (container.children.length > 0) return;

    container.innerHTML = `
        <div class="sidebar-skeleton" aria-hidden="true">
            <div class="skel-logo shimmer"></div>
            <div class="skel-group">
                <div class="skel-line shimmer"></div>
                <div class="skel-line shimmer"></div>
                <div class="skel-line shimmer"></div>
                <div class="skel-line shimmer"></div>
                <div class="skel-line shimmer"></div>
                <div class="skel-line shimmer"></div>
            </div>
            <div class="skel-footer shimmer"></div>
        </div>
    `;
}

function fixPaths(container, basePath) {
    if (!basePath) return;

    const links = container.querySelectorAll("a");
    links.forEach(link => {
        const href = link.getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith("#") && !href.startsWith("mailto:")) {
            link.setAttribute("href", basePath + href);
        }
    });

    const images = container.querySelectorAll("img");
    images.forEach(img => {
        const src = img.getAttribute("src");
        if (src && !src.startsWith("http") && !src.startsWith("data:")) {
            img.setAttribute("src", basePath + src);
        }
    });
}

function setActiveLink() {
    const path = window.location.pathname;
    const page = path.split("/").pop() || "index.html";

    document.querySelectorAll(".nav-links a").forEach(a => a.classList.remove("active"));

    let targetLink = null;
    const allLinks = document.querySelectorAll(".nav-links a");

    allLinks.forEach(link => {
        const href = link.getAttribute("href");
        if (href && href.endsWith(page)) {
            targetLink = link;
        }
    });

    if (!targetLink && (page === "index.html" || page === "")) {
        targetLink = document.querySelector('.nav-links a[href*="index.html"]');
    }

    if (targetLink) {
        targetLink.classList.add("active");
    }
}

function bindPrefetchForLinks(scope) {
    const links = scope.querySelectorAll ? scope.querySelectorAll("a[href]") : [];
    links.forEach(link => {
        const prime = () => prefetchUrl(link.href, link.getAttribute("href") || "");
        link.addEventListener("mouseenter", prime, { once: true });
        link.addEventListener("touchstart", prime, { once: true, passive: true });
        link.addEventListener("focus", prime, { once: true });
    });
}

function prefetchUrl(absoluteUrl, rawHref) {
    if (!rawHref) return;
    if (rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) return;

    try {
        const target = new URL(absoluteUrl, window.location.href);
        const current = new URL(window.location.href);

        if (target.origin !== current.origin) return;
        if (target.hash && target.pathname === current.pathname && target.search === current.search) return;
        if (target.protocol !== "http:" && target.protocol !== "https:") return;
        if (target.href === current.href) return;
        if (prefetchedUrls.has(target.href)) return;

        const hint = document.createElement("link");
        hint.rel = "prefetch";
        hint.as = "document";
        hint.href = target.href;
        document.head.appendChild(hint);

        prefetchedUrls.add(target.href);
    } catch (_) {
        // Ignore malformed URLs
    }
}
