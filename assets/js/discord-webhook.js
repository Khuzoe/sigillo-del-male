// PLACEHOLDER: Replace with your actual Discord webhook URL
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1445767374245593088/soExRthMlvX4RsZi__aaMkb0Gcqm001ZGDphKLs5sRCS9V8lGF9aZuxXHdqd72emp4Ek';

// Session data (could be imported or fetched from another file in a real app)
const nextSessionConfig = {
    number: 14,
    title: "Sessione 14", // Added for a richer embed
    date: "3 Dicembre 2025",
    timeStart: "20:30",
    timeEnd: "23:30",
    isScheduled: true,
    url: "https://example.com/link-to-your-game" // Replace with a real URL if you have one
};

/**
 * Formats the session data into a Discord embed object.
 * @param {object} sessionData - The session configuration object.
 * @returns {object} A Discord embed object.
 */
function createDiscordEmbed(sessionData) {
    
    // Convert Italian month to a number for the Date object
    const monthMap = {
        "Gennaio": 0, "Febbraio": 1, "Marzo": 2, "Aprile": 3, "Maggio": 4, "Giugno": 5,
        "Luglio": 6, "Agosto": 7, "Settembre": 8, "Ottobre": 9, "Novembre": 10, "Dicembre": 11
    };
    const dateParts = sessionData.date.split(" ");
    const day = parseInt(dateParts[0], 10);
    const month = monthMap[dateParts[1]];
    const year = parseInt(dateParts[2], 10);
    const [hours, minutes] = sessionData.timeStart.split(':').map(Number);
    const sessionDate = new Date(year, month, day, hours, minutes);

    const embed = {
        color: 0xd4af37, // Gold color
        title: `Prossima Sessione: ${sessionData.title}`,
        description: "**Un nuovo capitolo sta per iniziare!**",
        url: sessionData.url,
        fields: [
            {
                name: "Data e Ora",
                value: `<t:${Math.floor(sessionDate.getTime() / 1000)}:F>`, // Discord timestamp format
                inline: false
            },
            {
                name: "Orario",
                value: `Dalle ${sessionData.timeStart} alle ${sessionData.timeEnd}`,
                inline: true
            },
            {
                name: "Link Partita",
                value: `[Clicca qui](${sessionData.url})`, // Assumes a URL is available
                inline: true
            }
        ],
        footer: {
            text: "Cripta di Sangue - Preparate i dadi!",
            icon_url: "https://raw.githubusercontent.com/Melfa/Cripta-di-Sangue-GIT/main/assets/img/logo.webp" // Replace with your logo URL
        },
        timestamp: new Date().toISOString()
    };
    
    if (!sessionData.isScheduled) {
        embed.title = `Sessione ${sessionData.number} - Data da Definire`;
        embed.description = "La prossima sessione non è ancora stata programmata. Restate sintonizzati per aggiornamenti!";
        embed.fields = []; // No fields needed if not scheduled
    }

    return {
        username: "Cripta di Sangue Bot",
        avatar_url: "https://raw.githubusercontent.com/Melfa/Cripta-di-Sangue-GIT/main/assets/img/logo.webp", // Replace with your bot's avatar URL
        embeds: [embed]
    };
}

/**
 * Sends the session announcement to the Discord webhook.
 */
async function sendSessionAnnouncement() {
    if (WEBHOOK_URL === 'YOUR_DISCORD_WEBHOOK_URL') {
        alert("Per favore, imposta l'URL del webhook nel file 'assets/js/discord-webhook.js'.");
        console.error("Webhook URL not configured.");
        return;
    }

    const payload = createDiscordEmbed(nextSessionConfig);

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert("Annuncio della sessione inviato con successo su Discord!");
        } else {
            alert(`Errore nell'invio dell'annuncio: ${response.status} ${response.statusText}`);
            console.error('Failed to send webhook', await response.json());
        }
    } catch (error) {
        console.error("Errore durante la richiesta al webhook:", error);
        alert("Si è verificato un errore di rete. Controlla la console per i dettagli.");
    }
}
