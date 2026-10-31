# NPC e comandi su D1

Il pilota usa il database `khuzoe-wiki`, binding esistente `POLL_DB`. Le API di
wiki-sync, del sito e dei generatori restano le stesse. La rappresentazione degli
Actor, delle attività e dei flag non viene cambiata da questa migrazione.

## Pilota attivato il 31 ottobre 2026

Cripta di Sangue è attiva su D1 e le scritture sono riaperte. Versione Worker:
`9d84566e-aca3-43d3-ae7b-acad32206a3c`. Le altre campagne restano su KV per i
documenti gestiti.

Sono stati copiati e verificati 257 documenti, contenenti 81 NPC e 7 PG nel
registro condiviso, per 6.717.629 byte originali. Il comando già presente nella
coda è stato conservato. Gli originali KV sono risultati identici prima e dopo
l'attivazione, inclusi metadati e scadenze.

Snapshot, esportazione D1 precedente, SQL e report:
`output/npc-d1/cripta-pilot-20261031/`. Hash SHA-256 del manifest:
`69e78f5ee712a103c7169ea6bf58edbafe0d4425b1984d9b7bf97156d8a88d3e`.
Controlli: 68 verifiche del nuovo archivio su D1 locale e 67 risposte API
confrontate durante l'attivazione, oltre ai controlli esistenti su editor,
generatori, permessi, alberi, sondaggi e calendario. Il rapporto conclusivo è
`release.json` nella cartella dello snapshot.

## Ambito e protezione degli originali

`MANAGED_ACTOR_D1_CAMPAIGNS` abilita una campagna alla volta. Sono inclusi schede,
runtime, dossier, collegamenti ai vecchi dossier, indice, categorie NPC, backup
delle precedenti adozioni, code di modifica e richieste di creazione Actor.
L'indice e le code sono condivisi anche con i personaggi: nel pilota di Cripta
vengono copiati insieme gli 81 NPC e i 7 PG presenti nel registro gestito.
I dati statici e le altre raccolte restano nei rispettivi archivi.

Il comando di importazione **non dispone di un percorso di scrittura su KV**.
Legge e conserva anche i byte originali, gli hash SHA-256, i metadati e le
scadenze. Il backup locale è indipendente da Cloudflare; una seconda copia dei
byte originali si trova nelle tabelle `managed_actor_kv_original*` di D1.
Le chiavi KV mantengono le eventuali scadenze preesistenti: la copia separata
rimane disponibile anche dopo una naturale scadenza di KV.

Quando una campagna è abilitata, letture e scritture dei documenti gestiti usano
esclusivamente D1. Errori o importazioni incomplete non provocano un ritorno
automatico alla vecchia copia KV. Durante il pilota viene sospesa la pulizia
automatica delle immagini NPC e delle immagini temporanee di creazione, per
mantenere utilizzabili anche i riferimenti contenuti nel backup KV.

## Scritture e coda

Ogni richiesta prepara le modifiche e le salva con un unico `db.batch` atomico.
Le revisioni interne proteggono tutti i documenti letti per decidere una modifica.
Un conflitto non applica nessuna delle modifiche della richiesta. Le operazioni
compatibili con un nuovo tentativo, come i normali salvataggi e gli ACK, vengono
riprovate al massimo due volte leggendo di nuovo i dati. I conflitti di revisione
espliciti restano visibili al chiamante. Le generazioni AI non vengono ripetute.

Le schede sono documenti separati. Ogni comando ha una propria riga, stato e ID.
I comandi rimossi dalla coda attiva restano archiviati; gli esiti restituiti da
Foundry sono conservati come ricevute. Un vecchio ACK non rimuove una modifica
più recente, e un esito `applied` non viene degradato da un ACK tardivo.
La lettura del contenitore e dei suoi comandi avviene nello stesso snapshot SQL.

Le notifiche live partono dopo il commit. Anche un generatore marca una proposta
come accettata solo dopo che il salvataggio o il comando sono stati realmente
registrati in D1. La conferma indica l'inserimento in coda; l'applicazione alla
scheda Foundry viene confermata successivamente da wiki-sync, come prima.

I documenti grandi vengono suddivisi in parti senza tagliare le coppie Unicode.
Le letture parallele dei dossier vengono raggruppate per evitare una query per
NPC. Le istruzioni SQL usano parametri; l'importatore suddivide i grandi
letterali per rispettare anche il limite di 100 KB per istruzione SQL
([limiti D1](https://developers.cloudflare.com/d1/platform/limits/)).

## Procedura di attivazione

1. Eseguire `npm run test:managed-actor-storage` e i controlli di regressione.
2. Applicare la migrazione additiva `0004_managed_actors.sql`.
3. Pubblicare il Worker con la campagna in
   `MANAGED_ACTOR_WRITES_PAUSED_CAMPAIGNS`, ancora esclusa da D1. La pausa blocca
   anche la consegna dei comandi a Foundry. Attendere la propagazione e il
   completamento delle richieste precedenti.
4. Acquisire lo snapshot definitivo:
   `node --experimental-default-type=module scripts/migrate-managed-actors-d1.mjs backup --campaign=cripta-di-sangue --folder=output/npc-d1/PERCORSO`.
   Salva i documenti KV e un'esportazione completa di D1 prima dell'importazione.
5. Usando lo stesso percorso, eseguire prima `plan`, poi `import`. Il file SQL
   contiene solo inserimenti protetti: un archivio già attivo non viene sostituito.
   Un import parziale può essere ripreso soltanto con il medesimo manifest.
6. Eseguire `verify`, quindi `activate`. Entrambi confrontano integralmente i
   documenti correnti di D1, le copie originali e tutti i byte e le chiavi in KV.
   Solo `activate` marca l'archivio verificato come `ready`.
7. Abilitare la campagna in `MANAGED_ACTOR_D1_CAMPAIGNS`, mantenendo la pausa.
   Confrontare le risposte reali del sito con la situazione precedente.
8. Rimuovere la pausa e verificare nuovamente gli originali KV. Conservare
   manifest, SQL, esportazione D1 e report sotto `output/`, escluso da Git.
   Dopo la riapertura usare `verify-kv`: controlla gli originali e i loro backup
   senza richiedere che i nuovi dati D1 restino uguali allo snapshot iniziale.

I comandi operativi usano l'autenticazione corrente di Wrangler e non salvano
credenziali nei backup. Con `--cli=...` si può indicare il percorso del CLI.
`inventory` permette una ricognizione preliminare, sempre in sola lettura.

`GET /api/managed-actors/storage/status?campaign=...` è riservato all'account
admin globale e mostra archivio, pausa, stato dell'importazione e conteggi.
Le risposte delle API gestite espongono anche `X-Managed-Actor-Storage: d1`.

## Ripristino

Dopo la riapertura, le nuove modifiche vivono soltanto in D1. Non basta
disabilitare il flag: il sito mostrerebbe lo snapshot precedente di KV e le nuove
modifiche sembrerebbero scomparse. Prima di qualsiasi ripristino occorre bloccare
le scritture, esportare D1 e scegliere esplicitamente come conservare le
modifiche successive al passaggio. Gli strumenti di questa migrazione non
riscrivono automaticamente nessuna chiave KV, neppure per un ripristino.

Non sono richiesti aggiornamenti al modulo Foundry né modifiche ai mondi per
cambiare archivio. Le altre campagne continuano a usare KV per i documenti
gestiti fino a una loro migrazione esplicita.
