# JSON nativo completo degli NPC

## Estensione automatica con Wiki Sync 0.11.19

La raccolta comprende Cripta di Sangue, Mago Folle e Oltre il Velo, quando abilitate nell’archivio D1. All’avvio di ogni mondo, una coda dedicata controlla gli NPC già presenti sulla wiki, anche se una sincronizzazione media è in attesa o lo stato locale deve essere recuperato dall’indice remoto. Trasformazioni temporanee, token sintetici, PG e Actor non condivisi restano esclusi.

Viene controllato il contenuto anche quando la versione locale era già aggiornata, per acquisire modifiche eseguite mentre Wiki Sync era spento. Gli hash confermati evitano invii inutili; errori di rete conservano il lavoro e applicano un’attesa prima del nuovo tentativo. La conferma aggiorna soltanto i metadati locali, compresa la revisione dell’Actor registrato sul sito, senza modificare Actor, Item, effetti o immagini.

Il generatore della scheda usa il JSON già archiviato e non dipende dalla versione più recente del modulo per preparare una bozza. La compatibilità di applicazione viene controllata separatamente alla conferma. Non serve avviare manualmente una sincronizzazione per ogni NPC.

La sezione seguente documenta il rilascio iniziale del pilota.

## Rilascio iniziale

Wiki Sync **0.11.14** aggiunge la raccolta del JSON nativo completo degli NPC del
mondo di Cripta di Sangue. Il Worker conserva ogni snapshot in un documento D1
separato. La rappresentazione usata dal sito, i dossier e le code dei comandi
mantengono il formato attuale.

Il Worker è pubblicato dal 31 ottobre 2026, versione
`5335e56d-2e22-4342-971f-da97b9f00b60`, con la sola campagna Cripta abilitata.
Sono passati 85 controlli locali del nuovo flusso, le regressioni esistenti e il
confronto di 67 risposte API online. I 257 documenti KV originali, con metadati
e scadenze, sono risultati identici dopo la pubblicazione. Backup e report sono
in `output/npc-native-snapshot-qa/`. Il controllo iniziale del database non
conteneva ancora snapshot: l'invio dei dati reali richiede il caricamento del
nuovo codice nel client GM.

## Cosa viene conservato

La sorgente è `Actor.toJSON()`, con fallback alla sorgente persistente
`Actor.toObject(true)` o `_source`. Il contenuto viene serializzato come JSON,
senza compattazione, pulizia dello schema, migrazioni o troncamenti. Comprende
oggetti, attività, effetti incorporati, tutti i flag, `_stats`, configurazione
del token prototipo, valori vuoti e campi sconosciuti al sito. Le immagini restano
riferimenti nel JSON: questa funzione non carica file o immagini aggiuntivi.

È il JSON dell'Actor del mondo. I valori derivati durante la preparazione e i
delta dei singoli token indipendenti continuano a essere rappresentati dalle
funzioni già esistenti; non vengono mescolati alla sorgente persistente.
PG, altre tipologie di Actor, Actor sintetici dei token e trasformazioni
temporanee non entrano nella nuova raccolta.

L'involucro aggiunge identità, data di cattura, versioni di Foundry, D&D5e e Wiki
Sync, elenco dei moduli attivi con versione e hash SHA-256. Il JSON sorgente
rimane intatto. La data di cattura e l'ordine delle proprietà non cambiano l'hash.
Il calcolo funziona anche nei client HTTP di rete locale senza SubtleCrypto.

## Raccolta automatica

Al prossimo caricamento del client GM di Cripta, la normale coda del modulo
programma l'invio iniziale degli NPC già presenti nello stato Managed Actor e
privi di uno snapshot confermato. Questi lavori leggono il JSON e lo inviano:
saltano creazione degli ID di trasferimento, media, importazioni e aggiornamenti
di Actor o Item. Sul mondo vengono mantenuti solo i normali metadati della coda
e la conferma dell'invio, non una copia del JSON completo.

Dopo gli invii normali viene verificato anche lo snapshot. Cambiamenti a flag o
campi che non compaiono nella scheda ridotta possono quindi aggiornare il JSON
completo. Le modifiche dei soli HP e degli altri campi runtime accodano una
cattura separata, usando il raggruppamento esistente del modulo. Una sorgente
già confermata con lo stesso hash non genera nuove richieste o scritture D1.

Il GM primario e le modalità di sincronizzazione esistenti continuano a
controllare l'invio. In modalità di sola ricezione non viene aggiunto un nuovo
percorso di esportazione. I normali export di riconciliazione dei comandi del
sito continuano a funzionare anche in tale modalità.

## Worker, accessi e archiviazione

L'abilitazione richiede contemporaneamente:

- campagna `cripta-di-sangue`;
- campagna presente in `MANAGED_ACTOR_D1_CAMPAIGNS`;
- campagna presente in `MANAGED_ACTOR_NATIVE_SNAPSHOT_CAMPAIGNS`;
- archivio D1 già importato e pronto.

Il nuovo endpoint è `/api/managed-actors/{world}/{actor}/snapshot?campaign=...`.

- **POST:** riservato al secret di sincronizzazione Foundry con contratto v14.
  Un account del sito, anche admin, non può sostituire la sorgente.
- **GET:** riservato all'account admin globale autenticato. DM, proprietari dei
  companion, giocatori, lettori anonimi e il solo secret Foundry non possono
  scaricare il JSON completo. La risposta è sempre privata e senza cache.

Gli endpoint normali non ricevono lo snapshot completo. L’editor ricava una
proiezione privata dei campi modificabili; dalla versione Wiki Sync 0.11.16 la
[generazione delle capacità di Cripta](npc-ai-editor.md) ricava un contesto delle
meccaniche con versioni, escludendo account, biografia, macro e flag riservati.
Il JSON sorgente rimane separato e non viene sostituito dall’AI.

Il documento usa la chiave logica
`campaign:cripta-di-sangue:managed-actor-native-snapshot:{world}:{actor}` nella
tabella `managed_actor_documents`, tipo `native-snapshot`, e le parti nella
tabella `managed_actor_document_chunks` quando necessario. Si riutilizzano le
transazioni, le revisioni interne e la gestione dei grandi documenti introdotte
per gli NPC. Non è necessaria un'altra migrazione SQL.

Ogni upload controlla campagna, Actor, UUID, tipologia NPC, versioni dichiarate e
hash del contenuto. Uno snapshot con `_stats.modifiedTime` precedente a quello
già conservato viene rifiutato. Gli errori preservano la copia precedente e non
provocano scritture di ripiego su KV. Un hash identico non riscrive D1.

Il limite è **8 MiB per snapshot**: uno snapshot più grande viene segnalato e
rimane intero nella sorgente. Il client evita di riprovare continuamente lo
stesso documento troppo grande. Le sorgenti accettate non vengono troncate.
Le copie KV precedenti, gli Actor del mondo e le immagini sono conservati.

## Installazione e verifica

Il sorgente condiviso è
`integrations/cripta-wiki-sync/npc-native-snapshot.mjs`. È importato anche dal
Worker per usare lo stesso algoritmo di integrità. La patch completa rispetto
al modulo 0.11.13 è
`integrations/cripta-wiki-sync/npc-native-snapshot-0.11.14.patch`; include il nuovo
file, le modifiche al sincronizzatore e il manifest 0.11.14.

La patch è applicata all'installazione Foundry DEV TEST. Per raccogliere i dati,
ricaricare il client GM del mondo di Cripta dopo la pubblicazione del Worker.
Le altre campagne continuano a usare i loro flussi precedenti. Il vecchio
`build:module` del repository non va usato con una copia `module/` obsoleta.

Test locali:

```text
npm run test:npc-native-snapshot
node --experimental-default-type=module scripts/test-npc-native-snapshot.mjs PERCORSO/cripta-wiki-sync/scripts/services/managed-actor-sync.js
```

I test usano SQLite/D1 temporaneo e Actor simulati, senza dati remoti o chiamate
AI. Coprono JSON completo, Unicode e testi lunghi, hash e client HTTP, file oltre
2 MB, rollback, privacy, limiti di campagna, deduplicazione, backfill del modulo
installato, modalità di sola ricezione e conservazione dei documenti KV.
