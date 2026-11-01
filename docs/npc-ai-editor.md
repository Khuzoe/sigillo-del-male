# Capacità AI nel nuovo editor · Cripta di Sangue

## Modificare una capacità esistente

In Cripta di Sangue il DM può aprire **Modifica con AI** dalla lettura della capacità o dall’editor completo. Si seleziona un Item esistente: capacità, arma, incantesimo o altro tipo importato. Non è necessario che sia stato creato dal generatore. La richiesta descrive cosa cambiare; la risposta propone modifiche mirate allo stesso Item e si rivede nello stesso editor manuale, compresi attività ed effetti. **Applica modifiche** è l’unico passaggio che accoda l’aggiornamento a Foundry.

Il nuovo contratto `npc-native-ability-edit-v1` usa `editor=npc-native-ability-edit-v1&item=ID`. Ogni capacità ha una bozza separata; creazione e client precedenti mantengono i propri canali. Il modello riceve la vista meccanica dell’NPC, la capacità selezionata, versioni effettive e modelli nativi di attività/effetti. Restituisce percorsi `set`/`delete` con valori JSON, motivazione, ipotesi ed eventuali parti non supportate. L’output massimo è 10.000 token per la modifica; modello, quote e assenza di tentativi automatici rimangono quelli esistenti.

Il compilatore conserva identificativi, impostazioni non coinvolte, flag sconosciuti e automazioni esistenti. Per nuovi effetti e attività accetta alias, assegna ID Foundry validi sul server e aggiorna insieme riferimenti delle attività, seguiti Midi e preset. Gli ID esistenti restano invariati; duplicati e riferimenti ambigui vengono rifiutati. Il valore Midi `none` indica correttamente l’assenza di un seguito. Macro, codice, ownership, metadati e probabilità riservate non vengono inviati al modello; non possono essere generati o modificati dall’AI. Gli effetti con codice restano nel documento originale. La vista della bozza mostra i campi cambiati e un confronto prima/dopo. Salvataggio della bozza e modifiche manuali non chiamano il provider. L’icona rimane facoltativa; la conferma passa a Foundry un URL assoluto dell’immagine.

Le modifiche possono riguardare descrizione, attacco, danni, TS, distanza, bersagli/aree, risorse, utilizzi, durata, attività native, collegamenti ed effetti. Gli ActiveEffect aggiunti/modificati usano il formato v14: `system.changes` con `type` e `phase`. Identità e riferimenti vengono verificati. Una richiesta non rappresentabile dai dati e dalle automazioni disponibili viene indicata in `unsupported` e blocca la conferma: descriverla nel testo non equivale ad automatizzarla.

**Cura da un tipo di danno:** Wiki Sync 0.11.17 e Khuzoe Automations 0.28.5 dichiarano nello snapshot `nativeAbilityEdit: 1` e, se disponibile, `npcRulesHealingTypes: 1`. Il preset può usare `healingTypes: ["necrotic"]`. La cura al 50%/100% usa soltanto quei danni effettivi, dopo resistenze, immunità e riduzioni; non divide l’attacco né cambia i critici. Lista assente o vuota conserva il comportamento precedente, su tutti i danni. Senza un dettaglio per tipo non si stima la cura dalla perdita totale di PF. Il nuovo filtro è disponibile anche nell’editor manuale e nella lettura delle regole.

La conferma accoda un `item.update` con `nativeEditorVersion: 1`, usando il normale editor D1 e l’ID stabile della richiesta. Il commit della coda precede lo stato accettato della bozza; ripetere la conferma recupera lo stesso comando. Una modifica pendente sullo stesso Item blocca una nuova generazione prima di prenotare una chiamata AI. Le modifiche concorrenti ai campi interessati diventano conflitti, mentre PF e utilizzi già consumati non vengono reimpostati dall’AI. Se la scheda è cambiata, la bozza resta conservata; **Nuova richiesta** riparte dalla scheda attuale.

Wiki Sync convalida in memoria, applica attività/effetti con le API v14 e verifica i valori salvati. Gli effetti generati dai preset non causano falsi conflitti al secondo invio. Se l’aggiornamento fallisce, ripristina i campi toccati; attività, effetti e riferimenti vengono ripristinati insieme. Non crea un nuovo NPC o un nuovo Item per modificare la capacità.

L’installazione locale dei due moduli è aggiornata; serve ricaricare Foundry per caricare il codice e inviare le nuove capacità dello snapshot. Le patch corrispondenti sono in `integrations/cripta-wiki-sync/npc-ai-ability-edit-0.11.17.patch` e `integrations/khuzoe-automations/npc-typed-healing-0.28.5.patch`. Nessun dato di mondo viene cambiato durante installazione o test. Le altre campagne e i dati KV originali mantengono il percorso precedente.

Verifica: `npm run test:npc-ai-ability-edit` copre compilatore, riservatezza, modifiche di Item di più tipi, effetti e macro preesistenti, conflitti, vere route Worker/D1 temporaneo, conferme duplicate, recupero, icona e API Wiki Sync installate. I servizi AI sono simulati; non vengono eseguite generazioni a pagamento o scritture nei mondi. Il browser locale è stato verificato per modifica, salvataggio, ripristino della bozza, aggiunta/rimozione di effetti e conferma.

Cripta usa il JSON nativo conservato in D1 per costruire il contesto della nuova generazione. Le altre campagne, gli NPC senza snapshot e le bozze precedenti mantengono il generatore originale. Una richiesta del browser non può abilitare il percorso nativo in un’altra campagna.

Il FE aggiornato dichiara esplicitamente `editor=npc-native-ability-v1`. La sua ultima bozza è separata da quella del client precedente, che continua a ricevere il formato originale anche in Cripta. Quando non esiste ancora una nuova bozza, il nuovo FE può riaprire quella precedente nel suo editor originale; le relative modifiche e revisioni mantengono il vecchio contratto. Eventuali lavori nativi creati durante il primo aggiornamento vengono recuperati nel nuovo canale, conservando bozza e identificativo senza generare di nuovo.

Il JSON completo rimane l’archivio originale. Il Worker ricava una vista delle meccaniche: caratteristiche, difese, risorse, capacità, attività ed effetti, con i valori derivati già disponibili. Include le versioni effettive di Foundry, D&D5e, Wiki Sync, Midi-QOL e Khuzoe Automations. Esclude ownership, dossier, biografia, flag arbitrari, macro e probabilità riservate. I PF attuali/temporanei e gli utilizzi consumati non sono usati per bilanciare la proposta. Il limite di contesto resta 80.000 byte UTF-8; non si troncano capacità per farle entrare.

## Come nasce la capacità

Il modello testo e le quote restano quelli esistenti. Riceve anche il contratto `npc-native-ability-v1`: da una a otto attività, ciascuna con attivazione, bersagli, distanza, danni e regole pertinenti. La risposta usa uno schema JSON rigoroso mediante [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Lo schema controlla la forma; il codice condiviso controlla valori, collegamenti e meccaniche. Le versioni forniscono contesto, non sostituiscono questi controlli.

Il compilatore assegna gli identificativi e costruisce un Item `feat` con attività native. I dadi semplici usano numero, facce e bonus nativi, così il nuovo editor li mostra direttamente. Sono previsti attacchi con armi o incantesimi, TS, più componenti di danno, cure dirette o PF temporanei, aree semplici, condizioni e cura al 50%/100% dei danni della specifica attività. L’attacco può attivare un seguito sui bersagli colpiti senza una seconda azione/utilizzo o un secondo critico. Le richieste non rappresentabili restano in `unsupported` e bloccano la conferma.

La proposta si modifica con lo stesso `mountNpcSheetEditor` della scheda, in modalità bozza. Non c’è un secondo insieme di campi per le meccaniche AI. Nome, descrizione, attività, TS, danni, recupero e preset sono modificabili prima di aggiungere l’elemento. L’editor della proposta esclude i campi dei moduli e le probabilità riservate. Salvataggio e riapertura della bozza non chiamano il provider. Le bozze precedenti conservano interfaccia e validazione originali.

Il nuovo massimo di output è 8.000 token per questo solo contratto; il percorso originale resta a 6.000. Nessun tentativo a pagamento viene ripetuto automaticamente. La generazione dell’icona resta facoltativa, con modello/qualità/formato già configurati. Un errore dell’immagine non elimina la capacità pronta.

## Conferma e sincronizzazione

- Solo la conferma accoda `item.create` con `nativeAbilityVersion: 1`, campagna e mondo espliciti. Il trasferimento stabile evita doppioni. Il generatore viene segnato come accettato dopo il commit della coda D1.
- Prima della conferma si confronta il contesto meccanico corrente. Modifiche a GS, capacità, difese o versioni possono richiedere una revisione. Un cambiamento ai soli PF attuali non invalida la proposta.
- Wiki Sync convalida il documento con il modello Item installato, in memoria, prima della scrittura. Compila i preset e controlla il risultato della creazione. Un rifiuto o una normalizzazione che perde valori non viene segnata come successo.
- Se fallisce la verifica, si rimuove soltanto l’Item appena creato da quel comando; elementi precedenti e statistiche dell’Actor restano intatti. Se il trasferimento esiste già, si verifica quella copia e non se ne crea un’altra. Eventuali divergenze diventano conflitti visibili.
- La sincronizzazione successiva aggiorna la scheda e lo snapshot. Il generatore non sostituisce direttamente né il JSON sorgente, né i dossier, né gli altri oggetti dell’NPC.

## Attivazione e preservazione

Worker pubblicato il 31 ottobre 2026, versione `250a5ad7-247d-4ace-9f3b-d0934209feda`. Wiki Sync 0.11.16 è installato nella cartella Foundry DEV TEST; occorre ricaricare il client GM per caricare il codice e aggiornare le dichiarazioni degli snapshot. Il FE è aggiornato nel workspace locale, senza commit o pubblicazione GitHub Pages.

Serve Wiki Sync **0.11.16**, che dichiara `snapshot.versions.nativeAbilityCreate = 1`. La raccolta iniziale aggiorna automaticamente gli snapshot di Cripta che non dichiarano questa capacità. Gli altri mondi seguono la sincronizzazione precedente. Il Worker controlla anche che il coordinatore effettivo dichiari `nativeAbilityEditor: 1`, prima di prenotare una generazione: una distribuzione in corso non può far usare il vecchio contratto a un nuovo lavoro.

Non servono nuove tabelle o migrazioni. Si usano il D1 e la coda già attivi per Cripta; le bozze rimangono nel Durable Object esistente. Nessun dato KV originale viene scritto, cancellato o usato come ripiego per il percorso pilota. Le altre campagne non cambiano archivio.

Il confronto remoto prima/dopo questa pubblicazione ha verificato **256 documenti** con prefisso `campaign:cripta-di-sangue:managed`, inclusi valori, metadati e scadenze: hash e contenuto risultano identici. Identiche anche le quattro risposte pubbliche dell’indice NPC confrontate. Report in `output/npc-ai-editor-qa/kv-before.json` e `kv-after.json`; gli artefatti restano ignorati da Git.

La patch `integrations/cripta-wiki-sync/npc-ai-editor-0.11.16.patch` si applica alla versione 0.11.15. I file condivisi vanno copiati insieme alla patch; il validatore installato deve essere identico a `assets/js/shared/npc-native-ability.mjs`.

## Verifica

`npm run test:npc-ai-editor` esegue il compilatore, la convalida, il contesto filtrato, il servizio Wiki Sync installato e le vere route del Worker con D1 temporaneo e provider simulato. Copre modifiche manuali, attacco con incantesimo, seguito/TS/cura separata, dati riservati, conflitti, richieste duplicate, coordinatore precedente, ripristino e conservazione byte per byte dei dati KV del test. Le altre suite coprono generatore precedente, editor, snapshot, runtime delle cure e recupero delle attese. Nessuna prova effettua chiamate AI a pagamento o modifica un mondo.

Il bilanciamento rimane una proposta del modello: il collaudo tecnico non certifica il GS. Un tiro reale nel mondo, dopo il caricamento del modulo aggiornato, resta il controllo finale delle integrazioni installate.

## Proposte rifiutate e recupero

Dal compilatore di modifica versione 2, una proposta AI rifiutata viene conservata privatamente nel coordinatore quando rientra nei limiti di memoria, insieme alla sorgente e all’eventuale bozza precedente. Non viene inviata al browser, accodata o applicata. Un aggiornamento del compilatore può rivalidarla alla riapertura, usando lo stesso lavoro e senza nuove chiamate al provider o prenotazioni di quota. Gli effetti con codice e i dati riservati rimangono protetti. Un’icona non parte automaticamente durante il recupero. I tentativi falliti prima di questo aggiornamento non contengono la risposta rifiutata e richiedono una nuova generazione esplicita.
