# Creazione capacità NPC con AI

In **Modifica → Capacità → Crea abilità con AI**, il DM della campagna o l’admin descrive una capacità. Il Worker legge la scheda meccanica salvata (statistiche, GS, risorse, capacità, multiattacco, effetti e attività), genera una proposta e la conserva come bozza privata. Non invia account, dossier, biografia o macro. Se la scheda supera il limite di contesto di 80.000 byte UTF-8, rifiuta la richiesta prima della chiamata API, senza tagliare abilità in silenzio.

L’anteprima mostra subito le regole e l’eventuale icona. **Modifica valori, effetti e icona** apre i campi guidati; **Salva bozza** non usa API a pagamento. Le modifiche non salvate rimangono nella sessione del browser. **Rivedi con AI** usa la bozza corrente e le nuove istruzioni. I valori modificati aggiornano la descrizione meccanica in modo deterministico; la motivazione del bilanciamento è quella dell’ultima proposta AI, non una certificazione automatica del GS.

**Aggiungi abilità** è l’unica azione che accoda un normale comando `item.create` a wiki-sync. Fino ad allora non vengono modificati gli NPC. Il sito mostra “In attesa di Foundry”; la creazione e il successivo export rendono la capacità effettiva nella scheda. Se Foundry è chiuso, la richiesta rimane in coda. Una proposta non viene confermata se le statistiche usate per generarla sono cambiate. Il generatore non aggiunge automaticamente l’abilità a un Multiattacco e non cambia altre capacità.

## Meccaniche della prima versione

- Una capacità `feat`, un bersaglio, portata in piedi o metri, azione/azione bonus/reazione.
- Attacco con danni principali; facoltativamente TS dopo un colpo riuscito con danni aggiuntivi.
- In alternativa: TS diretto con danni, danni senza tiro per colpire, oppure utilità con condizioni semplici.
- Danni con formula semplice `2d8+4` o valore fisso; CD e bonus attacco espliciti e modificabili.
- Cura al 50% o 100% dei danni principali **oppure** dei soli aggiuntivi.
- Condizioni a durata in round, senza TS ripetuti o regole speciali di rimozione; utilizzi illimitati o con recupero giornaliero/riposo.
- Richieste non rappresentabili vengono elencate in `unsupported` e impediscono la conferma. Nessuna macro viene generata o eseguita dall’AI.

Per il morso necrotico, il compilatore crea due attività. Midi-QOL collega l’attacco al TS tramite `triggeredActivityId`, bersagli `hitTargets`, senza consumare una seconda azione o utilizzo. La seconda attività contiene soltanto il danno necrotico, non raddoppia i dadi per il critico e riceve il preset di cura. La cura esistente di Khuzoe Automations legge i danni applicati dopo resistenze/immunità/riduzioni, arrotonda per difetto e usa la normale applicazione di guarigione. Richiede l’applicazione automatica dei danni di Midi e un token dell’utilizzatore. I danni effettivi non sono limitati ai PF rimasti del bersaglio (comportamento già previsto dal preset).

## Icona

L’opzione **Genera anche l’icona** usa l’avatar salvato sulla wiki come riferimento. Il modello immagini è lo stesso degli avatar, `gpt-image-2.5-sunburst`, qualità `medium`, una sola immagine quadrata. Si richiede una sorgente standard 1024 × 1024; il browser produce il WebP finale **512 × 512** al momento della conferma. Il Worker verifica tipo/dimensioni e salva una nuova chiave R2 sotto `campaigns/.../managed-actors/.../items/ability-ai-....webp`. Il percorso restituito al sito ha il prefisso `media/`.

Il prompt privilegia il dettaglio dell’abilità, anatomia e colori dell’avatar, leggibilità in piccolo, senza testo. Il modello testo è `gpt-5.6-terra`, con output strutturato, reasoning basso, massimo 6.000 token di output e `store:false`. Schema e compilatore sono condivisi tra Worker e frontend, senza campi per JavaScript o flag arbitrari.

Se l’immagine fallisce, la proposta testuale rimane modificabile e confermabile senza immagine. **Rigenera icona** genera solo l’immagine e usa la bozza corrente. Le preview sono private in `_private/ai-abilities/{job}/{attempt}.webp`; la route richiede i permessi sulla campagna e sul lavoro. Nessun dato R2/KV esistente viene cancellato e le proposte non hanno ancora una pulizia automatica.

## Suggerisci modifiche

Accanto al generatore, **Suggerisci modifiche** analizza l’avatar attuale e la stessa scheda meccanica completa. È riservato al DM della campagna e all’admin. È possibile indicare una preferenza, ad esempio mantenere il GS o rafforzare il ruolo di supporto.

Il risultato contiene cosa preservare, fino a quattro modifiche motivate (valore attuale, proposta e impatto previsto), fino a tre idee di nuove abilità e le incertezze. Le osservazioni visive sono spunti: non provano immunità, poteri o allineamento. Il bilanciamento resta una proposta da valutare al tavolo.

**Sviluppa abilità** apre il generatore con l’idea già descritta. Non avvia una generazione a pagamento e non riusa una precedente bozza come base. La scheda cambia solo dopo la normale conferma di creazione dell’abilità; i consigli alle statistiche restano consultivi.

La route `/api/managed-actors/{world}/{actor}/ability-suggestions` legge l’avatar R2 della stessa campagna (massimo 12 MB) e lo invia alla Responses API con `input_image`, `detail:low`, insieme al contesto meccanico. Usa lo stesso modello testo, output strutturato e `store:false`; non genera immagini. Se il riferimento R2 cambia tra prenotazione ed esecuzione, la chiamata viene fermata. Nessuna scrittura o cancellazione KV/R2 viene eseguita dall’analisi.

I risultati sono conservati nel Durable Object esistente, separati dalle bozze delle abilità. Riaprirli non chiama OpenAI. Avatar o statistiche cambiati segnalano un’analisi non aggiornata e impediscono di svilupparne le idee prima di rianalizzare. Il limite globale separato `NPC_SUGGESTION_MONTHLY_LIMIT=20` conta tentativi al mese UTC; non è un tetto monetario. Doppio invio e ripresa usano lo stesso UUID, senza ripetere automaticamente chiamate a pagamento interrotte.

Per questa funzione pubblicare Worker e frontend (incluso `npc-suggestions.js`); nessuna ulteriore modifica a Foundry è necessaria per leggere i consigli. La creazione effettiva delle abilità conserva i requisiti di Wiki Sync descritti sotto.

## Pubblicazione

1. Pubblicare il Worker con il nuovo binding `ABILITY_GENERATOR` e la migrazione additiva `ability-generation-v1`. Usa lo stesso secret `OPENAI_API_KEY` degli avatar; non serve reinserirlo se è già configurato. Da `workers/main-worker`: `npx.cmd wrangler deploy`.
2. Pubblicare il frontend, inclusi `npc-ability-generator.js`, CSS e `npc-ability-schema.mjs` (quest’ultimo viene importato anche nel bundle del Worker).
3. Wiki Sync **0.11.13** deve includere la modifica in `integrations/cripta-wiki-sync/npc-ability-generation-0.11.13.patch`, riferita alla versione locale 0.11.12. Nella cartella Foundry di sviluppo è già applicata. Ricaricare Foundry e sincronizzare la scheda dell’NPC: `definition.editor.generatedAbilities = 1` abilita la conferma sul sito. Khuzoe Automations con `npcRules` v1 e Midi-QOL devono essere attivi per le meccaniche collegate. Il modulo valida e compila i preset prima di creare l’Item; dipendenze mancanti non producono una capacità incompleta.

Nessun deploy o aggiornamento dei dati dei mondi avviene attraverso gli script di prova.

## Limiti e recupero

`ABILITY_MONTHLY_LIMIT=30` e `ABILITY_ICON_MONTHLY_LIMIT=20` sono limiti globali separati di tentativi per mese UTC, non tetti monetari. Sono aggiuntivi rispetto al limite avatar. Anche errori e richieste con esito incerto consumano una prenotazione, conservativamente. Un solo lavoro abilità alla volta può essere attivo. Le transazioni del Durable Object coordinano quota, UUID e alarm; richieste ripetute riusano il lavoro. Dopo un’interruzione durante una chiamata a pagamento non si ritenta automaticamente.

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

Ogni lavoro ha una scadenza persistita: due minuti per iniziare l’esecuzione e quindici minuti dall’inizio di ciascuna fase. Per i lavori precedenti senza scadenza si usa `createdAt + 15 minuti`. La chiamata immagini mantiene il timeout di dodici minuti. Letture e nuovi invii controllano anche il blocco globale, oltre all’alarm: un lavoro scaduto non impedisce altre generazioni e non viene ripetuto a pagamento. La prenotazione della quota resta conservata.

Prima di dichiarare l’esito incerto si controlla se l’immagine privata era già stata salvata. Risultati validi arrivati in ritardo vengono conservati nel proprio lavoro, senza rimuovere blocchi/alarm di richieste successive. Le icone recuperate non sovrascrivono modifiche manuali alla capacità; un testo recuperato dopo la scadenza non avvia automaticamente un’ulteriore chiamata immagini.

Il browser mostra il tempo trascorso, permette di chiudere la finestra e riprende il controllo dello stato dopo un errore temporaneo. Le richieste di stato hanno un timeout di 20 secondi e il controllo automatico avviene ogni 10 secondi. Non viene mai ritentata automaticamente una generazione a pagamento. Il Worker va pubblicato per recuperare i blocchi remoti; il frontend va pubblicato per distribuire anche i nuovi comportamenti dell’interfaccia.

`npm run test:generation-recovery` verifica blocchi scaduti/precedenti/orfani, risultati già caricati, richieste ancora valide, completamenti tardivi, conservazione delle modifiche e dei blocchi successivi, senza chiamate a pagamento o modifiche ai mondi/KV.

Durante una generazione, **Interrompi attesa** libera il blocco senza avviare un altro lavoro. Il browser tenta di interrompere la richiesta al provider; questo non garantisce l’annullamento della generazione o del costo sul servizio. Il tentativo e la quota prenotata restano conservati. Le icone interrotte mantengono la capacità modificabile e confermabile senza icona. Il comando è riservato a DM/admin sulla stessa campagna e sullo stesso NPC, è ripetibile senza ulteriori spese e controlla l’identità del tentativo per non interrompere un’icona più recente da una scheda obsoleta. Risultati validi tardivi restano recuperabili.

Durante la propagazione di un deploy, il Worker può raggiungere un Durable Object ancora sulla versione precedente. `canStop` viene quindi dichiarato dal coordinatore effettivo e propagato al frontend, mai dedotto dalla sola versione del Worker. Un vecchio coordinatore che risponde `409 Operazione non disponibile.` viene riconosciuto come `503 GENERATOR_UPDATING`, senza ripetere chiamate a pagamento. L’interruzione scrive soltanto lo stato e libera il blocco: non attende R2. Per un intervento urgente usare una versione ufficiale di Wrangler che supporti `--durable-objects-code-update-mode immediate`; è una scelta per quel deploy, non una nuova impostazione permanente. Il reset delle istanze interrompe il lavoro in memoria ma conserva lo storage persistente.
