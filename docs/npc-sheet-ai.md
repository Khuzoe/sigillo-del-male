# Modifica NPC con AI

Il pulsante nella barra della scheda apre una revisione dell’intero NPC di gioco: statistiche, capacità, incantesimi, inventario ed effetti. È disponibile ai DM e all’admin per Cripta di Sangue, Mago Folle e Oltre il Velo. Avatar e dossier della wiki conservano i propri strumenti.

Una richiesta può combinare aggiornamenti, aggiunte e rimozioni. L’AI restituisce operazioni mirate sui documenti nativi, non un Actor sostitutivo. Il riepilogo distingue ogni modifica, creazione e rimozione; l’editor manuale è lo stesso usato dal resto della scheda. La conferma rimane esplicita.

## Riferimento visivo

**Modifica NPC con AI** allega automaticamente l’avatar salvato sulla wiki, quando disponibile. La stessa richiesta contiene il contesto nativo filtrato, le istruzioni del GM, l’eventuale bozza da rivedere e l’immagine come `input_image`, con dettaglio `low`. Il percorso è condiviso con **Suggerisci modifiche** e usa l’invio di testo e immagini descritto nella [documentazione ufficiale OpenAI](https://developers.openai.com/api/docs/guides/images-vision). Il modello testo resta quello configurato per le capacità; non viene chiamato un generatore di immagini.

L’avatar serve a mantenere coerenti anatomia, abbigliamento, equipaggiamento e dettagli delle modifiche richieste. Le istruzioni del GM e le regole esistenti hanno precedenza. L’aspetto non dimostra automaticamente allineamento, immunità, volo o poteri; le inferenze vanno dichiarate nelle ipotesi. La traduzione conserva le meccaniche anche in presenza dell’immagine. Il contesto della scheda comprende anche l’eventuale biografia nei dati nativi di Foundry; i dossier separati della wiki restano esclusi.

L’immagine viene letta esclusivamente da R2 nella campagna corrente, con limite di 12 MB. Chiave ed ETag vengono fissati all’avvio; l’immagine viene letta e ricontrollata prima della chiamata al modello. Un riferimento mancante, cambiato o troppo grande ferma il lavoro prima della chiamata AI, senza tentativi automatici. I byte dell’immagine rimangono temporanei: non sono archiviati nelle bozze, mostrati nelle risposte pubbliche o riscritti sui media esistenti. Ogni revisione con AI usa l’avatar attualmente salvato. Salvataggio, riapertura gratuita e conferma non richiedono un’altra analisi visiva.

Senza un avatar disponibile la richiesta continua con dati e testi. La finestra indica se la richiesta include il riferimento visivo e distingue le vecchie proposte generate senza immagine. La capacità `nativeSheetVisualInput: 1` impedisce di inviare nuovi lavori a un coordinatore precedente che ignorerebbe l’avatar. Occorre pubblicare Worker e frontend aggiornati; questa modifica non richiede aggiornamenti a Foundry né riscritture dei JSON NPC.

## Traduzione

Il comando rapido **Traduci tutte le capacità** sceglie la modalità `translate`. Questa modalità ammette soltanto nomi e testi: vieta modifiche meccaniche, aggiunte e rimozioni e controlla numeri, espressioni dei dadi e riferimenti Foundry. L’editor mostra solo i campi testuali. Gli effetti generati dai preset restano gestiti dai preset.

## Contratto e sincronizzazione

- Formato `npc-native-sheet-edit-v1`, coordinatore privato con scope `:sheet`.
- Il contesto comprende la scheda meccanica e le versioni installate, con proiezione priva di macro, dati di proprietà, flag privati e probabilità riservate. Nessun codice generato viene eseguito.
- Nuovi Item e ActiveEffect ricevono ID stabili. Per attività ed effetti delle capacità viene usato lo stesso compilatore degli aggiornamenti AI delle singole abilità.
- Prima della conferma, i campi coinvolti vengono confrontati con lo snapshot corrente. PF, utilizzi consumati e campi estranei alla richiesta non vengono ripristinati.
- Un solo comando D1 `nativeSheetVersion: 1` contiene il gruppo. I lettori del sito ricevono il riepilogo, senza i documenti grezzi o i dati nascosti contenuti nelle basi di confronto.
- Wiki Sync **0.11.19** pubblicizza `nativeSheetEditor: 1` nelle tre campagne, verifica tutti i documenti con i modelli installati prima di scrivere e registra la ricevuta del gruppo. Le ripetizioni non applicano nuovamente il comando.
- Foundry non offre una transazione tra documenti: un errore durante l’applicazione attiva il ripristino delle modifiche del gruppo. Un conflitto durante il ripristino viene segnalato senza sovrascrivere le modifiche concorrenti. Non è una garanzia di atomicità contro arresti del processo o modifiche di altri moduli durante l’applicazione.
- Una proposta bloccata prima dell’accodamento torna modificabile; una conferma già accodata viene recuperata tramite il suo identificativo, senza duplicati.

Il supporto delle altre campagne usa la stessa struttura D1 del pilota, senza nuove tabelle. I documenti gestiti vengono copiati e verificati prima dell’attivazione: gli originali KV restano intatti. I vecchi canali AI e le loro bozze conservano i propri contratti.

## Disponibilità e caricamento automatico

`canGenerate` richiede un JSON nativo completo già archiviato, indipendentemente dalla versione di Wiki Sync che lo aveva inviato. La proposta e la bozza possono essere preparate con Foundry spento. `canSync` verifica separatamente che sia stata comunicata la capacità di applicare il gruppo: soltanto la conferma attende questo requisito. Non viene prenotata un’altra chiamata AI quando Foundry aggiorna la capacità.

All’apertura del mondo, il modulo controlla tutti gli NPC già noti allo stato locale o all’indice della wiki. Questa coda è separata da immagini e normali aggiornamenti: un caricamento media fallito non blocca il JSON. Il controllo rileva anche modifiche eseguite mentre il modulo era disattivato. Gli hash invariati non generano nuovi invii. I lavori procedono uno alla volta con attesa progressiva sugli errori, sotto il controllo del GM principale; i passaggi di GM riprendono la raccolta.

La finestra del sito attende automaticamente i dati mancanti e abilita i comandi quando arrivano. In assenza di dati controlla più raramente dopo il primo minuto. Non richiede selezione, condivisione o sincronizzazione manuale degli NPC. Serve una prima connessione al mondo con il modulo aggiornato se il sito non ha mai ricevuto il JSON; un Actor assente dal mondo non può essere inventato dal solo dossier.

## Costi, archiviazione e limiti

Una generazione registra un tentativo, senza limiti mensili locali. Nessuna generazione immagini e nessun tentativo automatico a pagamento. Modello e impostazioni restano quelli del generatore di abilità; per una revisione ampia il limite di risposta è 32.000 token. Il costo effettivo dipende dalla lunghezza di input e output.

Le bozze vengono conservate in parti private e transazionali del Durable Object, rispettando il limite per singolo valore. Il contesto ha un massimo di 240 kB, la bozza 1,5 MB, il piano di sincronizzazione 700 kB e il lavoro archiviato 2 MiB: gli eccessi vengono rifiutati, senza troncamento. I candidati non validi vengono conservati privatamente per una futura correzione del compilatore.

Le regole prive di automazione possono essere importate come capacità descrittive da gestire manualmente dal GM. Il testo completo rimane nella descrizione della rispettiva capacità; `unsupported` e gli avvisi ricavati dai collegamenti automatici non impediscono la conferma della scheda completa. Resistenza alla Magia può quindi conservare la regola del vantaggio senza effetti automatici, e Resistenza Leggendaria il testo e il contatore degli utilizzi senza decidere l’esito del TS. Non si inventano attività, flag o automazioni fittizie. Strutture non valide, nuovi duplicati, modifiche protette e conflitti continuano a bloccare l’invio. Anomalie preesistenti vengono conservate durante modifiche indipendenti; i dati ambigui restano in sola lettura. Rimangono protetti identità, permessi, origine dei documenti, macro e configurazioni dei dadi riservate. Le modifiche al runtime dei token non collegati rimangono gestite sui token. I dettagli su campi nullable, velocità, effetti v14 e identificatori Midi sono in [Campi e automazioni dopo l’audit](npc-ai-editor.md#campi-e-automazioni-dopo-laudit-dei-json).

## Verifica

`npm run test:npc-sheet-ai` controlla compilazione e protezioni della traduzione, interfaccia con l’editor condiviso, archiviazione a parti, vere route Worker con D1 di prova e applicazione del gruppo tramite l’adattatore Wiki Sync installato. Comprende conflitti, ricevute, ripetizioni e ripristino; invio di testo e avatar, revisioni con il nuovo avatar, dettaglio visivo, assenza dell’immagine, isolamento campagne, blocco per riferimento cambiato/mancante/troppo grande e nessuna persistenza del base64. Le chiamate al servizio AI sono simulate e non vengono modificati Actor reali.
