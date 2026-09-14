# Codici di accesso: elenco aggiuntivo

Il Worker legge due elenchi, nello stesso formato:

1. `DEVICE_LOGIN_CODES_SECRET` (oppure il fallback storico `DEVICE_LOGIN_CODES`): elenco originale.
2. `DEVICE_LOGIN_CODES_EXTRA_SECRET`: elenco aggiuntivo opzionale.

Ogni riga contiene `codice|discordId|accountId|nomeVisibile`. Sono accettati sia righe separate sia `;`. Il codice deve essere lungo, casuale e univoco; e' una credenziale, non un semplice nome utente.

L'elenco aggiuntivo non sostituisce quello originale. In caso di duplicati, il codice e l'associazione Discord dell'elenco originale hanno precedenza. `GLOBAL_ADMIN_DEVICE_CODE` conserva la precedenza e il funzionamento precedenti. I nuovi account non ricevono permessi DM automaticamente.

## Aggiungere un giocatore senza perdere i codici esistenti

- Verificare `accountId` e `discordId` in `assets/data/users.json`, e l'associazione al personaggio nella campagna.
- Controllare prima i nomi dei secret con `wrangler secret list` (non restituisce valori).
- Se `DEVICE_LOGIN_CODES_EXTRA_SECRET` non esiste, crearlo con il nuovo elenco. Non modificare il secret originale.
- Se esiste gia', partire dalla copia completa dell'elenco aggiuntivo e aggiungere la nuova riga: l'aggiornamento di un secret sostituisce tutto il suo contenuto, non aggiunge una riga automaticamente.
- Se manca la copia completa, non sovrascrivere alcun secret.
- Conservare la copia dei nuovi codici fuori da Git, preferibilmente in un gestore di password; condividere con ciascun giocatore soltanto il suo codice, in privato.
- Verificare un accesso alla campagna corretta senza stampare il JWT nei log.

Il giocatore seleziona la campagna e usa **Login con codice**. Il codice autentica l'account; l'accesso ai contenuti continua a dipendere dalle autorizzazioni della campagna e del personaggio.

Non aggiungere il secret opzionale a `secrets.required`: le installazioni senza nuovi codici devono continuare a funzionare.

Test senza rete o dati reali: `npm run test:auth`.
