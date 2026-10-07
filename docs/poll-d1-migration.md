# Sondaggi su D1 — prova progressiva

## Stato della modifica

Attivo dal 7 ottobre 2026 per i sondaggi di tutte le campagne attualmente configurate: `cripta-di-sangue`, `mago-folle` e `oltre-il-velo`. Il database D1 `khuzoe-wiki`, creato dall'utente su Cloudflare, è configurato nel binding `POLL_DB` con ID `7cbdeb91-6194-4212-a89b-eda4fce4d58d`; è stata applicata la migrazione additiva `0001_polls.sql`. La versione finale del Worker pubblicata e verificata è `0542ef6d-0a08-4bdf-aa90-148d1fb63985`, con `POLL_D1_CAMPAIGNS=cripta-di-sangue,mago-folle,oltre-il-velo` e `POLL_WRITES_PAUSED_CAMPAIGNS` vuoto. I salvataggi sono riabilitati per tutte e tre.

Prima dell'attivazione è stata salvata una copia locale di 60 documenti KV dei sondaggi di Cripta di Sangue, inclusi quelli legacy, in `output/poll-backup-20261007/2026-10-07T12-28-44-975Z/`: ogni documento è stato verificato byte per byte e registrato nel manifest con SHA-256. La sessione corrente via API è la 37, con 5 partecipanti nel documento dei voti. Nessun dato remoto è stato modificato da questo backup. È uno snapshot acquisito con il servizio attivo; ripetere il backup nella finestra del passaggio prima di importare.

Durante il passaggio sono stati bloccati i soli salvataggi dei sondaggi di Cripta, attendendo la propagazione prima del backup definitivo in `output/poll-backup-20261007/2026-10-07T12-33-45-588Z/`. La successiva attivazione di D1 è avvenuta mantenendo il blocco fino al termine delle verifiche. Importati 17 sondaggi (sessioni 21–37), 86 documenti di voto e 18 marcatori/copie originali; la sessione corrente rimane la 37 con 5 partecipanti. Confrontate 37 risposte API prima/dopo, comprese le sessioni correnti delle altre due campagne: configurazioni e voti coincidono. Verificati inoltre byte per byte tutti i 60 documenti KV e le copie originali D1. I report sono `verification.json` e `storage-verification.json` accanto al backup.

Il frontend locale invia `expectedRevision`; la home locale è stata verificata nel browser e mostra la sessione 37, 5 partecipanti, 11 fasce orarie e le disponibilità preesistenti, senza errori di caricamento. Non sono stati inseriti voti fittizi o risalvate configurazioni reali per la verifica. Il frontend pubblico controllato il 7 ottobre 2026 non invia ancora la revisione e carica `next-session.js?v=20260923-poll-composer1`: l'utente ha autorizzato esplicitamente l'attivazione usando per ora il frontend locale. Lettura e normali voti rimangono compatibili; per modificare la configurazione dal sito pubblico resta da pubblicare `assets/js/shared/next-session.js`, `index.html`, `pages/sondaggio.html` e `pages/sessioni.html` aggiornati e verificare la versione `20261007-poll-storage1`.

Successivamente l'utente ha modificato il proprio voto (account `andre`) per mercoledì 7 ottobre nella sessione 37 da `yes` a `no`: verificato sia direttamente in D1 sia tramite l'API. L'estensione alle altre due campagne ha bloccato temporaneamente solo i loro salvataggi, mantenendo Cripta disponibile. Il backup in `output/poll-backup-20261007/all-campaigns-2026-10-07T14-02-17-247Z/` contiene i 48 documenti KV delle due campagne e l'esportazione SQL di D1 prima dell'estensione, inclusa la modifica reale del voto di Cripta. Confrontate 48 risposte API prima/dopo e verificate tutte le copie KV immutate e 25 marcatori/copie originali D1. Il report è `verification.json` accanto al backup.

In D1 risultano 17 sondaggi/86 documenti di voto per Cripta, 14/62 per Mago Folle e 9/35 per Oltre il Velo. Dopo la riapertura verificati i sondaggi correnti: Cripta sessione 37 con 5 partecipanti (voto modificato ancora `no`), Mago Folle sessione 15 con 5 partecipanti, Oltre il Velo sessione 10 con 3 partecipanti; tutti restituiscono `revision=1`. Il flag elenca gli ID esplicitamente: per una futura campagna nuova, eseguire la procedura di backup e attivazione e aggiungere il suo ID.

Restano le API `/api/session/current`, `/api/session`, `/api/session-votes`, il formato dei voti e il compositore delle immagini. Le icone rimangono nei servizi KV/R2 attuali. Discord e i controlli dei permessi leggono il medesimo archivio selezionato per la campagna.

## Archivio e conservazione

- `poll_sessions`: configurazione e revisione di ciascun sondaggio.
- `poll_current`: sessione attiva della campagna.
- `poll_votes`: un documento per partecipante; ogni scelta viene applicata con `json_patch` direttamente in SQL, senza riscrivere i voti altrui o le altre date del partecipante.
- `poll_vote_documents`: metadati originali della raccolta.
- `poll_imports`: copie integrali dei JSON KV originali e marcatori di importazione.

La prima lettura di un sondaggio di una campagna abilitata copia sessione e voti da KV. Importazione e marcatore sono una transazione: due richieste contemporanee non duplicano i voti. I documenti KV originali non vengono modificati o cancellati. I sondaggi storici vengono importati quando consultati; quelli ancora solo in KV restano disponibili attraverso la stessa API. Il calendario, gli Actor e i progressi degli alberi non vengono migrati.

Solo la campagna `cripta-di-sangue` può importare le vecchie chiavi senza prefisso campagna. Un JSON non valido interrompe l'importazione: non viene sostituito con dati vuoti. Una sessione corrente presente solo nella vecchia chiave `session/current` viene recuperata anche senza `session/<numero>`.

Una volta importato, D1 è la fonte ufficiale per quel sondaggio. Non si ripiega su KV in caso di errori D1 e non si aggiornano copie KV a ogni voto: questo evita divergenze e scritture doppie. È necessario aggiornare tutti i consumatori prima dell'attivazione.

## Salvataggi e permessi

Il frontend conserva la `revision` restituita dal server e invia `expectedRevision`. Per un nuovo sondaggio invia `0`. In D1, una modifica obsoleta restituisce `409 POLL_REVISION_CONFLICT`, senza cambiare la sessione corrente. Un vecchio frontend privo di revisione deve essere ricaricato prima di modificare un sondaggio D1; i normali voti restano compatibili.

I permessi del sondaggio sono verificati contro DM/manager già memorizzati o editor di campagna configurati, anziché i ruoli dichiarati nel corpo della richiesta. L'account del voto deve coincidere con l'utente autenticato. Solo il Discord ID autenticato può agganciare un voto legacy: il client non può dichiarare un ID altrui per modificarne il voto. La rimozione di una data viene verificata anche nel momento della scrittura SQL.

## Prova locale

Prerequisiti: Node 22 e dipendenze Wrangler installate in `workers/main-worker` (esbuild e Miniflare sono incluse). Dalla radice:

```powershell
npm run test:poll
npm run test:poll-storage
```

Il test crea un runtime Workers con D1/SQLite temporaneo, applica lo schema dal repository e usa dati fittizi. Non legge credenziali di produzione, non chiama Discord, non modifica dati reali e non usa una build obsoleta dentro `output`.

## Preparazione della prima campagna online

1. Controllare che l'account Cloudflare sia sul piano Workers Free e che le quote disponibili siano sufficienti. Questa modifica non richiede un piano a pagamento.
2. Usare il database D1 `khuzoe-wiki` già creato su Cloudflare. Non serve crearne un altro.
3. Il binding è già presente nella configurazione Wrangler; verificare che corrisponda al database dell'account Cloudflare:

```json
"d1_databases": [
  {
    "binding": "POLL_DB",
    "database_name": "khuzoe-wiki",
    "database_id": "7cbdeb91-6194-4212-a89b-eda4fce4d58d",
    "migrations_dir": "migrations"
  }
]
```

4. Schema additivo già applicato e verificato il 7 ottobre 2026. Per eventuali migrazioni successive, dalla cartella `workers/main-worker`: `npx wrangler d1 migrations apply khuzoe-wiki --remote`. La migrazione `0001_polls.sql` non contiene istruzioni di cancellazione.
5. Pubblicare prima il frontend aggiornato, verificando il caricamento della nuova versione `next-session.js`, poi il Worker con `POLL_D1_CAMPAIGNS` ancora vuoto. Conservare la precedente release e un backup KV dei documenti dei sondaggi.
6. Impostare `POLL_D1_CAMPAIGNS` a una sola campagna, per esempio `cripta-di-sangue`, e pubblicare il Worker. Successivamente si possono aggiungere ID separati da virgole.
7. Controllare sessione corrente, voti preesistenti, immagini, una modifica autorizzata, un voto e i permessi. Verificare le metriche D1 prima di estendere l'attivazione.

Le tre campagne attuali sono già attive su D1. Resta da pubblicare il frontend pubblico aggiornato; la procedura descritta serve per eventuali campagne future.

## Esportazione e ritorno a KV

`GET /api/polls/storage/export?campaign=<id>` con Bearer token admin restituisce un'esportazione privata, non memorizzabile in cache. `originals` contiene i JSON integrali importati; `kvDocuments` contiene i valori aggiornati di tutte le sessioni e votazioni già presenti in D1, con le chiavi compatibili con KV. Sono comprese le chiavi legacy solo per la campagna originale. Non vengono incluse o modificate altre raccolte.

I documenti storici mai importati sono già in KV e non devono essere rimossi. Per tornare a KV dopo nuovi voti D1, **non basta disabilitare il flag**: KV conserva la copia precedente all'attivazione.

Procedura: impostare `POLL_WRITES_PAUSED_CAMPAIGNS` alla campagna e pubblicare il Worker; attendere la propagazione e la conclusione delle richieste già in corso; esportare D1 e salvare anche una copia KV corrente; verificare l'esportazione; riportare in KV i soli `kvDocuments` aggiornati; verificare i valori; rimuovere la campagna da `POLL_D1_CAMPAIGNS`, svuotare il flag di manutenzione e pubblicare il Worker. Il blocco restituisce un messaggio di manutenzione per i salvataggi ma permette di leggere i sondaggi. Conservare database D1, copie originali ed esportazioni. Prima di una successiva riattivazione, riallineare D1 ai nuovi voti KV durante la stessa finestra di manutenzione: non riattivare una copia D1 rimasta indietro.

Questo aggiornamento non esegue automaticamente il rollback né cancella archivi: la scelta dell'archivio ufficiale deve essere esplicita.

## Quote e limiti

D1 Free include 5 milioni di righe lette/giorno, 100.000 righe scritte/giorno e 5 GB complessivi, con ulteriori limiti per database. Query, indici, importazione e copie originali contribuiscono ai consumi. I dati vengono cercati per campagna/sessione/identità con chiavi e indici; non è aggiunto polling o sincronismo Foundry.

Restano da misurare consumi reali D1 e Worker dopo la prima attivazione. Sul piano Free, l'esaurimento delle quote può interrompere le operazioni; questa implementazione non abilita abbonamenti o addebiti.

Riferimenti ufficiali: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
