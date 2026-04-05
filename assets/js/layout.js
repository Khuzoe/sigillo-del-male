const SIDEBAR_CACHE_KEY = "wiki_sidebar_html_v1";
const DISCORD_WORKER_URL = "https://sigillo-api.khuzoe.workers.dev";
const DISCORD_TOKEN_KEY = "discord_jwt";
const prefetchedUrls = new Set();
let discordAuthCache = null;
let discordAuthPromise = null;

document.addEventListener("DOMContentLoaded", function () {
    const scriptTag = document.querySelector('script[src*="layout.js"]');
    let basePath = "";

    if (scriptTag) {
        const src = scriptTag.getAttribute("src") || "";
        basePath = src.replace("assets/js/layout.js", "");
    }

    ensureFavicon(basePath);
    bindPrefetchForLinks(document);
    loadSidebar(basePath);
});

function ensureFavicon(basePath) {
    const faviconHref = `${basePath}assets/img/ui/tab_icon.webp`;
    const iconSelectors = [
        { rel: "icon", type: "image/webp" },
        { rel: "shortcut icon", type: "image/webp" }
    ];

    iconSelectors.forEach(({ rel, type }) => {
        let link = document.head.querySelector(`link[rel="${rel}"]`);
        if (!link) {
            link = document.createElement("link");
            link.rel = rel;
            document.head.appendChild(link);
        }
        link.type = type;
        link.href = faviconHref;
    });
}

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
    initDiscordAuth(container);
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

function initDiscordAuth(scope) {
    const status = scope.querySelector("#auth-status");
    const loginBtn = scope.querySelector("#discord-login");
    const logoutBtn = scope.querySelector("#discord-logout");
    if (!status || !loginBtn || !logoutBtn) return;

    const didConsumeToken = consumeTokenFromHash();
    if (didConsumeToken) {
        window.location.replace(window.location.pathname + window.location.search);
        return;
    }

    loginBtn.addEventListener("click", () => {
        window.location.href = `${DISCORD_WORKER_URL}/auth/discord/login`;
    });

    logoutBtn.addEventListener("click", () => {
        clearStoredToken();
        window.location.replace(window.location.pathname + window.location.search);
    });

    refreshAuthUI(scope);
}

function tokenFromHash() {
    const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
    if (!hash) return "";

    const params = new URLSearchParams(hash);
    return params.get("token") || "";
}

function consumeTokenFromHash() {
    const token = tokenFromHash();
    if (!token) return false;

    storeToken(token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
}

async function refreshAuthUI(scope) {
    const status = scope.querySelector("#auth-status");
    const loginBtn = scope.querySelector("#discord-login");
    const logoutBtn = scope.querySelector("#discord-logout");
    if (!status || !loginBtn || !logoutBtn) return;

    const token = readStoredToken();
    if (!token) {
        setLoggedOutState(status, loginBtn, logoutBtn);
        return;
    }

    status.textContent = "Verifica login...";
    loginBtn.hidden = true;
    logoutBtn.hidden = false;

    try {
        const authState = await verifyDiscordAuth();
        if (!authState?.user) {
            setLoggedOutState(status, loginBtn, logoutBtn);
            return;
        }
        const username = authState.user.global_name || authState.user.username || "utente Discord";
        status.textContent = `Loggato come ${username}`;
        loginBtn.hidden = true;
        logoutBtn.hidden = false;
    } catch (_) {
        status.textContent = "Errore verifica login";
        loginBtn.hidden = true;
        logoutBtn.hidden = false;
    }
}

function setLoggedOutState(status, loginBtn, logoutBtn) {
    status.textContent = "Non loggato";
    loginBtn.hidden = false;
    logoutBtn.hidden = true;
}

function readStoredToken() {
    try {
        return window.localStorage.getItem(DISCORD_TOKEN_KEY) || "";
    } catch (_) {
        return "";
    }
}

function storeToken(token) {
    try {
        window.localStorage.setItem(DISCORD_TOKEN_KEY, token);
        discordAuthCache = null;
        discordAuthPromise = null;
    } catch (_) {
        // Ignore storage restrictions
    }
}

function clearStoredToken() {
    try {
        window.localStorage.removeItem(DISCORD_TOKEN_KEY);
        discordAuthCache = null;
        discordAuthPromise = null;
    } catch (_) {
        // Ignore storage restrictions
    }
}

async function verifyDiscordAuth() {
    if (discordAuthCache?.user) {
        return discordAuthCache;
    }

    if (discordAuthPromise) {
        return discordAuthPromise;
    }

    const token = readStoredToken();
    if (!token) {
        return null;
    }

    discordAuthPromise = (async () => {
        try {
            const response = await fetch(`${DISCORD_WORKER_URL}/auth/discord/verify`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    clearStoredToken();
                }
                return null;
            }

            const data = await response.json();
            if (!data?.user) {
                clearStoredToken();
                return null;
            }

            discordAuthCache = data;
            return data;
        } finally {
            discordAuthPromise = null;
        }
    })();

    return discordAuthPromise;
}

window.CriptaDiscordAuth = {
    getToken: readStoredToken,
    verify: verifyDiscordAuth
};
