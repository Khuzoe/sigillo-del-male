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
            window.CriptaDiscordAuth?.clearToken?.();
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
            ? await window.CriptaNextSession.loadConfig({ fallbackPath: window.CriptaApp?.urls?.data?.("next-session.json") || "../assets/data/next-session.json" })
            : await fetch(window.CriptaApp?.urls?.data?.("next-session.json") || "../assets/data/next-session.json").then((response) => {
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

window.CriptaApp.onPageReady("sondaggio", async () => {
    if (window.CriptaDiscordAuth?.consumeTokenFromHash?.()) {
        window.location.replace(window.location.pathname + window.location.search);
        return;
    }

    const loginBtn = document.getElementById("discord-login");
    const logoutBtn = document.getElementById("discord-logout");

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            window.CriptaDiscordAuth?.login?.();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            window.CriptaDiscordAuth?.logout?.();
        });
    }

    await Promise.all([
        refreshPollAuthUI(),
        renderPollPage()
    ]);
});
