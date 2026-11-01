# Modifica NPC con AI

Il pulsante nella barra della scheda apre una revisione dell’intero NPC di gioco: statistiche, capacità, incantesimi, inventario ed effetti. È disponibile ai DM e all’admin per Cripta di Sangue, Mago Folle e Oltre il Velo. Avatar e dossier della wiki conservano i propri strumenti.

Una richiesta può combinare aggiornamenti, aggiunte e rimozioni. L’AI restituisce operazioni mirate sui documenti nativi, non un Actor sostitutivo. Il riepilogo distingue ogni modifica, creazione e rimozione; l’editor manuale è lo stesso usato dal resto della scheda. La conferma rimane esplicita.

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

Una generazione usa una sola prenotazione del limite testuale mensile esistente. Nessuna generazione immagini e nessun tentativo automatico a pagamento. Modello e impostazioni restano quelli del generatore di abilità; per una revisione ampia il limite di risposta è 32.000 token. Il costo effettivo dipende dalla lunghezza di input e output.

Le bozze vengono conservate in parti private e transazionali del Durable Object, rispettando il limite per singolo valore. Il contesto ha un massimo di 240 kB, la bozza 1,5 MB, il piano di sincronizzazione 700 kB e il lavoro archiviato 2 MiB: gli eccessi vengono rifiutati, senza troncamento. I candidati non validi vengono conservati privatamente per una futura correzione del compilatore.

“Qualsiasi modifica” non equivale a inventare nuove automazioni di Foundry: ciò che non è rappresentabile con i dati e i moduli supportati deve essere riportato in `unsupported` e impedisce la conferma. Rimangono protetti identità, permessi, origine dei documenti, macro e configurazioni dei dadi riservate. Le modifiche al runtime dei token non collegati rimangono gestite sui token.

## Verifica

`npm run test:npc-sheet-ai` controlla compilazione e protezioni della traduzione, interfaccia con l’editor condiviso, archiviazione a parti, vere route Worker con D1 di prova e applicazione del gruppo tramite l’adattatore Wiki Sync installato. Comprende conflitti, ricevute, ripetizioni e ripristino. Le chiamate al servizio AI sono simulate e non vengono modificati Actor reali.
