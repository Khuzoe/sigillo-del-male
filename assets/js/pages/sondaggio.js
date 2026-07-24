async function renderPollPage() {
    const container = document.getElementById("next-session-container");
    if (!container) return;

    try {
        const nextSessionConfig = window.CriptaNextSession?.loadConfig
            ? await window.CriptaNextSession.loadConfig({ fallbackPath: window.CriptaApp?.urls?.data?.("next-session.json") || "../assets/data/next-session.json" })
            : await window.CriptaApp.fetchJson(window.CriptaApp?.urls?.data?.("next-session.json") || "../assets/data/next-session.json", { clone: true });

        const campaignLabel = document.getElementById("poll-page-campaign");
        if (campaignLabel) {
            campaignLabel.textContent = nextSessionConfig?.campaignName || "Disponibilità della compagnia";
        }
        if (nextSessionConfig?.campaignName) {
            document.title = `Sondaggio Sessione | ${nextSessionConfig.campaignName}`;
        }

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

    await renderPollPage();
});
