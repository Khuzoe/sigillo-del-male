# Struttura degli alberi su D1

## Ambito e conservazione

La raccolta `skill-trees` può usare D1 nelle campagne elencate in `SKILL_TREE_DEFINITION_D1_CAMPAIGNS`. Il primo passaggio riguarda Cripta. Il database è lo stesso `khuzoe-wiki`, binding `POLL_DB`; lo schema additivo `0003_skill_tree_definitions.sql` crea `skill_tree_definition_documents` e `skill_tree_definitions`.

Ogni albero conserva il suo JSON completo: nodi, collegamenti, requisiti, livelli, descrizioni, proprietà personalizzate e riferimenti alle immagini. La struttura dei dati non cambia; le immagini rimangono nel loro archivio corrente. Il documento di campagna conserva metadati e versione globale. Ogni albero dispone inoltre di una propria revisione.

L'importazione legge esclusivamente `campaign:<id>:data:skill-trees:override` e conserva il valore integrale in `original_raw`. KV non viene riscritto né cancellato. Importazione e marcatore sono atomici, anche con letture simultanee. Documenti malformati, identità duplicate e strutture senza nodi impediscono l'importazione; non vengono scartati record o creati dati vuoti per nascondere un errore. Dopo l'importazione D1 è la fonte autorevole e un suo errore non provoca un ripiego su una copia KV obsoleta.

## Salvataggi e compatibilità

Il frontend aggiornato invia `{ tree, expectedTreeRevision }`. Due alberi diversi si possono salvare contemporaneamente. Una modifica obsoleta dello stesso albero restituisce `409 VERSION_CONFLICT` senza sovrascrivere dati. Modifica del JSON e incremento di revisione/metadati avvengono nella stessa transazione; un identificatore univoco impedisce a una richiesta fallita di riutilizzare il successo di un'altra.

I vecchi client rimangono compatibili con `{ tree, expectedVersion }` o `{ data, expectedVersion }`: il confronto atomico della versione globale evita la perdita di salvataggi concorrenti. Le operazioni sulla raccolta aggiornano le revisioni solo degli alberi effettivamente cambiati. La rimozione conserva una revisione senza payload, impedendo a un vecchio primo salvataggio di ricreare la voce cancellata. La copia originale e KV rimangono comunque disponibili.

Creazione, modifica e rimozione delle definizioni restano riservate agli editor di campagna autenticati. La verifica dei progressi condivisi legge le definizioni dall'archivio attivo, quindi non usa vecchie regole KV dopo la migrazione. Bootstrap, sync e pulizia delle raccolte usano lo stesso archivio.

La risposta conserva API, `collection`, `campaignId`, `version` e `data`, aggiungendo `treeRevisions` e `source: "d1"`. Il frontend adotta il contenuto completo restituito dal server dopo un successo; un errore conserva cache e revisioni precedenti. Una raccolta online vuota rimane vuota, senza ripristinare alberi statici.

Wiki Sync locale 0.11.8 accetta già `kv` e `d1` sia per strutture sia per progressi, mantenendo i controlli di integrità. Non occorre una nuova modifica al modulo per questa migrazione. La 0.11.7 con il controllo esclusivo `source: "kv"` deve essere aggiornata prima di sincronizzare; vedere [skill-tree-d1-migration.md](skill-tree-d1-migration.md). Nessun documento del mondo viene modificato direttamente dalla procedura di migrazione.

Il frontend locale usa la versione `20261007-skill-definitions-d1-1`; restano da pubblicare i file aggiornati sul sito pubblico. I client precedenti con versione globale continuano a funzionare.

## Verifiche

`npm run test:skill-tree-definition-storage` verifica il Worker reale con SQLite/D1 temporaneo. Gli 81 controlli coprono importazioni simultanee, metadata e campi sconosciuti, permessi, salvataggi su alberi diversi e sullo stesso albero, rollback, eliminazione e ripristino, client precedenti, letture bootstrap/sync, esportazione privata e conservazione KV. Vengono esercitati anche i serializer delle pagine personaggio e managed actor, la cache dell'editor condiviso e il rifiuto di modifiche ai progressi quando una definizione diventa condivisa in D1.

Superate le verifiche preesistenti: 78 controlli dei progressi D1, 92 dei sondaggi D1, 35 degli sblocchi e 17 dell'interfaccia requisiti. Nessuna richiesta di prova inserisce voti, sblocchi o modifiche a dati reali online.

## Attivazione e ripristino

Per ogni campagna: applicare lo schema, pubblicare il Worker con `SKILL_TREE_DEFINITION_WRITES_PAUSED_CAMPAIGNS` attivo e la nuova campagna ancora esclusa da D1, attendere propagazione e richieste in corso, salvare backup KV byte per byte e D1 completo, abilitare D1 mantenendo la pausa, confrontare tutte le definizioni/metadati e le API, poi riaprire i salvataggi. La pausa blocca solo le scritture alle definizioni; letture e progressi rimangono disponibili.

`GET /api/skill-trees/storage/export?campaign=<id>` richiede un account admin e restituisce una risposta privata senza cache con originale integrale e `kvDocuments` aggiornati. Non scrive in KV. Dopo nuovi salvataggi D1, disabilitare semplicemente il flag farebbe leggere il vecchio KV: per tornare indietro occorre sospendere le scritture, esportare/verificare D1, conservare un ulteriore backup KV, riportare esplicitamente i soli documenti aggiornati in KV e verificare prima del cambio archivio. Nessun rollback o riallineamento distruttivo è automatico.

## Stato online

Attivo dal 7 ottobre 2026 per la sola Cripta, con modifiche riaperte. Worker finale verificato: `4c1b2eac-3828-4e74-a402-02e5ce96ad31`, `SKILL_TREE_DEFINITION_D1_CAMPAIGNS=cripta-di-sangue` e `SKILL_TREE_DEFINITION_WRITES_PAUSED_CAMPAIGNS` vuoto. Importati tutti i 9 alberi alla versione 351, circa 148 KB di definizioni JSON, con revisioni individuali iniziali. Nessun albero è stato risalvato per la prova e nessun nodo/requisito è stato alterato.

Backup stabile: `output/skill-tree-definitions-d1/2026-10-07T16-26-13.911Z/`. Contiene valore KV originale, manifest SHA-256, tre risposte API di riferimento (raccolta, bootstrap di Valdor e stato sync), esportazione completa D1 prima dell'importazione e report di confronto prima/dopo la riapertura. Tutto il contenuto delle definizioni e la versione sono identici al riferimento; confrontati anche timestamp e autore della raccolta. Verificati il valore `original_raw` in D1 e KV byte per byte: SHA-256 `2c12ffbf6c5202e5240610ac8a87feae7d8bab1f0d0311adaaef02d8ed14d5ac`.

Il validatore reale di Wiki Sync 0.11.8 accetta le risposte online delle tre campagne; report in `output/skill-tree-definitions-d1/wiki-sync-validation.json`. L'albero di Valdor nel frontend locale si carica senza errori e usa i file versione `20261007-skill-definitions-d1-1`. Nessuna mutazione dei documenti Foundry è stata effettuata per verificare la migrazione.

Mago Folle mantiene 9 alberi/versione 104 in KV e Oltre il Velo 10/versione 271 in KV. I progressi delle tre campagne continuano su D1 (versioni 260, 31, 166 al controllo finale); i sondaggi correnti rispondono normalmente, sessioni 37, 15 e 10. Il backup comprende i dati D1 correnti, inclusi i salvataggi reali effettuati dopo le precedenti migrazioni. I backup sotto `output/` restano sul disco e sono ignorati da Git. Resta da pubblicare il frontend sul sito pubblico; nessun commit o push è stato eseguito da questa procedura.
