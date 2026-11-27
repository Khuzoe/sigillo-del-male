# Creazione capacità NPC con AI

Per **Cripta di Sangue con snapshot nativo**, le nuove proposte usano la [generazione integrata nel nuovo editor](npc-ai-editor.md): contesto dalle meccaniche native con versioni, attività multiple e stessi controlli della scheda. Le proposte native accettano anche regole manuali con avviso non bloccante, testo completo e contatori; un tratto passivo può essere privo di attività automatiche. Il percorso descritto sotto rimane attivo per le altre campagne, per gli NPC senza snapshot e per le bozze precedenti.

In **Strumenti AI → Abilità → Crea abilità**, il DM della campagna o l’admin descrive una capacità. Il Worker legge la scheda meccanica salvata (statistiche, GS, risorse, capacità, multiattacco, effetti e attività), genera una proposta e la conserva come bozza privata. Non invia account, dossier, biografia o macro. Se la scheda supera il limite di contesto di 80.000 byte UTF-8, rifiuta la richiesta prima della chiamata API, senza tagliare abilità in silenzio.

L’anteprima mostra subito le regole e l’eventuale icona. **Modifica valori, effetti e icona** apre i campi guidati; **Salva bozza** non usa API a pagamento. Le modifiche non salvate rimangono nella sessione del browser. **Rivedi con AI** usa la bozza corrente e le nuove istruzioni. I valori modificati aggiornano la descrizione meccanica in modo deterministico; la motivazione del bilanciamento è quella dell’ultima proposta AI, non una certificazione automatica del GS.

**Aggiungi abilità** è l’unica azione che accoda un normale comando `item.create` a wiki-sync. Fino ad allora non vengono modificati gli NPC. Il sito mostra “In attesa di Foundry”; la creazione e il successivo export rendono la capacità effettiva nella scheda. Se Foundry è chiuso, la richiesta rimane in coda. Una proposta non viene confermata se le statistiche usate per generarla sono cambiate. Il generatore non aggiunge automaticamente l’abilità a un Multiattacco e non cambia altre capacità.

## Meccaniche della prima versione

- Una capacità `feat`, un bersaglio, portata in piedi o metri, azione/azione bonus/reazione.
- Attacco con danni principali; facoltativamente TS dopo un colpo riuscito con danni aggiuntivi.
- In alternativa: TS diretto con danni, danni senza tiro per colpire, oppure utilità con condizioni semplici.
- Danni con formula semplice `2d8+4` o valore fisso; CD e bonus attacco espliciti e modificabili.
- Cura al 50% o 100% dei danni principali **oppure** dei soli aggiuntivi.
- Condizioni a durata in round, senza TS ripetuti o regole speciali di rimozione; utilizzi illimitati o con recupero giornaliero/riposo.
- Regole prive di automazione vengono elencate per esteso in `unsupported`, mostrate come avvisi non bloccanti e aggiunte alla descrizione importata per la gestione manuale del GM. Nessuna macro viene generata o eseguita dall’AI.

Per il morso necrotico, il compilatore crea due attività. Midi-QOL collega l’attacco al TS tramite `triggeredActivityId`, bersagli `hitTargets`, senza consumare una seconda azione o utilizzo. La seconda attività contiene soltanto il danno necrotico, non raddoppia i dadi per il critico e riceve il preset di cura. La cura esistente di Khuzoe Automations legge i danni applicati dopo resistenze/immunità/riduzioni, arrotonda per difetto e usa la normale applicazione di guarigione. Richiede l’applicazione automatica dei danni di Midi e un token dell’utilizzatore. I danni effettivi non sono limitati ai PF rimasti del bersaglio (comportamento già previsto dal preset).

## Icona

L’opzione **Genera anche l’icona** usa l’avatar salvato sulla wiki come riferimento. Il modello immagini per le icone è `gpt-image-2.6-sunburst`, qualità `high` per attacchi e azioni attive e `medium` per le passive, una sola immagine quadrata. Si richiede una sorgente standard 1024 × 1024; il browser produce il WebP finale **512 × 512** al momento della conferma. Il Worker verifica tipo/dimensioni e salva una nuova chiave R2 sotto `campaigns/.../managed-actors/.../items/ability-ai-....webp`. Il percorso restituito al sito ha il prefisso `media/`.

Il prompt privilegia l’azione, l’effetto, l’oggetto o il simbolo della specifica abilità, con silhouette leggibile in piccolo e senza testo. L’avatar fornisce palette, materiali e dettagli della specie pertinenti; il soggetto e l’inquadratura hanno una composizione propria. La separazione del ruolo della reference segue la [documentazione ufficiale sul prompting delle immagini](https://developers.openai.com/api/docs/guides/image-prompting). Il modello testo è `gpt-5.6-terra`, con output strutturato, reasoning basso, massimo 6.000 token di output e `store:false`. Schema e compilatore sono condivisi tra Worker e frontend, senza campi per JavaScript o flag arbitrari.

Se l’immagine fallisce, la proposta testuale rimane modificabile e confermabile senza immagine. **Rigenera icona** genera solo l’immagine e usa la bozza corrente. Le preview sono private in `_private/ai-abilities/{job}/{attempt}.webp`; la route richiede i permessi sulla campagna e sul lavoro. Nessun dato R2/KV esistente viene cancellato e le proposte non hanno ancora una pulizia automatica.

## Icone per capacità esistenti

Il generatore mostra una **griglia** con icona attuale e proposta affiancate. All’apertura **Solo attive** è spuntato. **Seleziona tutto** aggiunge alla selezione gli attacchi e le azioni attive disponibili. Con un filtro su capacità, incantesimi o selezionati, **Seleziona visibili** applica la stessa regola alle righe mostrate. Per includere le passive puoi selezionarle singolarmente oppure togliere la spunta prima della selezione multipla. **Deseleziona tutto** svuota l’intera selezione.

All'avvio, **Solo selezionati** si attiva automaticamente e il filtro di tipo torna a **Tutte**, così il gruppo scelto resta visibile anche se contiene tipi diversi. Le abilità in elaborazione e quelle già pronte conservano la spunta. Selezione, filtri e indicazioni vengono recuperati nella stessa sessione dopo la chiusura; un lavoro in corso viene mostrato anche riaprendo senza una selezione locale precedente. Il filtro resta modificabile durante la generazione e non avvia richieste AI.

Ogni scheda della griglia ha il proprio campo **Indicazioni aggiuntive (facoltative)**, fino a 1500 caratteri. Anche nella generazione in gruppo, ciascuna icona riceve soltanto il testo scritto nella propria scheda. I testi vengono acquisiti all'avvio e inviati come `visualDirection` nei rispettivi prompt immagini, oltre a nome, descrizione, avatar e stile obbligatorio. Restano conservati passando tra filtri e riaprendo il pannello nella stessa sessione. Le indicazioni di un lavoro salvato sono recuperate anche senza una bozza locale. Il precedente campo comune viene conservato sulle icone già selezionate. Il testo non modifica le regole della capacità. Un invio ripetuto con lo stesso identificativo recupera la richiesta originale con le sue indicazioni. La capability `iconDirections:1` impedisce al nuovo frontend di spendere con indicazioni che un vecchio Worker ignorerebbe.

Il proprietario di un personaggio può ora usare questo strumento anche sui propri attacchi, capacità e incantesimi, senza richiedere lo snapshot nativo NPC. È disponibile inoltre **Traduci abilità**, che propone solo nome e descrizione con confronto prima della conferma. [Dettagli del percorso player](player-ability-ai.md).

In **Strumenti AI → Immagini → Genera icone abilità**, DM e admin selezionano gli attacchi e le capacità (`weapon`, `feat` e `spell`) presenti nello snapshot nativo. Il comando usa **Sunburst 2.6, qualità alta per attacchi e azioni attive e media per le passive**, l’avatar salvato su R2 e un prompt composto dal nome e dalla descrizione della capacità più lo stile delle icone già esistente. Non genera testo o nuove meccaniche: una sola chiamata immagini per capacità selezionata.


Dal prompt versione 2, l’effetto della capacità è il soggetto principale; viso, costume e posa dell’avatar non sono il soggetto predefinito. La generazione riceve anche nomi e brevi descrizioni di fino a 24 altre capacità dello stesso NPC, esclusivamente per scegliere motivi e silhouette distinguibili mantenendo uno stile comune. I dati sono proiettati da nome/descrizione, senza flag, macro o probabilità. Il vecchio contesto JSON serializzato viene decodificato prima di costruire il prompt. Il modello non vede le immagini delle altre icone: questo migliora le indicazioni fornite, senza garantire che le immagini finali siano tutte diverse. Il risultato visivo va valutato sulle nuove anteprime.

La capacità `iconPromptVersion: 2` e il controllo `imageModel: gpt-image-2.6-sunburst` evitano nuove spese con un coordinatore rimasto sul prompt o modello precedente durante la pubblicazione. Le nuove generazioni e le rigenerazioni esplicite usano [Sunburst 2.6](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst) con la qualità determinata dalle meccaniche della singola capacità. I lavori esistenti restano recuperabili e le immagini già pronte non vengono rigenerate automaticamente. Le prove controllano richieste distinte per due capacità, contesto per differenziare il soggetto, riferimento avatar, modello/qualità e oggetti di anteprima separati. Nessuna nuova generazione reale viene eseguita dai test; per usare il modello aggiornato occorre pubblicare Worker e frontend.

Le richieste sono sequenziali; il pannello mostra il numero di capacità selezionate, senza un tetto mensile. **Usa icona** invia esclusivamente una patch `img` all’Item esistente. Descrizioni, attività, effetti e altre impostazioni rimangono invariati. Si controllano le modifiche pendenti e i cambiamenti concorrenti alla capacità/immagine prima della conferma. L’icona è generata in WebP 1024 × 1024 e convertita dal browser a 512 × 512 prima dell’applicazione.

Chiudere la finestra conserva le anteprime già generate o in corso, ma ferma l’avvio delle capacità successive non ancora inviate. Riaprire recupera l’ultimo lavoro di ogni capacità senza chiamate a pagamento. Doppio invio e ripetizione della conferma usano identificativi stabili; **Rigenera icona** è una nuova richiesta esplicita. **Interrompi attesa** riusa il recupero dei blocchi già presente. Non ci sono limiti mensili locali; i contatori storici dei tentativi restano conservati. I lavori di sole icone non chiamano il modello testuale.

Le route dedicate sono `/api/managed-actors/{world}/{actor}/ability-icons` e `/{job}/{preview|confirm|stop}?item={itemId}`. Il coordinatore esistente `ABILITY_GENERATOR` dichiara la nuova capacità prima di accettare richieste: un vecchio coordinatore non avvia una generazione testuale per errore. Non servono nuovi binding o migrazioni. Occorre pubblicare Worker e frontend aggiornati. Avatar, tile e bottino usano ora **Sunburst 2.6**, preservando le impostazioni precedenti di qualità e dimensioni.

`npm run test:npc-ability-icons` verifica le route reali con SQLite locale e immagini simulate: modello, qualità delle icone attive e passive degli NPC e dei PG, riferimento avatar, riservatezza, separazione per Item, conferma della sola immagine, doppio invio, conflitti, tentativi illimitati, interruzione e scarto persistente. Nessuna chiamata a pagamento o scrittura nei mondi.

## Suggerisci modifiche

In **Strumenti AI → Scheda NPC → Suggerisci miglioramenti**, il pannello **Suggerisci modifiche** analizza l’avatar attuale e la stessa scheda meccanica completa. È riservato al DM della campagna e all’admin. È possibile indicare una preferenza, ad esempio mantenere il GS o rafforzare il ruolo di supporto.

Il risultato indica quali capacità valorizzare e come usarle al tavolo, fino a quattro modifiche motivate, fino a tre idee di nuove abilità e gli aspetti da verificare. L’analisi cerca sinergie tattiche, scelte per i giocatori e spunti sociali o esplorativi legati al ruolo dell’NPC. Confronta anche nomi delle mosse, danni ed equipaggiamento. Le osservazioni sull’avatar distinguono i dettagli visibili dalle ipotesi. Il bilanciamento resta una proposta da valutare al tavolo.

**Sviluppa abilità** apre il generatore con l’idea già descritta. Non avvia una generazione a pagamento e non riusa una precedente bozza come base. La scheda cambia solo dopo la normale conferma di creazione dell’abilità; i consigli alle statistiche restano consultivi.

La route `/api/managed-actors/{world}/{actor}/ability-suggestions` invia a `gpt-6.2-sol` il contesto meccanico e l’avatar R2 della stessa campagna (massimo 12 MB). La richiesta usa ragionamento `medium`, immagine con dettaglio `high`, output strutturato e `store:false`. Se il riferimento R2 cambia tra prenotazione ed esecuzione, la chiamata viene fermata. L’analisi accede ai dati dell’NPC e ai media in sola lettura.

I risultati sono conservati nel Durable Object esistente, separati dalle bozze delle abilità. Riaprirli non chiama OpenAI. Avatar o statistiche cambiati segnalano un’analisi non aggiornata e impediscono di svilupparne le idee prima di rianalizzare. I suggerimenti non hanno un limite mensile locale; i contatori storici dei tentativi restano conservati. Doppio invio e ripresa usano lo stesso UUID, senza ripetere automaticamente chiamate a pagamento interrotte.

**Scarta analisi** rimuove il risultato attuale dalla vista salvata dell’NPC e torna alla schermata iniziale, anche dopo chiusura e riapertura. La route autenticata `POST .../ability-suggestions/{id}/discard` registra lo scarto nel coordinatore e rimuove soltanto il riferimento al risultato corrente: il lavoro storico e i contatori restano conservati, senza modifiche a NPC, media o bozze delle abilità. Funziona anche senza chiave del provider o avatar; la consultazione dell’analisi salvata resta accessibile dagli strumenti AI. Le analisi in corso non si scartano; se un altro client ha già avviato un’analisi nuova, lo scarto del risultato precedente viene rifiutato e il pannello si aggiorna. Le richieste ripetute sono idempotenti e un vecchio invio non ripristina il report scartato. Il pulsante richiede la capacità `canDiscardSuggestions` del coordinatore aggiornato. Una nuova analisi parte soltanto premendo **Analizza NPC**.

Per questa funzione pubblicare Worker e frontend (incluso `npc-suggestions.js`); nessuna ulteriore modifica a Foundry è necessaria per leggere i consigli. La creazione effettiva delle abilità conserva i requisiti di Wiki Sync descritti sotto.

## Pubblicazione

1. Pubblicare il Worker con il nuovo binding `ABILITY_GENERATOR` e la migrazione additiva `ability-generation-v1`. Usa lo stesso secret `OPENAI_API_KEY` degli avatar; non serve reinserirlo se è già configurato. Da `workers/main-worker`: `npx.cmd wrangler deploy`.
2. Pubblicare il frontend, inclusi `npc-ability-generator.js`, CSS e `npc-ability-schema.mjs` (quest’ultimo viene importato anche nel bundle del Worker).
3. Wiki Sync **0.11.13** deve includere la modifica in `integrations/cripta-wiki-sync/npc-ability-generation-0.11.13.patch`, riferita alla versione locale 0.11.12. Nella cartella Foundry di sviluppo è già applicata. Ricaricare Foundry e sincronizzare la scheda dell’NPC: `definition.editor.generatedAbilities = 1` abilita la conferma sul sito. Khuzoe Automations con `npcRules` v1 e Midi-QOL devono essere attivi per le meccaniche collegate. Il modulo valida e compila i preset prima di creare l’Item; dipendenze mancanti non producono una capacità incompleta.

Nessun deploy o aggiornamento dei dati dei mondi avviene attraverso gli script di prova.

## Limiti e recupero

Abilità, icone, suggerimenti NPC, avatar, tile e bottino non hanno limiti mensili locali. Le precedenti variabili `ABILITY_MONTHLY_LIMIT`, `ABILITY_ICON_MONTHLY_LIMIT` e `NPC_SUGGESTION_MONTHLY_LIMIT` vengono ignorate, anche se ancora presenti nell’ambiente. Restano applicabili credito, accesso e limiti di frequenza del provider. I contatori storici continuano a registrare i tentativi, senza bloccare nuove richieste. Un solo lavoro abilità alla volta può essere attivo. Le transazioni del Durable Object coordinano contatori, UUID e alarm; richieste ripetute riusano il lavoro. Dopo un’interruzione durante una chiamata a pagamento non si ritenta automaticamente.

La conferma congela il documento da accodare. Se si perde la risposta, **Completa invio** riprende lo stesso documento e lo stesso transfer ID; Wiki Sync riconosce un Item già creato anche dopo la rimozione del comando dalla coda. Rimane la consistenza del percorso di comandi KV preesistente: questa funzione non migra né sostituisce la coda generale.

## Diagnosi degli errori

Le nuove generazioni distinguono errori di autenticazione/accesso/modello, credito o quota esauriti, frequenza eccessiva, richiesta non accettata, errori del servizio, timeout/connessione, risposta incompleta (incluso limite token), rifiuto, JSON non valido e validazione locale. Per una proposta respinta dai controlli viene mostrato anche il motivo del validatore, senza applicare dati parziali.

**Dettagli del problema** contiene categoria, fase, ID della generazione e, quando disponibili, stato HTTP, codici/parametri consentiti e request ID del servizio. Non salva o espone il messaggio grezzo del provider, le chiavi API, la risposta generata non valida o lo stack dell’eccezione. La stessa diagnosi è usata per le analisi e per le icone; un errore dell’icona conserva la capacità già pronta. Non si effettuano tentativi automatici a pagamento e non si deduce l’addebito dal solo errore.

Gli errori delle generazioni precedenti non contengono questi dettagli: dopo la pubblicazione del Worker vengono classificati soltanto i nuovi tentativi. Il frontend mostra esplicitamente quando la causa storica non è disponibile. Nessuna migrazione dei dati NPC o KV è necessaria.

## Verifica

- `npm run test:ability-generation`: schema, compilazione, route Worker reali con API simulate, isolamento campagne/ruoli, quote, doppio invio, immagine privata/pubblica, failure immagini, ripresa senza nuove spese, conflitti, conservazione dati e pulsante nell’editor reale; analisi visiva, report consultivi isolati, rilevamento scheda modificata e quota separata.
- `npm run test:ability-foundry`: esegue la funzione di creazione del modulo installato e il compilatore/runtime di Khuzoe Automations con Actor simulati. Verifica deduplicazione, condizioni, cura separata dal danno fisico e dipendenze prima della scrittura. Usa `FOUNDRY_DATA_PATH` per scegliere una cartella Data diversa da quella di sviluppo locale.
- Le prove non sostituiscono il collaudo di un tiro nel mondo dell’utente né una valutazione della proposta generata da un modello reale. Nessuna chiamata OpenAI a pagamento viene eseguita dai test.

Riferimenti API: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Images edits](https://developers.openai.com/api/reference/resources/images/methods/edit), [modello testo](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

Analisi visiva: [Images and vision](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses).

Gestione errori API: [Error codes](https://developers.openai.com/api/docs/guides/error-codes).

## Recupero delle attese bloccate

Ogni lavoro ha una scadenza persistita: due minuti per iniziare l’esecuzione e quindici minuti dall’inizio di ciascuna fase. Per i lavori precedenti senza scadenza si usa `createdAt + 15 minuti`. La chiamata immagini mantiene il timeout di dodici minuti. Letture e nuovi invii controllano anche il blocco globale, oltre all’alarm: un lavoro scaduto non impedisce altre generazioni e non viene ripetuto a pagamento. Il tentativo rimane registrato nei contatori storici.

Prima di dichiarare l’esito incerto si controlla se l’immagine privata era già stata salvata. Risultati validi arrivati in ritardo vengono conservati nel proprio lavoro, senza rimuovere blocchi/alarm di richieste successive. Le icone recuperate non sovrascrivono modifiche manuali alla capacità; un testo recuperato dopo la scadenza non avvia automaticamente un’ulteriore chiamata immagini.

Il browser mostra il tempo trascorso, permette di chiudere la finestra e riprende il controllo dello stato dopo un errore temporaneo. Le richieste di stato hanno un timeout di 20 secondi e il controllo automatico avviene ogni 10 secondi. Non viene mai ritentata automaticamente una generazione a pagamento. Il Worker va pubblicato per recuperare i blocchi remoti; il frontend va pubblicato per distribuire anche i nuovi comportamenti dell’interfaccia.

`npm run test:generation-recovery` verifica blocchi scaduti/precedenti/orfani, risultati già caricati, richieste ancora valide, completamenti tardivi, conservazione delle modifiche e dei blocchi successivi, senza chiamate a pagamento o modifiche ai mondi/KV.

Durante una generazione, **Interrompi attesa** libera il blocco senza avviare un altro lavoro. Il browser tenta di interrompere la richiesta al provider; questo non garantisce l’annullamento della generazione o del costo sul servizio. Il tentativo rimane registrato nei contatori storici. Le icone interrotte mantengono la capacità modificabile e confermabile senza icona. Il comando è riservato a DM/admin sulla stessa campagna e sullo stesso NPC, è ripetibile senza ulteriori spese e controlla l’identità del tentativo per non interrompere un’icona più recente da una scheda obsoleta. Risultati validi tardivi restano recuperabili.

Durante la propagazione di un deploy, il Worker può raggiungere un Durable Object ancora sulla versione precedente. `canStop` viene quindi dichiarato dal coordinatore effettivo e propagato al frontend, mai dedotto dalla sola versione del Worker. Un vecchio coordinatore che risponde `409 Operazione non disponibile.` viene riconosciuto come `503 GENERATOR_UPDATING`, senza ripetere chiamate a pagamento. L’interruzione scrive soltanto lo stato e libera il blocco: non attende R2. Per un intervento urgente usare una versione ufficiale di Wrangler che supporti `--durable-objects-code-update-mode immediate`; è una scelta per quel deploy, non una nuova impostazione permanente. Il reset delle istanze interrompe il lavoro in memoria ma conserva lo storage persistente.

## Card Foundry di NPC e giocatori

In **Modifica → Aspetto condiviso → Card Foundry** puoi caricare, sostituire o rimuovere una fascia. **Salva scheda** conferma la modifica. Con **Apri card** puoi vedere l’immagine a piena risoluzione.

**Strumenti AI → Genera card** invia al modello il nome e l’avatar salvati sulla scheda. L’avatar guida il ritratto a destra e il nome compare a sinistra su fondo scuro. Gli ultimi 200 px sfumano verso il quasi nero al bordo inferiore. Anche la generazione automatica con le icone usa questi due input. Occorre un avatar disponibile sulla wiki, fino a 12 MB. Il Worker richiede un WebP da **1600 × 960 px** a `gpt-image-2.6-sunburst` con qualità `xhigh`. **Applica card** salva l’anteprima scelta.

Dopo **Applica card** puoi chiudere la finestra mentre il Worker salva la proposta. Riaprendo **Genera card** ritrovi lo stato del salvataggio. Se la conferma non è arrivata, puoi premere di nuovo **Applica card** sulla stessa anteprima.

Quando si generano icone abilità, una seconda richiesta immagini crea e salva automaticamente la card se manca. L’intera serie condivide la stessa richiesta per la card. Una card caricata durante l’attesa ha la precedenza. Il percorso salvato è disponibile in `media.card.path` nell’API degli Actor gestiti. La pubblicazione richiede il frontend e il Worker con il binding `ACTOR_CARD_GENERATOR` e la migrazione Durable Objects `actor-card-v1`.
