const SIDEBAR_CACHE_KEY = "wiki_sidebar_html_v2";
const DISCORD_WORKER_URL = "https://sigillo-api.khuzoe.workers.dev";
const DISCORD_TOKEN_KEY = "discord_jwt";
const EMBED_SCRIPT_WARMUP_PATHS = [
    "assets/js/pages/index.js",
    "assets/js/pages/npcs.js",
    "assets/js/pages/giocatori.js",
    "assets/js/pages/missioni.js",
    "assets/js/pages/sessioni.js",
    "assets/js/pages/bestiario.js",
    "assets/js/pages/oggetti.js",
    "assets/js/pages/appunti.js",
    "assets/js/pages/famiglia-von-t.js"
];
const prefetchedUrls = new Set();
const loadedSpaScripts = new Set();
const pageScopes = new Map();
const initialInlineHeadStyles = new WeakSet();
let discordAuthCache = null;
let discordAuthPromise = null;
let dmDiscordIdCache = null;
let dmDiscordIdPromise = null;
const jsonCache = new Map();
const isEmbedMode = new URLSearchParams(window.location.search).get("embed") === "1";
const isEmbeddedRuntime = isEmbedMode || window.self !== window.top;
let embeddedDiscordToken = "";
let embeddedDiscordPopup = null;
let spaNavigationInProgress = false;

document.addEventListener("DOMContentLoaded", function () {
    const scriptTag = document.querySelector('script[src*="layout.js"]');
    let basePath = "";

    if (scriptTag) {
        const src = scriptTag.getAttribute("src") || "";
        basePath = src.replace("assets/js/layout.js", "");
    }

    window.CriptaBasePath = basePath;
    document.body.classList.toggle("is-embed", isEmbeddedRuntime);
    consumeEmbeddedTokenFromQuery();

    markInitialInlineHeadStyles();
    ensureFavicon(basePath);
    bindPrefetchForLinks(document);
    setDmOnlyVisibility(false);
    window.addEventListener("message", handleEmbeddedAuthMessage);
    loadSidebar(basePath);
    warmEmbedSectionScripts(basePath);
    initPageAccessControls(basePath);
    markInitialSpaScripts();
    initSpaNavigation();
    window.requestAnimationFrame(() => {
        document.body.classList.add("page-ready");
    });
});

function getCurrentPageId(url = window.location.href) {
    const target = new URL(url, window.location.href);
    if (target.pathname.endsWith("/")) return "index";

    const pathname = target.pathname.replace(/\/+$/, "");
    const filename = pathname.split("/").pop() || "index.html";
    if (!filename || filename === "index.html") return "index";
    if (filename === "character.html") return "character";
    return filename.replace(/\.html$/i, "");
}

function onPageReady(pageId, init) {
    if (typeof init !== "function") return;

    const run = (event) => {
        if (pageId && getCurrentPageId() !== pageId) return;
        init(event);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run, { once: true });
    } else if (!spaNavigationInProgress) {
        run({ type: "initial" });
    }

    document.addEventListener("cripta:spa-ready", run);
}

function initSpaNavigation() {
    document.addEventListener("click", (event) => {
        const link = event.target?.closest?.("a[href]");
        if (!shouldHandleSpaClick(event, link)) return;

        const targetUrl = buildSpaTargetUrl(link.href);
        if (!targetUrl) return;

        event.preventDefault();
        navigateSpa(targetUrl, { push: true });
    });

    window.addEventListener("popstate", () => {
        navigateSpa(window.location.href, { push: false });
    });
}

function shouldHandleSpaClick(event, link) {
    if (!link) return false;
    if (event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (link.target && link.target !== "_self") return false;
    if (link.hasAttribute("download")) return false;

    const rawHref = link.getAttribute("href") || "";
    if (!rawHref || rawHref.startsWith("#")) return false;
    if (/^(mailto|tel|javascript):/i.test(rawHref)) return false;

    try {
        const target = new URL(link.href, window.location.href);
        const current = new URL(window.location.href);
        if (target.origin !== current.origin) return false;
        if (!/\.html$/i.test(target.pathname) && !target.pathname.endsWith("/")) return false;
        if (target.pathname === current.pathname && target.search === current.search) {
            return Boolean(target.hash && target.hash !== current.hash);
        }
        return true;
    } catch (_) {
        return false;
    }
}

function buildSpaTargetUrl(href) {
    try {
        const target = new URL(href, window.location.href);
        if (isEmbedMode && !target.searchParams.has("embed")) {
            target.searchParams.set("embed", "1");
        }
        return target.toString();
    } catch (_) {
        return "";
    }
}

async function navigateSpa(targetUrl, options = {}) {
    const { push = true } = options;
    const target = new URL(targetUrl, window.location.href);
    const current = new URL(window.location.href);

    if (target.pathname === current.pathname && target.search === current.search && target.hash) {
        if (push) history.pushState({}, "", target.toString());
        scrollToCurrentHash();
        return;
    }

    const currentMain = document.querySelector("main");
    if (!currentMain || spaNavigationInProgress) {
        window.location.href = target.toString();
        return;
    }

    spaNavigationInProgress = true;
    document.body.classList.add("spa-loading");
    currentMain.setAttribute("aria-busy", "true");

    try {
        const response = await fetch(target.toString(), {
            headers: { Accept: "text/html" },
            credentials: "same-origin"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const nextDocument = new DOMParser().parseFromString(html, "text/html");
        const nextMain = nextDocument.querySelector("main");
        if (!nextMain) throw new Error("Pagina senza contenuto principale.");

        const importedMain = document.importNode(nextMain, true);
        const nextScripts = getSpaScriptSources(nextDocument, target);

        if (push) {
            history.pushState({}, "", target.toString());
        }

        document.title = nextDocument.title || document.title;
        syncSpaHead(nextDocument, target);
        syncBodyState(nextDocument);
        disposePageScopes();
        removeSpaExtras();
        currentMain.replaceWith(importedMain);
        appendSpaExtras(nextDocument);

        window.CriptaBasePath = computeBasePathForUrl(target);
        ensureFavicon(window.CriptaBasePath);
        fixPaths(document.getElementById("sidebar-container"), window.CriptaBasePath);
        bindPrefetchForLinks(document.querySelector("main"));
        setActiveLink();
        setDmOnlyVisibility(false);
        initPageAccessControls(window.CriptaBasePath);

        await loadSpaScripts(nextScripts);
        document.dispatchEvent(new CustomEvent("cripta:spa-ready", {
            detail: {
                pageId: getCurrentPageId(target.toString()),
                url: target.toString()
            }
        }));

        if (target.hash) scrollToCurrentHash();
        else window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch (error) {
        console.error("Errore navigazione SPA:", error);
        window.location.href = target.toString();
    } finally {
        spaNavigationInProgress = false;
        document.body.classList.remove("spa-loading");
        document.querySelector("main")?.removeAttribute("aria-busy");
    }
}

function computeBasePathForUrl(url) {
    const target = new URL(url, window.location.href);
    const parts = target.pathname.split("/").filter(Boolean);
    const file = parts[parts.length - 1] || "";
    if (!file || file === "index.html") return "";
    const pageIndex = parts.lastIndexOf("pages");
    if (pageIndex === -1) return "";
    const depthBelowPages = Math.max(0, parts.length - pageIndex - 2);
    return "../".repeat(depthBelowPages + 1);
}

function syncBodyState(nextDocument) {
    const nextClassName = nextDocument.body?.className || "";
    document.body.className = nextClassName;
    document.body.classList.toggle("is-embed", isEmbeddedRuntime);
    document.body.classList.add("page-ready");
    document.body.style.cssText = nextDocument.body?.style?.cssText || "";
}

function markInitialInlineHeadStyles() {
    document.head.querySelectorAll("style").forEach((style) => {
        initialInlineHeadStyles.add(style);
    });
}

function syncSpaHead(nextDocument, targetUrl) {
    document.head.querySelectorAll("[data-spa-head]").forEach((node) => node.remove());
    removeInitialPageStyles();

    nextDocument.head.querySelectorAll("style").forEach((style) => {
        const clone = document.importNode(style, true);
        clone.dataset.spaHead = "true";
        document.head.appendChild(clone);
    });

    nextDocument.head.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => {
        const href = link.getAttribute("href") || "";
        if (!href) return;

        const absoluteHref = new URL(href, targetUrl || window.location.href).toString();
        const alreadyLoaded = Array.from(document.head.querySelectorAll('link[rel~="stylesheet"]'))
            .some((currentLink) => currentLink.href === absoluteHref);
        if (alreadyLoaded) return;

        const clone = document.importNode(link, true);
        clone.href = absoluteHref;
        clone.dataset.spaHead = "true";
        document.head.appendChild(clone);
    });
}

function removeInitialPageStyles() {
    document.head.querySelectorAll("style").forEach((style) => {
        if (initialInlineHeadStyles.has(style)) {
            style.remove();
        }
    });
}

function removeSpaExtras() {
    document.querySelectorAll("[data-spa-extra]").forEach((node) => node.remove());
}

function appendSpaExtras(nextDocument) {
    const bodyChildren = Array.from(nextDocument.body?.children || []);
    const firstScript = Array.from(document.body.children).find((node) => node.tagName === "SCRIPT") || null;

    bodyChildren.forEach((child) => {
        if (child.matches?.("main, script, #sidebar-container")) return;
        const clone = document.importNode(child, true);
        clone.dataset.spaExtra = "true";
        document.body.insertBefore(clone, firstScript);
    });
}

function getSpaScriptSources(nextDocument, targetUrl) {
    return Array.from(nextDocument.querySelectorAll("script[src]"))
        .map((script) => script.getAttribute("src") || "")
        .filter((src) => src && src.includes("assets/js/") && !src.includes("assets/js/layout.js"))
        .map((src) => new URL(src, targetUrl).toString());
}

function markInitialSpaScripts() {
    document.querySelectorAll("script[src]").forEach((script) => {
        const src = script.getAttribute("src") || "";
        if (src.includes("assets/js/") && !src.includes("assets/js/layout.js")) {
            loadedSpaScripts.add(normalizeScriptUrl(script.src));
        }
    });
}

async function loadSpaScripts(scriptUrls) {
    for (const scriptUrl of scriptUrls) {
        await loadSpaScript(scriptUrl);
    }
}

function loadSpaScript(scriptUrl) {
    const normalizedUrl = normalizeScriptUrl(scriptUrl);
    if (loadedSpaScripts.has(normalizedUrl)) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = scriptUrl;
        script.async = false;
        script.dataset.spaScript = "true";
        script.addEventListener("load", () => {
            loadedSpaScripts.add(normalizedUrl);
            resolve();
        }, { once: true });
        script.addEventListener("error", () => reject(new Error(`Impossibile caricare ${scriptUrl}`)), { once: true });
        document.body.appendChild(script);
    });
}

function normalizeScriptUrl(scriptUrl) {
    const url = new URL(scriptUrl, window.location.href);
    url.hash = "";
    url.search = "";
    return url.toString();
}

function scrollToCurrentHash() {
    const id = decodeURIComponent(window.location.hash || "").replace(/^#/, "");
    if (!id) return;
    const target = document.getElementById(id);
    if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function createPageScope(pageId) {
    const id = String(pageId || getCurrentPageId());
    pageScopes.get(id)?.abort();

    const controller = new AbortController();
    pageScopes.set(id, controller);

    return {
        signal: controller.signal,
        listen(target, type, handler, options = {}) {
            if (!target || typeof target.addEventListener !== "function") return;
            target.addEventListener(type, handler, {
                ...options,
                signal: controller.signal
            });
        }
    };
}

function disposePageScopes() {
    pageScopes.forEach((controller) => controller.abort());
    pageScopes.clear();
}

function getPageSignal(pageId) {
    return createPageScope(pageId).signal;
}

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
    initPageAccessControls(basePath);
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
    if (!container) return;

    const links = container.querySelectorAll("a");
    links.forEach(link => {
        const href = link.dataset.originalHref || link.getAttribute("href") || "";
        if (!href) return;
        link.dataset.originalHref = href;
        if (isUnresolvedRelativePath(href)) {
            link.setAttribute("href", new URL(`${basePath || ""}${href}`, window.location.href).toString());
        }
    });

    const images = container.querySelectorAll("img");
    images.forEach(img => {
        const src = img.dataset.originalSrc || img.getAttribute("src") || "";
        if (!src) return;
        img.dataset.originalSrc = src;
        if (isUnresolvedRelativePath(src)) {
            img.setAttribute("src", new URL(`${basePath || ""}${src}`, window.location.href).toString());
        }
    });
}

function isUnresolvedRelativePath(value) {
    return Boolean(value)
        && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
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
    if (isEmbeddedRuntime) return;
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

function warmEmbedSectionScripts(basePath) {
    if (!isEmbeddedRuntime) return;

    const run = () => {
        EMBED_SCRIPT_WARMUP_PATHS.forEach((path, index) => {
            window.setTimeout(() => warmEmbedScript(basePath, path), 250 + index * 350);
        });
    };

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 1500 });
    } else {
        window.setTimeout(run, 750);
    }
}

function warmEmbedScript(basePath, path) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller
        ? window.setTimeout(() => controller.abort(), 8000)
        : null;

    fetch(new URL(path, new URL(basePath || "./", window.location.href)).toString(), {
        cache: "force-cache",
        ...(controller ? { signal: controller.signal } : {})
    })
        .catch(() => {})
        .finally(() => {
            if (timeout) window.clearTimeout(timeout);
        });
}

function initDiscordAuth(scope) {
    const status = scope.querySelector("#auth-status");
    const loginBtn = scope.querySelector("#discord-login");
    const deviceLoginBtn = scope.querySelector("#device-login");
    const logoutBtn = scope.querySelector("#discord-logout");
    if (!status || !loginBtn || !logoutBtn) return;

    const didConsumeToken = consumeTokenFromHash();
    if (didConsumeToken) {
        window.location.replace(window.location.pathname + window.location.search);
        return;
    }

    loginBtn.addEventListener("click", () => {
        redirectToDiscordLogin();
    });

    deviceLoginBtn?.addEventListener("click", () => {
        promptDeviceLogin();
    });

    logoutBtn.addEventListener("click", () => {
        logoutDiscord();
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
    const deviceLoginBtn = scope.querySelector("#device-login");
    const logoutBtn = scope.querySelector("#discord-logout");
    if (!status || !loginBtn || !logoutBtn) return;

    const token = readStoredToken();
    if (!token) {
        setLoggedOutState(status, loginBtn, logoutBtn);
        setDmOnlyVisibility(false);
        return;
    }

    status.textContent = "Verifica login...";
    loginBtn.hidden = true;
    if (deviceLoginBtn) deviceLoginBtn.hidden = true;
    logoutBtn.hidden = false;

    try {
        const authState = await verifyDiscordAuth();
        if (!authState?.user) {
            setLoggedOutState(status, loginBtn, logoutBtn);
            setDmOnlyVisibility(false);
            return;
        }
        const username = authState.user.global_name || authState.user.username || "utente Discord";
        status.textContent = `Loggato come ${username}`;
        loginBtn.hidden = true;
        if (deviceLoginBtn) deviceLoginBtn.hidden = true;
        logoutBtn.hidden = false;
        await updateDmOnlyVisibility(window.CriptaBasePath || "");
    } catch (_) {
        status.textContent = "Errore verifica login";
        loginBtn.hidden = true;
        if (deviceLoginBtn) deviceLoginBtn.hidden = true;
        logoutBtn.hidden = false;
        setDmOnlyVisibility(false);
    }
}

function setLoggedOutState(status, loginBtn, logoutBtn) {
    status.textContent = "Non loggato";
    loginBtn.hidden = false;
    const deviceLoginBtn = loginBtn.parentElement?.querySelector("#device-login");
    if (deviceLoginBtn) deviceLoginBtn.hidden = false;
    logoutBtn.hidden = true;
}

function readStoredToken() {
    if (embeddedDiscordToken) return embeddedDiscordToken;
    try {
        return window.localStorage.getItem(DISCORD_TOKEN_KEY) || "";
    } catch (_) {
        return "";
    }
}

function storeToken(token) {
    embeddedDiscordToken = String(token || "");
    try {
        window.localStorage.setItem(DISCORD_TOKEN_KEY, token);
        discordAuthCache = null;
        discordAuthPromise = null;
    } catch (_) {
        // Ignore storage restrictions
    }
}

function clearStoredToken() {
    embeddedDiscordToken = "";
    try {
        window.localStorage.removeItem(DISCORD_TOKEN_KEY);
        discordAuthCache = null;
        discordAuthPromise = null;
    } catch (_) {
        // Ignore storage restrictions
    }
}

function getBasePath() {
    return typeof window.CriptaBasePath === "string" ? window.CriptaBasePath : "";
}

function resolveSiteUrl(relativePath) {
    const cleanPath = String(relativePath || "").replace(/^\/+/, "");
    return new URL(`${getBasePath()}${cleanPath}`, window.location.href).toString();
}

function buildWorkerUrl(pathname) {
    const cleanPath = String(pathname || "").replace(/^\/+/, "");
    return `${DISCORD_WORKER_URL}/${cleanPath}`;
}

function getSitePollUrl() {
    return resolveSiteUrl("pages/sondaggio.html");
}

function redirectToDiscordLogin() {
    const loginUrl = buildWorkerUrl("auth/discord/login");
    if (isEmbeddedRuntime) {
        embeddedDiscordPopup = window.open(
            "about:blank",
            "cripta-discord-auth",
            "popup=yes,width=640,height=900,resizable=yes,scrollbars=yes"
        );
        window.parent?.postMessage({
            type: "cripta-discord-login",
            url: loginUrl,
            popupOpened: Boolean(embeddedDiscordPopup)
        }, "*");
        return;
    }
    window.location.href = loginUrl;
}

async function loginWithDeviceCode(code) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
        throw new Error("Inserisci un codice accesso.");
    }

    const response = await requestApi("auth/device/login", {
        method: "POST",
        body: { code: cleanCode }
    });

    if (!response?.token) {
        throw new Error("Risposta login non valida.");
    }

    storeToken(String(response.token));
    discordAuthCache = response.user ? { ok: true, user: response.user } : null;

    if (isEmbeddedRuntime) {
        window.parent?.postMessage({
            type: "cripta-auth-token",
            token: response.token,
            user: response.user || null
        }, "*");
    }

    return response;
}

function promptDeviceLogin() {
    const code = window.prompt("Codice accesso personale");
    if (code === null) return;

    loginWithDeviceCode(code)
        .then(() => {
            window.location.reload();
        })
        .catch((error) => {
            window.alert(error?.message || String(error || "Login non riuscito."));
        });
}

function handleEmbeddedAuthMessage(event) {
    const data = event?.data;
    if (data?.type === "cripta-discord-auth-start" && data?.authUrl) {
        if (embeddedDiscordPopup && !embeddedDiscordPopup.closed) {
            embeddedDiscordPopup.location.href = String(data.authUrl);
            try {
                embeddedDiscordPopup.focus();
            } catch (_) {
                // Ignore focus errors.
            }
        }
        return;
    }

    if (data?.type !== "cripta-auth-token" || !data?.token) return;

    storeToken(String(data.token));
    try {
        embeddedDiscordPopup?.close();
    } catch (_) {
        // Ignore close errors.
    }
    embeddedDiscordPopup = null;
    window.location.reload();
}

function consumeEmbeddedTokenFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("foundryJwt") || "";
    if (!token) return;

    storeToken(token);
    params.delete("foundryJwt");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`;
    history.replaceState(null, "", nextUrl);
}

function logoutDiscord() {
    clearStoredToken();
    window.location.replace(window.location.pathname + window.location.search);
}

async function fetchJsonWithCache(url, options = {}) {
    const key = String(url || "");
    const useCache = options.cache !== false;

    if (useCache && jsonCache.has(key)) {
        return jsonCache.get(key);
    }

    const requestPromise = fetch(key, options.fetchOptions)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .catch((error) => {
            if (useCache) {
                jsonCache.delete(key);
            }
            throw error;
        });

    if (useCache) {
        jsonCache.set(key, requestPromise);
    }

    return requestPromise;
}

async function requestApi(pathname, options = {}) {
    const {
        method = "GET",
        headers = {},
        body,
        token,
        expectJson = true,
        query
    } = options;

    const url = new URL(buildWorkerUrl(pathname));
    if (query && typeof query === "object") {
        Object.entries(query).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            url.searchParams.set(key, String(value));
        });
    }

    const requestHeaders = {
        Accept: "application/json",
        ...headers
    };

    if (token) {
        requestHeaders.Authorization = `Bearer ${token}`;
    }

    let requestBody = body;
    if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof FormData)) {
        requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/json";
        requestBody = requestHeaders["Content-Type"].includes("application/json")
            ? JSON.stringify(body)
            : body;
    }

    const response = await fetch(url.toString(), {
        method,
        headers: requestHeaders,
        ...(requestBody !== undefined ? { body: requestBody } : {})
    });

    if (!expectJson) {
        return response;
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        const apiMessage = payload?.error || payload?.message || payload?.details || "";
        throw new Error(apiMessage ? `HTTP ${response.status}: ${apiMessage}` : `HTTP ${response.status}`);
    }

    return payload;
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

function initPageAccessControls(basePath) {
    const dmOnlyNodes = document.querySelectorAll("[data-requires-dm]");
    if (!dmOnlyNodes.length) return;
    setDmOnlyVisibility(false);
    updateDmOnlyVisibility(basePath).catch(() => {
        setDmOnlyVisibility(false);
    });
}

function setDmOnlyVisibility(isVisible) {
    document.querySelectorAll("[data-requires-dm]").forEach((node) => {
        node.hidden = !isVisible;
    });
}

async function updateDmOnlyVisibility(basePath) {
    const authState = await verifyDiscordAuth().catch(() => null);
    const currentDiscordId = String(authState?.user?.id || authState?.user?.sub || "").trim();
    if (!currentDiscordId) {
        setDmOnlyVisibility(false);
        return false;
    }

    const dmDiscordId = await getDmDiscordId(basePath);
    const isDm = Boolean(dmDiscordId) && currentDiscordId === dmDiscordId;
    setDmOnlyVisibility(isDm);
    return isDm;
}

async function getDmDiscordId(basePath) {
    if (typeof dmDiscordIdCache === "string") return dmDiscordIdCache;
    if (dmDiscordIdPromise) return dmDiscordIdPromise;

    dmDiscordIdPromise = (async () => {
        try {
            const data = await fetchJsonWithCache(`${basePath}assets/data/next-session.json`);
            dmDiscordIdCache = String(data?.dmDiscordId || "").trim();
            return dmDiscordIdCache;
        } catch (_) {
            dmDiscordIdCache = "";
            return "";
        } finally {
            dmDiscordIdPromise = null;
        }
    })();

    return dmDiscordIdPromise;
}

window.CriptaDiscordAuth = {
    getToken: readStoredToken,
    verify: verifyDiscordAuth,
    consumeTokenFromHash,
    clearToken: clearStoredToken,
    login: redirectToDiscordLogin,
    loginWithDeviceCode,
    promptDeviceLogin,
    logout: logoutDiscord
};

window.CriptaApp = {
    auth: window.CriptaDiscordAuth,
    api: {
        request: requestApi,
        get(pathname, options = {}) {
            return requestApi(pathname, { ...options, method: "GET" });
        },
        post(pathname, body, options = {}) {
            return requestApi(pathname, { ...options, method: "POST", body });
        }
    },
    config: {
        workerOrigin: DISCORD_WORKER_URL,
        tokenStorageKey: DISCORD_TOKEN_KEY
    },
    urls: {
        api(pathname) {
            return buildWorkerUrl(pathname);
        },
        site(pathname) {
            return resolveSiteUrl(pathname);
        },
        pollPage() {
            return getSitePollUrl();
        }
    },
    fetchJson: fetchJsonWithCache,
    getBasePath,
    onPageReady,
    createPageScope,
    getPageSignal
};
