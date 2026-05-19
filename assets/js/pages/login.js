window.CriptaApp.onPageReady("login", () => {
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("code") || params.get("c") || "";
    const nextPath = params.get("next") || "../index.html";
    const message = document.getElementById("login-message");
    const form = document.getElementById("quick-login-form");
    const input = document.getElementById("quick-login-code");

    const setMessage = (text, state = "") => {
        if (!message) return;
        message.textContent = text;
        message.dataset.state = state;
    };

    const completeLogin = async (code) => {
        const cleanCode = String(code || "").trim();
        if (!cleanCode) {
            setMessage("Inserisci il codice personale.", "error");
            if (form) form.hidden = false;
            input?.focus();
            return;
        }

        setMessage("Accesso in corso...", "pending");

        try {
            await window.CriptaDiscordAuth.loginWithDeviceCode(cleanCode);
            setMessage("Accesso completato. Reindirizzamento...", "success");
            window.setTimeout(() => {
                window.location.href = nextPath;
            }, 450);
        } catch (error) {
            setMessage(error?.message || "Login non riuscito.", "error");
            if (form) form.hidden = false;
            if (input) {
                input.value = cleanCode;
                input.focus();
                input.select();
            }
        }
    };

    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        completeLogin(input?.value || "");
    });

    if (codeFromUrl) {
        completeLogin(codeFromUrl);
        return;
    }

    setMessage("Apri il tuo link personale oppure inserisci il codice.", "idle");
    if (form) form.hidden = false;
    input?.focus();
});
