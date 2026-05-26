# Template Campagna

Per usare solo il sondaggio con una nuova campagna:

1. Copia questa cartella e rinominala con lo slug della campagna, per esempio `mago-folle`.
2. Aggiorna `data/players.json` con `id`, `name`, `accountId` e `campaignRole` dei partecipanti.
3. Aggiorna `data/next-session.json` con `dmAccountId`, `dmDiscordId`, slot disponibili e, se vuoi, `voteIcons`.
4. Apri il sondaggio con `pages/sondaggio.html?campaign=mago-folle`.

Gli utenti globali stanno in `assets/data/users.json`. Un utente puo partecipare a piu campagne con ruoli o personaggi diversi.

Gli asset icona possono essere:

- nomi file in `assets/img/ui`, per esempio `dm_yes.webp`;
- percorsi R2 via Worker, per esempio `media/ui/mago-folle/mago_yes.webp`;
- URL assoluti `https://...`.

Non serve avere `sessions.json` o riassunti sessione se usi solo la pagina sondaggio.

Se vuoi l'invio automatico su Discord per questa campagna, imposta `discordWebhookUrl`.
Se lo lasci vuoto, il sondaggio funziona comunque ma non posta nel canale Discord.

Se un utente non e DM ma deve poter gestire il sondaggio, aggiungilo a `pollManagerAccountIds` e `pollManagerDiscordIds`.

Per ora `disableDiscordNotifications` e impostato a `true`, quindi creare o confermare sessioni non invia messaggi su Discord.
