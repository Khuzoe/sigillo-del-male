# Progressi degli alberi su D1

## Ambito

La raccolta `skill-tree-states` può usare D1 per campagne elencate esplicitamente in `SKILL_TREE_D1_CAMPAIGNS`. Definizioni degli alberi, requisiti, immagini, personaggi, inventario e calendari rimangono nei loro archivi attuali. Il binding D1 è lo stesso `POLL_DB` già usato dai sondaggi.

Lo schema additivo `0002_skill_tree_states.sql` crea tre tabelle: documento/metadati di campagna, revisioni dei singoli soggetti, record di progresso. Un soggetto corrisponde a un albero e un personaggio, oppure all'albero condiviso della campagna. I JSON conservano livelli, sblocchi, progressi dei requisiti e campi sconosciuti.

## Conservazione e salvataggi

La prima lettura copia esclusivamente la chiave KV `campaign:<id>:data:skill-tree-states:override`, senza modificarla o cancellarla. `original_raw` conserva una seconda copia integrale del valore originale. Importazione e marcatore avvengono nella stessa transazione. Un documento malformato interrompe l'importazione; non viene sostituito con un array vuoto. Le letture successive non consultano KV per i progressi e un errore D1 non provoca un ripiego su dati KV obsoleti.

L'importazione mantiene ordine, ID originali e eventuali duplicati legacy. La revisione è attribuita all'identità logica usata dal frontend; il primo salvataggio mirato consolida solo i duplicati di quel soggetto, come già faceva il frontend. La copia originale rimane intatta.

Il frontend aggiornato invia `{ state, expectedStateRevision }`. Due personaggi diversi possono salvare contemporaneamente; due modifiche basate sulla stessa revisione del medesimo progresso producono un successo e un conflitto `409 VERSION_CONFLICT`. Tutte le scritture della singola operazione sono condizionate a un identificatore univoco e atomiche. Un errore annulla anche la revisione e le rimozioni intermedie. Le revisioni delle voci rimosse rimangono come marcatori per impedire il ripristino da una richiesta obsoleta.

I vecchi client possono continuare a inviare `{ data, expectedVersion }`: il controllo atomico della versione della raccolta impedisce di sovrascrivere un salvataggio intervenuto nel frattempo. Bootstrap dei personaggi, API sync e pulizia delle raccolte usano lo stesso archivio. Il frontend locale adotta i dati e le revisioni restituiti dal server solo dopo un salvataggio riuscito. Non vengono modificati i criteri di sblocco.

Il server distingue editor di campagna e giocatori. Per i salvataggi mirati di un giocatore verifica l'account autenticato, il personaggio posseduto nelle raccolte server e l'assenza di uno stato condiviso protetto. La modifica degli alberi condivisi rimane riservata agli editor, secondo le regole preesistenti.

## Attivazione progressiva

1. Applicare lo schema additivo con `wrangler d1 migrations apply khuzoe-wiki --remote`.
2. Pubblicare il Worker con la campagna in `SKILL_TREE_WRITES_PAUSED_CAMPAIGNS`, lasciando inizialmente vuoto `SKILL_TREE_D1_CAMPAIGNS`. Sono bloccati solo i salvataggi dei progressi; le letture rimangono disponibili.
3. Attendere propagazione e conclusione delle richieste precedenti, salvare il valore KV originale con hash SHA-256 e un'esportazione del database D1 corrente. Conservare anche le risposte API di riferimento.
4. Abilitare la sola campagna scelta mantenendo il blocco. Leggere i progressi per avviare l'importazione e confrontare dati, versione e metadati con il riferimento. Verificare la copia `original_raw`, KV immutato e gli altri consumatori.
5. Togliere il blocco solo dopo tutti i confronti riusciti e verificare nuovamente le API.

La versione frontend per questa modifica è `20261007-skill-states-d1-1` nelle pagine personaggio e managed actor. Pubblicare i file frontend modificati per ottenere i salvataggi mirati anche sul sito pubblico; i vecchi salvataggi della raccolta restano compatibili.

## Esportazione e ritorno a KV

`GET /api/skill-tree-states/storage/export?campaign=<id>` richiede un account admin. La risposta privata senza cache include `originalRaw`, documento attuale e `kvDocuments` compatibili con KV. L'esportazione non scrive in KV.

Dopo nuovi salvataggi D1, disabilitare semplicemente il flag farebbe leggere la vecchia copia KV. Per un eventuale ritorno: bloccare i salvataggi, attendere, esportare e verificare D1, conservare un ulteriore backup KV, riportare esplicitamente i soli valori aggiornati esportati in KV, verificare e infine cambiare archivio. Questa modifica non esegue automaticamente tale procedura e non cancella nessun archivio. Prima di una nuova attivazione occorre riallineare D1 a eventuali modifiche KV successive.

## Verifiche locali

`npm run test:skill-tree-storage` usa SQLite/D1 temporaneo e il Worker reale, senza credenziali di produzione né messaggi Discord. Copre importazioni concorrenti, copie originali, salvataggi distinti e concorrenti, permessi, stati condivisi, cancellazione e ripristino, rollback dopo errori, client legacy, manutenzione, bootstrap/sync e serializzazione del frontend. Eseguire anche `npm run test:skill-trees` e `npm run test:poll-storage` per verificare i comportamenti esistenti.

## Stato online

Attivo dal 7 ottobre 2026 per tutte le campagne attualmente configurate: `cripta-di-sangue`, `mago-folle`, `oltre-il-velo`, con salvataggi riaperti. Worker finale verificato: `10c0f594-f24a-4b37-b3d3-d855fa5ed128`, `SKILL_TREE_D1_CAMPAIGNS=cripta-di-sangue,mago-folle,oltre-il-velo` e `SKILL_TREE_WRITES_PAUSED_CAMPAIGNS` vuoto. I sondaggi delle tre campagne continuano su D1. Per una nuova campagna futura, effettuare backup e confronto prima di aggiungere il suo ID al flag.

Il backup stabile della finestra di migrazione è `output/skill-tree-d1/2026-10-07T15-33-54.497Z/`: valore KV originale, hash SHA-256, risposte API, esportazione SQL D1 precedente all'importazione e report di confronto. Importati tutti i 12 record alla versione 256, raggruppati in 10 identità logiche; nessuna pulizia dei duplicati è stata eseguita. Confrontati tutti i dati, versione, timestamp e autore della raccolta, bootstrap di Valdor e stato sync. Verificati sia `original_raw` sia KV byte per byte, prima e dopo la riapertura. Hash del valore originale: `b2608f5cc2c70bd91396071fbde7e428772a0d23257e482aa3e714e6ac535616`.

La pagina locale dell'albero di Valdor si carica senza errori; verificato il caricamento del modulo `character-skill-tree.js?v=20261007-skill-states-d1-1`. Il voto reale dell'account Andre per mercoledì 7 ottobre, nella sessione 37, rimane `no` in D1. Non sono stati modificati sblocchi, livelli o voti reali per eseguire le verifiche. I 78 controlli locali del nuovo archivio e le verifiche preesistenti degli alberi, sondaggi, calendario ed editor Actor sono riusciti.

L'estensione a Mago Folle e Oltre il Velo ha sospeso solo i loro salvataggi, mantenendo Cripta disponibile. Il backup stabile è `output/skill-tree-d1/other-campaigns-2026-10-07T15-57-05.980Z/`: due valori KV originali con hash, sei risposte API di riferimento, esportazione dell'intero D1 corrente e report di confronto prima/dopo la riapertura. Importati 5 record/versione 31 per Mago Folle (4 identità logiche) e 7 record/versione 166 per Oltre il Velo (5 identità logiche), inclusi gli stati condivisi. Conservati tutti i record, duplicati legacy e metadati; confrontate le API dirette, i bootstrap di Archimede e Sion, lo stato sync e le copie originali D1. KV verificato byte per byte: Mago Folle SHA-256 `59bcdd92734ec8f806bf0045d0c7c16c7f7d759e5d1039e49591de682b280774`; Oltre il Velo `b91b5394a61d70d2f004290c1e83c5372473b5d58ca8089c4ae3a4ecc92a0d18`.

Al controllo finale Cripta è alla versione 258, con 11 record e le medesime 10 identità logiche: il progresso di Garun è alla revisione 3, aggiornato alle 15:48:51 UTC, prima della finestra di estensione alle altre campagne. I salvataggi reali successivi alla prima migrazione hanno consolidato un duplicato dello stesso soggetto; la seconda migrazione non ha modificato Cripta. Il backup SQL prima dell'estensione comprende questi salvataggi. Verificati nuovamente il suo KV originale immutato e `original_raw`. I sondaggi correnti delle tre campagne continuano a rispondere alle API (sessioni 37, 15 e 10). Nessun salvataggio fittizio è stato effettuato online.

Il frontend pubblico resta da pubblicare tramite Git: i client precedenti sono compatibili ma continuano a salvare la raccolta intera con la versione globale. Le modifiche frontend locali consentono il salvataggio mirato. Il backup preliminare `output/skill-tree-d1/preliminary-kv.json` è conservato separatamente. I file sotto `output/` sono ignorati da Git e vanno conservati localmente.
