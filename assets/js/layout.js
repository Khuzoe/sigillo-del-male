const SIDEBAR_CACHE_KEY = "wiki_sidebar_html_v2";
const DISCORD_WORKER_URL = "https://sigillo-api.khuzoe.workers.dev";
const DISCORD_TOKEN_KEY = "discord_jwt";
const DEFAULT_CAMPAIGN_ID = "cripta-di-sangue";
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
const dmIdentityCache = new Map();
let dmIdentityPromise = null;
const jsonCache = new Map();
const isEmbedMode = new URLSearchParams(window.location.search).get("embed") === "1";
const isEmbeddedRuntime = isEmbedMode || window.self !== window.top;
let embeddedDiscordToken = "";
let embeddedDiscordPopup = null;
let spaNavigationInProgress = false;
let currentCampaignId = DEFAULT_CAMPAIGN_ID;
let currentCampaignConfig = null;
let campaignConfigPromise = null;

document.addEventListener("DOMContentLoaded", async function () {
    const scriptTag = document.querySelector('script[src*="layout.js"]');
    let basePath = "";

    if (scriptTag) {
        const src = scriptTag.getAttribute("src") || "";
        basePath = src.replace("assets/js/layout.js", "");
    }

    window.CriptaBasePath = basePath;
    currentCampaignId = resolveCurrentCampaignId();
    document.documentElement.dataset.campaign = currentCampaignId;
    document.body.classList.toggle("is-embed", isEmbeddedRuntime);
    consumeEmbeddedTokenFromQuery();
    await consumeDeviceCodeFromQuery();
    await applyCurrentCampaignConfig(basePath);

    markInitialInlineHeadStyles();
    ensureFavicon(basePath);
    if (!isEmbeddedRuntime) {
        ensureTopAuthBar();
    }
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
        notifyEmbeddedLocation();
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
        applyCampaignToUrl(target);
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

        await runSpaExitTransition(currentMain);

        if (push) {
            history.pushState({}, "", target.toString());
        }

        currentCampaignId = resolveCurrentCampaignId(target);
        document.documentElement.dataset.campaign = currentCampaignId;
        document.title = nextDocument.title || document.title;
        await applyCurrentCampaignConfig(computeBasePathForUrl(target));
        syncSpaHead(nextDocument, target);
        syncBodyState(nextDocument);
        disposePageScopes();
        removeSpaExtras();
        currentMain.replaceWith(importedMain);

        window.CriptaBasePath = computeBasePathForUrl(target);
        syncSidebarContainer(nextDocument, importedMain, window.CriptaBasePath);
        applyCampaignSidebarConfig(document.getElementById("sidebar-container"), window.CriptaBasePath);
        initCampaignSwitcher(document.getElementById("sidebar-container"));
        appendSpaExtras(nextDocument);
        ensureFavicon(window.CriptaBasePath);
        fixPaths(document.getElementById("sidebar-container"), window.CriptaBasePath);
        bindPrefetchForLinks(document.querySelector("main"));
        setActiveLink();
        setDmOnlyVisibility(false);
        initPageAccessControls(window.CriptaBasePath);
        runSpaEnterTransition();

        await loadSpaScripts(nextScripts);
        document.dispatchEvent(new CustomEvent("cripta:spa-ready", {
            detail: {
                pageId: getCurrentPageId(target.toString()),
                url: target.toString()
            }
        }));
        notifyEmbeddedLocation();

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
    const toolsIndex = parts.lastIndexOf("tools");
    if (toolsIndex !== -1) {
        const depthBelowTools = Math.max(0, parts.length - toolsIndex - 2);
        return "../".repeat(depthBelowTools + 1);
    }
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

async function applyCurrentCampaignConfig(basePath = getBasePath()) {
    currentCampaignConfig = await loadCampaignConfig(getCampaignId());
    document.documentElement.dataset.campaign = currentCampaignConfig.id || getCampaignId();
    loadCampaignTheme(currentCampaignConfig, basePath);
}

async function loadCampaignConfig(campaignId = getCampaignId()) {
    const campaigns = await loadEnabledCampaigns();
    const id = sanitizeCampaignId(campaignId);
    return campaigns.find((campaign) => campaign.id === id)
        || campaigns.find((campaign) => campaign.id === DEFAULT_CAMPAIGN_ID)
        || { id, name: id, theme: id, hiddenPages: [] };
}

function loadCampaignTheme(campaign, basePath = getBasePath()) {
    const theme = sanitizeCampaignId(campaign?.theme || campaign?.id || "");
    document.querySelectorAll("link[data-campaign-theme]").forEach((node) => node.remove());
    if (!theme || theme === DEFAULT_CAMPAIGN_ID) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(`${basePath || ""}assets/css/themes/${theme}.css`, window.location.href).toString();
    link.dataset.campaignTheme = theme;
    document.head.appendChild(link);
}

function syncSpaHead(nextDocument, targetUrl) {
    document.head.querySelectorAll("[data-spa-head], link[data-page-style]").forEach((node) => {
        if (node.dataset.campaignTheme) return;
        node.remove();
    });
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

function syncSidebarContainer(nextDocument, mainNode, basePath) {
    const nextHasSidebar = Boolean(nextDocument.querySelector("#sidebar-container"));
    const currentSidebar = document.getElementById("sidebar-container");

    if (!nextHasSidebar) {
        currentSidebar?.remove();
        return;
    }

    if (!currentSidebar) {
        const sidebar = document.createElement("nav");
        sidebar.className = "sidebar";
        sidebar.id = "sidebar-container";
        mainNode?.parentNode?.insertBefore(sidebar, mainNode);
        loadSidebar(basePath);
        return;
    }

    if (!currentSidebar.children.length) {
        loadSidebar(basePath);
    }
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

function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function runSpaExitTransition(main) {
    if (prefersReducedMotion()) return;
    main.classList.add("spa-page-exit");
    await wait(110);
}

function runSpaEnterTransition() {
    if (prefersReducedMotion()) return;
    const main = document.querySelector("main");
    if (!main) return;
    main.classList.add("spa-page-enter");
    window.requestAnimationFrame(() => {
        main.classList.add("spa-page-enter-active");
        window.setTimeout(() => {
            main.classList.remove("spa-page-enter", "spa-page-enter-active");
        }, 260);
    });
}

function notifyEmbeddedLocation() {
    if (!isEmbeddedRuntime) return;
    window.parent?.postMessage({
        type: "cripta-spa-navigate",
        url: window.location.href,
        pageId: getCurrentPageId()
    }, "*");
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
    applyCampaignSidebarConfig(container, basePath);
    initCampaignSwitcher(container);
    setActiveLink();
    bindPrefetchForLinks(container);
    initPageAccessControls(basePath);
}

function applyCampaignSidebarConfig(container, basePath) {
    if (!container) return;
    const campaign = currentCampaignConfig || {};
    const hiddenPages = new Set(Array.isArray(campaign.hiddenPages) ? campaign.hiddenPages.map((page) => String(page || "").trim()) : []);

    container.querySelectorAll("[data-page]").forEach((node) => {
        const page = String(node.getAttribute("data-page") || "").trim();
        const item = node.closest("li") || node;
        item.hidden = hiddenPages.has(page);
    });

    const logoPath = String(campaign.logo || "").trim();
    const logoImg = container.querySelector(".logo-img");
    if (logoImg && logoPath) {
        logoImg.dataset.originalSrc = logoPath;
        logoImg.setAttribute("src", new URL(`${basePath || ""}${logoPath}`, window.location.href).toString());
    }
}

async function initCampaignSwitcher(container) {
    const campaigns = await loadEnabledCampaigns();
    if (!container || campaigns.length <= 1) {
        container?.querySelector?.(".campaign-switcher")?.remove();
        return;
    }

    const currentId = getCampaignId();
    const currentCampaign = campaigns.find((campaign) => campaign.id === currentId) || campaigns[0];
    const switcher = document.createElement("div");
    switcher.className = "campaign-switcher";
    switcher.innerHTML = `
        <label class="campaign-switcher__label" for="campaign-switcher-select">
            <i class="fas fa-layer-group" aria-hidden="true"></i>
            Campagna
        </label>
        <div class="campaign-switcher__control">
            <select id="campaign-switcher-select" class="campaign-switcher__select" aria-label="Cambia campagna">
                ${campaigns.map((campaign) => `
                    <option value="${escapeHtml(campaign.id)}"${campaign.id === currentCampaign.id ? " selected" : ""}>
                        ${escapeHtml(campaign.name)}
                    </option>
                `).join("")}
            </select>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
        </div>
    `;

    container.querySelector(".campaign-switcher")?.remove();
    container.appendChild(switcher);

    const select = switcher.querySelector("select");
    select?.addEventListener("change", () => {
        const campaignId = sanitizeCampaignId(select.value);
        if (!campaignId || campaignId === getCampaignId()) return;
        navigateToCampaign(campaignId);
    });
}

async function loadEnabledCampaigns() {
    if (campaignConfigPromise) return campaignConfigPromise;

    campaignConfigPromise = (async () => {
    try {
        const data = await fetchJsonWithCache(resolveGlobalDataUrl("campaigns.json"));
        const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
        return campaigns
            .filter((campaign) => campaign?.enabled !== false && campaign?.id)
            .map((campaign) => ({
                id: sanitizeCampaignId(campaign.id),
                name: String(campaign.name || campaign.id).trim(),
                siteTitle: String(campaign.siteTitle || campaign.name || "").trim(),
                dataPath: String(campaign.dataPath || "").trim(),
                theme: String(campaign.theme || campaign.id || "").trim(),
                logo: String(campaign.logo || "").trim(),
                hiddenPages: Array.isArray(campaign.hiddenPages) ? campaign.hiddenPages : []
            }))
            .filter((campaign) => campaign.id && campaign.name);
    } catch (error) {
        console.warn("Impossibile caricare elenco campagne:", error);
        return [];
    }
    })();

    return campaignConfigPromise;
}

function navigateToCampaign(campaignId) {
    const target = buildCampaignNavigationTarget(campaignId);
    if (sanitizeCampaignId(campaignId) === DEFAULT_CAMPAIGN_ID) {
        target.searchParams.delete("campaign");
        target.searchParams.delete("campaignId");
    } else {
        target.searchParams.set("campaign", sanitizeCampaignId(campaignId));
        target.searchParams.delete("campaignId");
    }

    if (isEmbedMode && !target.searchParams.has("embed")) {
        target.searchParams.set("embed", "1");
    }

    if (typeof navigateSpa === "function" && !isEmbeddedRuntime) {
        navigateSpa(target.toString(), { push: true });
        return;
    }

    window.location.href = target.toString();
}

function buildCampaignNavigationTarget(campaignId) {
    if (getCurrentPageId() === "creature") {
        return new URL(`${getBasePath()}pages/bestiario.html`, window.location.href);
    }

    if (getCurrentPageId() !== "character") {
        return new URL(window.location.href);
    }

    const params = new URLSearchParams(window.location.search);
    const type = String(params.get("type") || "").toLowerCase();
    const listPage = type === "player" ? "giocatori.html" : "npcs.html";
    return new URL(`${getBasePath()}pages/${listPage}`, window.location.href);
}

function ensureTopAuthBar() {
    let authBar = document.getElementById("top-auth-bar");
    if (!authBar) {
        authBar = document.createElement("div");
        authBar.id = "top-auth-bar";
        authBar.className = "top-auth-bar discord-auth";
        authBar.setAttribute("aria-label", "Accesso wiki");
        authBar.innerHTML = `
            <p class="discord-auth-status" data-auth-status>Non loggato</p>
            <div class="discord-auth-actions">
                <button type="button" class="discord-auth-btn discord-auth-btn--login" data-discord-login aria-label="Login con Discord" title="Login con Discord">
                    <i class="fab fa-discord" aria-hidden="true"></i>
                </button>
                <button type="button" class="discord-auth-btn discord-auth-btn--login" data-device-login aria-label="Login con codice" title="Login con codice">
                    <i class="fas fa-user" aria-hidden="true"></i>
                </button>
            </div>
            <button type="button" class="discord-auth-account-btn" data-auth-menu-toggle aria-label="Menu account" title="Menu account" hidden>
                <i class="fas fa-user" aria-hidden="true"></i>
            </button>
            <div class="discord-auth-menu" data-auth-menu hidden>
                <div class="discord-auth-menu__user" data-auth-menu-user>Account wiki</div>
                <button type="button" class="discord-auth-menu__logout" data-discord-logout>
                    <i class="fas fa-right-from-bracket" aria-hidden="true"></i>
                    Logout
                </button>
            </div>
        `;
        document.body.appendChild(authBar);
    }

    initDiscordAuth(authBar);
    return authBar;
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
            const target = new URL(`${basePath || ""}${href}`, window.location.href);
            if (target.origin === window.location.origin && (/\.html$/i.test(target.pathname) || target.pathname.endsWith("/"))) {
                applyCampaignToUrl(target);
            }
            link.setAttribute("href", target.toString());
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

function initCommandPalette() {
    ensureCommandPalette();

    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            openCommandPalette();
        }
        if (event.key === "Escape") {
            closeCommandPalette();
        }
    });

    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-command-palette-open]")) {
            event.preventDefault();
            openCommandPalette();
            return;
        }

        if (event.target.closest("[data-command-result]")) {
            closeCommandPalette();
            return;
        }

        const overlay = document.getElementById("command-palette");
        if (overlay && event.target === overlay) {
            closeCommandPalette();
        }
    });
}

function ensureCommandPalette() {
    if (document.getElementById("command-palette")) return;

    const overlay = document.createElement("div");
    overlay.id = "command-palette";
    overlay.className = "command-palette";
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="command-palette__panel" role="dialog" aria-modal="true" aria-label="Cerca nella wiki">
            <div class="command-palette__search">
                <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" data-command-input placeholder="Cerca NPC, missioni, oggetti, sessioni..." autocomplete="off">
                <kbd>Esc</kbd>
            </div>
            <div class="command-palette__meta" data-command-meta>Scrivi almeno due lettere.</div>
            <div class="command-palette__results" data-command-results></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("[data-command-input]");
    input.addEventListener("input", () => {
        renderCommandResults(input.value);
    });
}

async function openCommandPalette() {
    const overlay = ensureCommandPalette() || document.getElementById("command-palette");
    const palette = document.getElementById("command-palette");
    if (!palette) return;

    palette.hidden = false;
    document.body.classList.add("command-palette-open");
    const input = palette.querySelector("[data-command-input]");
    input.value = "";
    renderCommandResults("");
    window.setTimeout(() => input.focus(), 0);
    loadSearchIndex().then(() => renderCommandResults(input.value)).catch(() => {
        const meta = palette.querySelector("[data-command-meta]");
        if (meta) meta.textContent = "Indice ricerca non disponibile.";
    });
}

function closeCommandPalette() {
    const palette = document.getElementById("command-palette");
    if (!palette || palette.hidden) return;
    palette.hidden = true;
    document.body.classList.remove("command-palette-open");
}

async function renderCommandResults(query) {
    const palette = document.getElementById("command-palette");
    if (!palette || palette.hidden) return;

    const resultsEl = palette.querySelector("[data-command-results]");
    const metaEl = palette.querySelector("[data-command-meta]");
    const raw = String(query || "").trim();
    if (!raw || raw.length < 2) {
        metaEl.textContent = "Scrivi almeno due lettere.";
        resultsEl.innerHTML = renderCommandQuickLinks();
        return;
    }

    metaEl.textContent = "Ricerca...";
    const { items, fuse } = await loadSearchIndex();
    const results = fuse
        ? fuse.search(raw).slice(0, 10).map(result => result.item)
        : fallbackSearch(items, raw).slice(0, 10);

    metaEl.textContent = results.length ? `${results.length} risultati` : "Nessun risultato.";
    resultsEl.innerHTML = results.map(renderCommandItem).join("");
}

function renderCommandQuickLinks() {
    const links = [
        { title: "Home", subtitle: "Dashboard campagna", type: "Pagina", url: "index.html", icon: "fa-house" },
        { title: "Sessioni", subtitle: "Diario delle sessioni", type: "Pagina", url: "pages/sessioni.html", icon: "fa-scroll" },
        { title: "Missioni", subtitle: "Registro delle imprese", type: "Pagina", url: "pages/missioni.html", icon: "fa-flag" },
        { title: "Appunti", subtitle: "Note personali e condivise", type: "Pagina", url: "pages/appunti.html", icon: "fa-note-sticky" }
    ];
    return links.map(renderCommandItem).join("");
}

function renderCommandItem(item) {
    const type = item.type || "Voce";
    const icon = item.icon || getCommandIcon(type);
    return `
        <a class="command-palette__item" href="${resolveSiteUrl(item.url || "index.html")}" data-command-result>
            <i class="fas ${escapeHtml(icon)}" aria-hidden="true"></i>
            <span>
                <strong>${escapeHtml(item.title || "Senza titolo")}</strong>
                <small>${escapeHtml(item.subtitle || type)}${item.content ? ` · ${escapeHtml(trimPreviewText(item.content, 96))}` : ""}</small>
            </span>
            <em>${escapeHtml(type)}</em>
        </a>
    `;
}

function getCommandIcon(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized.includes("npc")) return "fa-skull";
    if (normalized.includes("gioc")) return "fa-dice-d20";
    if (normalized.includes("mission") || normalized.includes("quest")) return "fa-flag";
    if (normalized.includes("session")) return "fa-scroll";
    if (normalized.includes("oggetto") || normalized.includes("item")) return "fa-wand-sparkles";
    if (normalized.includes("creature")) return "fa-book-dead";
    return "fa-circle-dot";
}

async function loadSearchIndex() {
    if (searchIndexPromise) return searchIndexPromise;

    searchIndexPromise = (async () => {
        const data = await fetchJsonWithCache(resolveDataUrl("search-index.json"));
        const items = Array.isArray(data?.items)
            ? data.items.filter(item => !window.WikiSpoiler || window.WikiSpoiler.isVisible(item))
            : [];
        const FuseCtor = await loadFuse().catch(() => null);
        const fuse = FuseCtor
            ? new FuseCtor(items, {
                keys: [
                    { name: "title", weight: 0.55 },
                    { name: "subtitle", weight: 0.25 },
                    { name: "tags", weight: 0.15 },
                    { name: "content", weight: 0.05 }
                ],
                threshold: 0.36,
                ignoreLocation: true,
                minMatchCharLength: 2
            })
            : null;
        return { items, fuse };
    })();

    return searchIndexPromise;
}

function loadFuse() {
    if (window.Fuse) return Promise.resolve(window.Fuse);
    if (fuseLoadPromise) return fuseLoadPromise;

    fuseLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = FUSE_CDN_URL;
        script.async = true;
        script.addEventListener("load", () => resolve(window.Fuse || null), { once: true });
        script.addEventListener("error", () => reject(new Error("Fuse.js non disponibile")), { once: true });
        document.head.appendChild(script);
    });
    return fuseLoadPromise;
}

function fallbackSearch(items, query) {
    const term = normalizeText(query);
    if (!term) return [];
    return items
        .map(item => {
            const haystack = normalizeText(`${item.title || ""} ${item.subtitle || ""} ${(item.tags || []).join(" ")} ${item.content || ""}`);
            const title = normalizeText(item.title || "");
            let score = 0;
            if (title.startsWith(term)) score += 80;
            if (title.includes(term)) score += 40;
            if (haystack.includes(term)) score += 15;
            return { item, score };
        })
        .filter(result => result.score > 0)
        .sort((left, right) => right.score - left.score)
        .map(result => result.item);
}

function initLinkPreviews() {
    const preview = document.createElement("div");
    preview.id = "link-preview";
    preview.className = "link-preview";
    preview.hidden = true;
    document.body.appendChild(preview);

    let hoverTimer = null;
    let activeLink = null;

    document.addEventListener("mouseover", (event) => {
        const link = event.target.closest("a[href]");
        if (!link || !isPreviewableLink(link)) return;
        activeLink = link;
        window.clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => showLinkPreview(link, preview), 260);
    });

    document.addEventListener("mouseout", (event) => {
        if (!activeLink || !event.target.closest?.("a[href]")) return;
        if (activeLink.contains(event.relatedTarget)) return;
        activeLink = null;
        window.clearTimeout(hoverTimer);
        hideLinkPreview(preview);
    });

    document.addEventListener("scroll", () => hideLinkPreview(preview), { passive: true });
}

function isPreviewableLink(link) {
    if (link.closest(".sidebar, .top-auth-bar, .command-palette")) return false;
    try {
        const target = new URL(link.href, window.location.href);
        return target.origin === window.location.origin && target.pathname.endsWith(".html");
    } catch (_) {
        return false;
    }
}

async function showLinkPreview(link, preview) {
    try {
        const match = await findPreviewItem(link.href);
        if (!match) return;

        preview.innerHTML = `
            <div class="link-preview__type">${escapeHtml(match.type || "Voce")}</div>
            <strong>${escapeHtml(match.title || "Senza titolo")}</strong>
            <p>${escapeHtml(trimPreviewText(match.content || match.subtitle || "", 180))}</p>
        `;
        const rect = link.getBoundingClientRect();
        const top = Math.min(window.innerHeight - 170, Math.max(16, rect.bottom + 10));
        const left = Math.min(window.innerWidth - 340, Math.max(16, rect.left));
        preview.style.top = `${top}px`;
        preview.style.left = `${left}px`;
        preview.hidden = false;
    } catch (_) {
        hideLinkPreview(preview);
    }
}

function hideLinkPreview(preview) {
    preview.hidden = true;
}

async function findPreviewItem(href) {
    const { items } = await loadSearchIndex();
    const target = new URL(href, window.location.href);
    const targetPath = normalizePreviewUrl(target);
    return items.find(item => normalizePreviewUrl(new URL(resolveSiteUrl(item.url || ""), window.location.href)) === targetPath)
        || items.find(item => targetPath.endsWith(normalizePreviewUrl(new URL(resolveSiteUrl(item.url || ""), window.location.href))));
}

function normalizePreviewUrl(url) {
    return `${url.pathname.replace(/\/index\.html$/i, "/")}${url.search || ""}${url.hash || ""}`.replace(/\/+/g, "/");
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function trimPreviewText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
    })[char]);
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
    const status = scope.querySelector("[data-auth-status], #auth-status");
    const loginBtn = scope.querySelector("[data-discord-login], #discord-login");
    const deviceLoginBtn = scope.querySelector("[data-device-login], #device-login");
    const logoutBtn = scope.querySelector("[data-discord-logout], #discord-logout");
    const menuToggle = scope.querySelector("[data-auth-menu-toggle]");
    const menu = scope.querySelector("[data-auth-menu]");
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

    menuToggle?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleAuthMenu(scope);
    });

    document.addEventListener("click", (event) => {
        if (!scope.contains(event.target)) closeAuthMenu(scope);
    });

    logoutBtn.addEventListener("click", () => {
        closeAuthMenu(scope);
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
    const status = scope.querySelector("[data-auth-status], #auth-status");
    const loginBtn = scope.querySelector("[data-discord-login], #discord-login");
    const deviceLoginBtn = scope.querySelector("[data-device-login], #device-login");
    const logoutBtn = scope.querySelector("[data-discord-logout], #discord-logout");
    const menuToggle = scope.querySelector("[data-auth-menu-toggle]");
    const menuUser = scope.querySelector("[data-auth-menu-user]");
    if (!status || !loginBtn || !logoutBtn) return;

    const token = readStoredToken();
    if (!token) {
        setLoggedOutState(status, loginBtn, logoutBtn);
        showPendingDeviceCodeLoginError(status);
        setDmOnlyVisibility(false);
        return;
    }

    setAuthState(status, "checking");
    status.textContent = "Verifica login...";
    loginBtn.hidden = true;
    if (deviceLoginBtn) deviceLoginBtn.hidden = true;
    if (menuToggle) menuToggle.hidden = false;

    try {
        const authState = await verifyDiscordAuth();
        if (!authState?.user) {
            setLoggedOutState(status, loginBtn, logoutBtn);
            showPendingDeviceCodeLoginError(status);
            setDmOnlyVisibility(false);
            return;
        }
        const username = authState.user.global_name || authState.user.username || authState.user.accountId || "utente";
        setAuthState(status, "logged-in");
        status.textContent = `Loggato come ${username}`;
        if (menuUser) menuUser.textContent = username;
        loginBtn.hidden = true;
        if (deviceLoginBtn) deviceLoginBtn.hidden = true;
        if (menuToggle) menuToggle.hidden = false;
        await updateDmOnlyVisibility(window.CriptaBasePath || "");
    } catch (_) {
        setAuthState(status, "error");
        status.textContent = "Errore verifica login";
        loginBtn.hidden = true;
        if (deviceLoginBtn) deviceLoginBtn.hidden = true;
        if (menuToggle) menuToggle.hidden = false;
        setDmOnlyVisibility(false);
    }
}

function showPendingDeviceCodeLoginError(status) {
    let message = "";
    try {
        message = window.sessionStorage.getItem("cripta-device-code-login-error") || "";
        window.sessionStorage.removeItem("cripta-device-code-login-error");
    } catch (_) {
        message = "";
    }

    if (!message || !status) return;
    setAuthState(status, "error");
    status.textContent = message;
}

function setLoggedOutState(status, loginBtn, logoutBtn) {
    setAuthState(status, "logged-out");
    const scope = status.closest(".discord-auth");
    const menuToggle = scope?.querySelector("[data-auth-menu-toggle]");
    status.textContent = "Non loggato";
    loginBtn.hidden = false;
    const deviceLoginBtn = loginBtn.parentElement?.querySelector("[data-device-login], #device-login");
    if (deviceLoginBtn) deviceLoginBtn.hidden = false;
    if (logoutBtn) logoutBtn.hidden = false;
    if (menuToggle) menuToggle.hidden = true;
    closeAuthMenu(scope);
}

function setAuthState(status, state) {
    status?.closest?.(".discord-auth")?.setAttribute("data-auth-state", state);
}

function toggleAuthMenu(scope) {
    const menu = scope?.querySelector("[data-auth-menu]");
    if (!menu) return;
    menu.hidden = !menu.hidden;
}

function closeAuthMenu(scope) {
    const menu = scope?.querySelector("[data-auth-menu]");
    if (menu) menu.hidden = true;
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

function sanitizeCampaignId(value) {
    const campaignId = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return campaignId || DEFAULT_CAMPAIGN_ID;
}

function resolveCurrentCampaignId(url = window.location.href) {
    try {
        const target = url instanceof URL ? url : new URL(url, window.location.href);
        return sanitizeCampaignId(target.searchParams.get("campaign") || target.searchParams.get("campaignId") || DEFAULT_CAMPAIGN_ID);
    } catch (_) {
        return DEFAULT_CAMPAIGN_ID;
    }
}

function getCampaignId() {
    return currentCampaignId || DEFAULT_CAMPAIGN_ID;
}

function isDefaultCampaign(campaignId = getCampaignId()) {
    return sanitizeCampaignId(campaignId) === DEFAULT_CAMPAIGN_ID;
}

function applyCampaignToUrl(url, options = {}) {
    const campaignId = sanitizeCampaignId(options.campaignId || getCampaignId());
    if (campaignId !== DEFAULT_CAMPAIGN_ID) {
        url.searchParams.set("campaign", campaignId);
    } else if (options.force === true) {
        url.searchParams.set("campaign", campaignId);
    }
    return url;
}

function resolveSiteUrl(relativePath) {
    const cleanPath = String(relativePath || "").replace(/^\/+/, "");
    const url = new URL(`${getBasePath()}${cleanPath}`, window.location.href);
    return applyCampaignToUrl(url).toString();
}

function resolveDataUrl(dataPath, options = {}) {
    const cleanPath = String(dataPath || "").replace(/^\/+/, "").replace(/^assets\/data\//, "");
    const campaignId = sanitizeCampaignId(options.campaignId || getCampaignId());
    const configuredPath = currentCampaignConfig && sanitizeCampaignId(currentCampaignConfig.id) === campaignId
        ? String(currentCampaignConfig.dataPath || "").replace(/^\/+|\/+$/g, "")
        : "";
    const basePath = configuredPath || (campaignId === DEFAULT_CAMPAIGN_ID ? "assets/data" : `campaigns/${campaignId}/data`);
    const baseDataPath = `${basePath}/${cleanPath}`;
    return resolveSiteUrl(baseDataPath);
}

function resolveGlobalDataUrl(dataPath) {
    const cleanPath = String(dataPath || "").replace(/^\/+/, "").replace(/^assets\/data\//, "");
    return resolveSiteUrl(`assets/data/${cleanPath}`);
}

function buildWorkerUrl(pathname) {
    const cleanPath = String(pathname || "").replace(/^\/+/, "");
    return `${DISCORD_WORKER_URL}/${cleanPath}`;
}

function getSitePollUrl() {
    return resolveSiteUrl("pages/sondaggio.html");
}

function redirectToDiscordLogin() {
    const loginUrl = new URL(buildWorkerUrl("auth/discord/login"));
    applyCampaignToUrl(loginUrl, { force: true });
    if (isEmbeddedRuntime) {
        embeddedDiscordPopup = window.open(
            "about:blank",
            "cripta-discord-auth",
            "popup=yes,width=640,height=900,resizable=yes,scrollbars=yes"
        );
        window.parent?.postMessage({
            type: "cripta-discord-login",
            url: loginUrl.toString(),
            popupOpened: Boolean(embeddedDiscordPopup)
        }, "*");
        return;
    }
    window.location.href = loginUrl.toString();
}

async function loginWithDeviceCode(code) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
        throw new Error("Inserisci un codice accesso.");
    }

    const response = await requestApi("auth/device/login", {
        method: "POST",
        body: { code: cleanCode, campaignId: getCampaignId() }
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

async function consumeDeviceCodeFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || "";
    if (!code) return false;

    params.delete("code");
    const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash || ""}`;

    try {
        await loginWithDeviceCode(code);
    } catch (error) {
        console.error("Login con codice da URL non riuscito:", error);
        window.sessionStorage?.setItem?.("cripta-device-code-login-error", error?.message || "Login non riuscito.");
    } finally {
        history.replaceState(null, "", cleanUrl);
    }

    return true;
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
            const authUrl = new URL(String(data.authUrl), window.location.href);
            applyCampaignToUrl(authUrl, { force: true });
            embeddedDiscordPopup.location.href = authUrl.toString();
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
    const campaignId = sanitizeCampaignId(options.campaignId || getCampaignId());
    if (query && typeof query === "object") {
        Object.entries(query).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            url.searchParams.set(key, String(value));
        });
    }
    if (options.withCampaign !== false && !url.searchParams.has("campaign")) {
        url.searchParams.set("campaign", campaignId);
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
        if (!Array.isArray(requestBody) && !("campaignId" in requestBody) && options.withCampaign !== false) {
            requestBody = { ...requestBody, campaignId };
        }
        requestBody = requestHeaders["Content-Type"].includes("application/json")
            ? JSON.stringify(requestBody)
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
            const verifyUrl = new URL(`${DISCORD_WORKER_URL}/auth/discord/verify`);
            applyCampaignToUrl(verifyUrl, { force: true });
            const response = await fetch(verifyUrl.toString(), {
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
    const currentAccountId = getAuthAccountId(authState);
    const currentDiscordId = getAuthDiscordId(authState);
    if (!currentAccountId && !currentDiscordId) {
        setDmOnlyVisibility(false);
        return false;
    }

    const dmIdentity = await getDmIdentity(basePath);
    const isDm = Boolean(dmIdentity.accountId && currentAccountId === dmIdentity.accountId)
        || Boolean(dmIdentity.discordId && currentDiscordId === dmIdentity.discordId);
    setDmOnlyVisibility(isDm);
    return isDm;
}

function getAuthAccountId(authState) {
    return String(authState?.user?.accountId || authState?.user?.id || authState?.user?.sub || "").trim();
}

function getAuthDiscordId(authState) {
    const explicitId = String(authState?.user?.discordId || "").trim();
    if (explicitId) return explicitId;
    const legacyId = String(authState?.user?.id || authState?.user?.sub || "").trim();
    return /^\d{5,32}$/.test(legacyId) ? legacyId : "";
}

async function getDmIdentity(basePath) {
    const campaignId = getCampaignId();
    if (dmIdentityCache.has(campaignId)) return dmIdentityCache.get(campaignId);
    if (dmIdentityPromise) return dmIdentityPromise;

    dmIdentityPromise = (async () => {
        try {
            const data = await fetchJsonWithCache(resolveDataUrl("next-session.json"));
            const identity = {
                accountId: String(data?.dmAccountId || "").trim(),
                discordId: String(data?.dmDiscordId || "").trim()
            };
            dmIdentityCache.set(campaignId, identity);
            return identity;
        } catch (_) {
            const identity = { accountId: "", discordId: "" };
            dmIdentityCache.set(campaignId, identity);
            return identity;
        } finally {
            dmIdentityPromise = null;
        }
    })();

    return dmIdentityPromise;
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
            const url = new URL(buildWorkerUrl(pathname));
            return applyCampaignToUrl(url).toString();
        },
        site(pathname) {
            return resolveSiteUrl(pathname);
        },
        data(pathname, options) {
            return resolveDataUrl(pathname, options);
        },
        globalData(pathname) {
            return resolveGlobalDataUrl(pathname);
        },
        pollPage() {
            return getSitePollUrl();
        }
    },
    campaigns: {
        defaultId: DEFAULT_CAMPAIGN_ID,
        currentId: getCampaignId,
        isDefault: isDefaultCampaign,
        applyToUrl: applyCampaignToUrl,
        dataUrl: resolveDataUrl
    },
    fetchJson: fetchJsonWithCache,
    getBasePath,
    onPageReady,
    createPageScope,
    getPageSignal
};
