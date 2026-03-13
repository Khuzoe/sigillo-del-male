const POLL_DISCORD_WORKER_URL = "https://sigillo-api.khuzoe.workers.dev";
const POLL_DISCORD_TOKEN_KEY = "discord_jwt";

function pollTokenFromHash() {
    const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
    if (!hash) return "";

    const params = new URLSearchParams(hash);
    return params.get("token") || "";
}

function pollStoreToken(token) {
    try {
        window.localStorage.setItem(POLL_DISCORD_TOKEN_KEY, token);
    } catch (_) {
        // Ignore storage issues
    }
}

function pollClearToken() {
    try {
        window.localStorage.removeItem(POLL_DISCORD_TOKEN_KEY);
    } catch (_) {
        // Ignore storage issues
    }
}

function pollConsumeTokenFromHash() {
    const token = pollTokenFromHash();
    if (!token) return false;
    pollStoreToken(token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
}

async function refreshPollAuthUI() {
    const status = document.getElementById("auth-status");
    const loginBtn = document.getElementById("discord-login");
    const logoutBtn = document.getElementById("discord-logout");
    if (!status || !loginBtn || !logoutBtn) return;

    const token = typeof window.CriptaDiscordAuth?.getToken === "function"
        ? window.CriptaDiscordAuth.getToken()
        : "";

    if (!token) {
        status.textContent = "Non loggato";
        loginBtn.hidden = false;
        logoutBtn.hidden = true;
        return;
    }

    status.textContent = "Verifica login...";
    loginBtn.hidden = true;
    logoutBtn.hidden = false;

    try {
        const authState = await (window.CriptaDiscordAuth?.verify ? window.CriptaDiscordAuth.verify() : Promise.resolve(null));
        if (!authState?.user) {
            pollClearToken();
            status.textContent = "Non loggato";
            loginBtn.hidden = false;
            logoutBtn.hidden = true;
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

async function renderPollPage() {
    const container = document.getElementById("next-session-container");
    if (!container) return;

    try {
        const nextSessionConfig = window.CriptaNextSession?.loadConfig
            ? await window.CriptaNextSession.loadConfig({ fallbackPath: "../assets/data/next-session.json" })
            : await fetch("../assets/data/next-session.json").then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP error next-session.json: ${response.status}`);
                }
                return response.json();
            });

        container.dataset.nextSessionView = "poll";
        window.CriptaNextSession?.render(nextSessionConfig, container);
    } catch (error) {
        console.error("Errore nel caricamento del sondaggio:", error);
        container.innerHTML = '<p style="color: var(--red); text-align:center;">Impossibile caricare il sondaggio.</p>';
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    if (pollConsumeTokenFromHash()) {
        window.location.replace(window.location.pathname + window.location.search);
        return;
    }

    const loginBtn = document.getElementById("discord-login");
    const logoutBtn = document.getElementById("discord-logout");

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            window.location.href = `${POLL_DISCORD_WORKER_URL}/auth/discord/login`;
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            pollClearToken();
            window.location.replace(window.location.pathname + window.location.search);
        });
    }

    await Promise.all([
        refreshPollAuthUI(),
        renderPollPage()
    ]);
});
