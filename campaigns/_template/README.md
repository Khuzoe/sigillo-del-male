# Template Campagna

Per creare una nuova campagna solo sondaggio:

1. Copia questa cartella e rinominala con lo slug della campagna, per esempio `mago-folle`.
2. In `data/players.json`, usa `accountId` per collegare un utente globale a un ruolo/personaggio della campagna.
3. In `data/next-session.json`, imposta `dmAccountId` e `dmDiscordId` del DM della campagna.
4. Apri `pages/sondaggio.html?campaign=<slug>`.

Gli utenti globali stanno in `assets/data/users.json`. Un utente puo partecipare a piu campagne con personaggi o ruoli diversi.

Se un utente non e DM ma deve poter gestire il sondaggio, aggiungilo a `pollManagerAccountIds` e `pollManagerDiscordIds`.

Se non vuoi inviare notifiche Discord quando crei o confermi una sessione, imposta `disableDiscordNotifications` a `true`.
