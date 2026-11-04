# Khuzoe Tiles Creator

Versione **0.4.0**, Foundry VTT **14**. La sorgente del nuovo modulo è in [`integrations/khuzoe-tiles-creator`](../integrations/khuzoe-tiles-creator/README.md), copiata nella directory modules dell'installazione locale. Nessuna modifica a configurazione dei mondi, scene o attori durante l'installazione. La correzione 0.1.1 esclude le texture non configurate dei livelli (per esempio un primo piano vuoto) prima del caricamento.

Il Worker del sito include la classe `TileGenerationStore` con storage SQLite Durable Object separato per campagna. Non servono migrazioni D1 e il servizio non scrive o cancella dati in KV. La binding `TILE_GENERATOR` e la migrazione `tile-generation-v1` sono additive. Dalla versione 0.2.0 non esiste un limite mensile dei tile: `TILE_MONTHLY_LIMIT` è rimosso e le precedenti variabili non vengono interpretate come blocchi. I contatori di utilizzo vengono conservati senza impedire nuove richieste. Rimane un solo lavoro attivo per campagna, con autenticazione DM/admin obbligatoria.

Il modulo usa la sessione DM/admin della wiki già configurata in Wiki Sync; verifica anche ruolo GM locale, contesto mondo/scena/livello e politica di scrittura. Il segreto condiviso per la sincronizzazione Foundry non autorizza spese AI.

## Flusso

Selezione rettangolare → render separato di sfondo e tile del livello → caricamento privato → generazione immagini dal Worker → confronto prima/dopo → ricomposizione locale della sola selezione → copia del file in Foundry → singolo Tile Document.

La cattura usa sprite separati e una texture di rendering privata, seguendo la composizione di `Scene#createThumbnail` di Foundry 14. Non modifica lo stage attivo e non include token, griglia, annotazioni, illuminazione o nebbia. Il contesto attorno al rettangolo serve solo al generatore. La ricomposizione ritaglia l'area autorizzata e permette un raccordo dei bordi senza chiamate AI aggiuntive.

**Usa come nuovo input** ricompone l'anteprima visualizzata, incluso il raccordo scelto, all'interno del margine di contesto originale. Non ricattura la mappa scartando le modifiche AI. Il client conserva la base in IndexedDB; le nuove richieste inviano `parentJobId`. Il server verifica esistenza, stato pronto e appartenenza della base allo stesso proprietario/campagna/mondo/scena/livello, mantenendo identici rettangolo e margine. Ogni passaggio ha UUID e immagini R2 nuovi. Se il risultato è già stato posizionato, il client verifica che l'unico cambiamento alla composizione sia il tile atteso e aggiorna l'impronta per sovrapporre la nuova versione senza rimuovere quella precedente.

Prima del posizionamento viene confrontata l'impronta di sfondo e tile con quella della cattura. Il tile usa un ID deterministico e un flag `generationId`; conferme ripetute e ricevute perse non creano copie aggiuntive. Le immagini originali e i tile precedenti rimangono intatti. La prima versione non modifica muri, porte o collisioni.

## Reference secondarie

Dalla 0.4.0 si possono allegare PNG/JPG/WebP o selezionare altre aree della scena con la stessa cattura di sfondo e tile. Le selezioni secondarie non cambiano né rettangolo né impronta della mappa primaria. L'interfaccia numera gli allegati da 2; l'immagine 1 rimane la mappa da modificare anche nelle modifiche progressive. Le note facoltative `Cosa riprendere` accompagnano ogni immagine nel prompt, che vincola prospettiva, coordinate e dimensioni del risultato alla prima immagine.

I file vengono normalizzati localmente in WebP, lato lungo massimo 1536 pixel, 2 MB per immagine e 6 MB complessivi; fino a 15 reference secondarie, per un totale di 16 immagini nell'array `images` della [Image edits API](https://developers.openai.com/api/reference/resources/images/methods/edit). Allegare, rimuovere, catturare e modificare note non chiama l'AI. Le reference vengono inviate soltanto con una generazione esplicita.

Il server verifica byte, dimensioni, ordine, quantità e metadati prima di prenotare il lavoro. I file restano nel prefisso R2 privato del nuovo job (`reference-1.webp`, ecc.); nel Durable Object vengono salvati soltanto metadati e impronta. L'impronta include byte e note delle reference, quindi un invio ripetuto con lo stesso UUID non può cambiarle. L'assenza di allegati mantiene l'impronta delle vecchie richieste. I download richiedono lo stesso account, campagna, mondo, scena e livello del lavoro.

Le bozze iniziali e progressive conservano Blob e note in IndexedDB; i tentativi ambigui mantengono lo stesso elenco nell'invio successivo. I lavori completati recuperano le reference tramite route autenticate. Il coordinatore dichiara `referencesVersion: 1`: se la versione attiva non le supporta, il client blocca la generazione con allegati prima di chiamare il provider. Servono il modulo 0.4.0 e il Worker aggiornato; non servono migrazioni o scritture ai dati KV precedenti.

## Gomma locale

Dalla versione 0.3.0, **Gomma** apre un editor della sola anteprima pronta, prima del posizionamento. Usa una maschera PNG di opacità con pennello circolare regolabile; i tratti sono memorizzati come punti per contenere la memoria usata dalla cronologia. Supporta annulla/rifai, ripristino completo e annullamento della finestra.

La maschera viene applicata con `destination-in` dopo la ricomposizione e il raccordo dei bordi, preservando il canale alpha del WebP finale. I quadretti nell'interfaccia sono soltanto uno sfondo CSS e non entrano nell'immagine esportata. La maschera e il raccordo scelto vengono conservati in IndexedDB con una chiave distinta per contesto e generazione, senza interferire con le richieste in attesa. La maschera è trasportata localmente alle generazioni progressive e ridimensionata quando cambia risoluzione. Non viene inviata alle API; soltanto la nuova richiesta esplicita di generazione può usare il servizio AI. Nessun aggiornamento al Worker è necessario per la gomma.

## API

Tutte le operazioni richiedono Bearer JWT di un DM della campagna o dell'admin. Il contesto è composto da `campaign`, `worldId`, `sceneId`, `levelId`; il proprietario viene sempre ricavato dal JWT, mai dal client.

| Metodo | Percorso | Uso |
| --- | --- | --- |
| GET | `/api/tiles/generations` | Ultimo stato e quota del contesto/proprietario |
| POST | `/api/tiles/generations` | Prenotazione idempotente con UUID, richiesta, cattura WebP e opzioni |
| GET | `/api/tiles/generations/:id/source` | Cattura originale privata |
| GET | `/api/tiles/generations/:id/preview` | Risultato privato |
| GET | `/api/tiles/generations/:id/reference-N` | Reference secondaria privata, con N da 1 a 15 (immagini AI da 2 a 16) |
| POST | `/api/tiles/generations/:id/stop` | Interrompi attesa e libera il blocco senza un nuovo tentativo |
| POST | `/api/tiles/generations/:id/placed` | Ricevuta del tile creato in Foundry |

Le catture e le anteprime R2 sono in `_private/ai-tiles/<campaignId>/<uuid>/`, escluse dall'endpoint pubblico `/media/`. Il file finale viene salvato in `Data/khuzoe-tiles/<worldId>/<uuid>.webp`. Le risposte autenticate non sono memorizzabili nelle cache pubbliche.

## Recupero e verifica

La finestra può essere chiusa e riaperta nella stessa scena. Il server conserva il lavoro; gli invii ancora ambigui conservano localmente UUID e cattura tramite IndexedDB. I controlli passivi interrogano solo lo stato, mai il generatore. Alla scadenza, il blocco viene liberato e un eventuale risultato tardivo resta recuperabile senza alterare un lavoro successivo. Le finestre chiuse non eseguono polling.

`npm run test:tiles-creator` verifica geometria e vincoli API, ruoli, privacy delle reference, ordine effettivo degli input al provider, vincoli sui file, isolamento delle campagne, deduplicazione con allegati, contatori senza quota, interruzione, riavvio, recupero e modifiche progressive, gomma, composizione dei layer e posizionamento ripetuto. `node scripts/preview-tiles-creator.mjs` prepara una prova browser con il codice reale del modulo, PIXI/core resize di Foundry e scena/servizio simulati: nessuna chiamata AI a pagamento o modifica a scene reali.
