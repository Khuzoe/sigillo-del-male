# Editor NPC e sincronizzazione delle statistiche

Intervento del 17 settembre 2026. Il frontend usa il contratto attuale di wiki-sync; nessuna automazione viene ricavata automaticamente dalla descrizione.

## Comportamento

- Le capacità distinguono le regole configurate nelle attività dal testo dell'abilità. Gli effetti referenziati ma non esportati sono indicati come incompleti, senza attribuire loro condizioni o durate presunte.
- L'editor delle attività espone portata, area, bersagli, durata e consumi, distinguendo i valori ereditati dall'elemento dai valori propri dell'attività. Sono disponibili la formula delle attività di cura già esistenti e la soglia di ricarica degli utilizzi. La cura proporzionale ai danni resta una regola descrittiva quando il payload la contiene soltanto nel testo.
- Il costo leggendario e il consumo della risorsa sono separati; le incongruenze ricevute sono segnalate. L'anteprima di danni e CD si aggiorna con la bozza. I campi avanzati non modificati vengono conservati.
- **Salva scheda** include le modifiche agli elementi e agli effetti esistenti, oltre alle statistiche e al dossier. Le nuove creazioni restano azioni esplicite. Il salvataggio di più elementi non è una transazione: un errore lascia le altre bozze disponibili e segnala l'esito parziale.
- Le basi di confronto appartengono ai campi visualizzati, non all'ultimo aggiornamento in background. Un cambio di revisione conserva la bozza e aggiorna soltanto la revisione della richiesta; i conflitti sui valori restano controllati da Foundry.
- La navigazione protegge le modifiche non inviate. Il controllo della coda segue tutte le operazioni e continua con intervalli crescenti fino a 30 secondi finché la pagina è aperta.
- L'assenza di comandi è descritta come **Nessuna modifica in coda**, senza dedurre che il client GM sia collegato. Foundry deve essere aperto con un GM attivo e una modalità di sincronizzazione che consenta la ricezione.

## Interfaccia NPC

I testi della scheda evitano note sulla provenienza dei dati, sui calcoli di Foundry e sulle revisioni tecniche. Restano gli stati di salvataggio, gli errori, i conflitti e le indicazioni necessarie per interpretare o modificare i valori. I campi derivati conservano il comportamento di sola lettura anche senza la nota esplicativa.

La scheda NPC si apre sulle statistiche, con navigazione in Statistiche, Capacità, Inventario, Effetti e Dossier (le sezioni senza contenuti vengono omesse). Le schede dei personaggi giocanti mantengono la navigazione precedente. Tutti i pulsanti delle sezioni rimangono visibili. Il dossier pubblico senza statistiche condivide la stessa composizione della scheda completa.

L'inventario assegna a immagine e colonna della griglia la stessa dimensione, evitando la sovrapposizione causata dai precedenti stili generici delle capacità. Nome e stato rimangono accanto all'immagine, dettagli ed editor occupano la larghezza della scheda. Le icone di riserva usano simboli disponibili nel pacchetto Font Awesome Free caricato dalla pagina. Portamonete, riepiloghi, filtri, dossier, visibilità e blocchi narrativi usano spaziature e dimensioni coerenti, con campi che si adattano allo spazio effettivo.

L'editor di ciascun elemento separa Meccaniche, Descrizione e Avanzato. Il nome resta sempre visibile; quantità, equipaggiamento, sintonia e utilizzi sono nelle Meccaniche. Proprietà, portata, bersagli e durata si aprono quando servono. Immagini, varianti e Link Actor Data sono nelle impostazioni del dossier. I pannelli conservano gli stessi controlli nel DOM: cambiare sezione non cancella le bozze e Salva scheda include anche le sezioni non visibili. Un campo non valido riapre la sezione e l'editor da correggere. Le schede supportano frecce, Home/End e collegamenti alle sezioni.

Verificati nel browser: lettura desktop/mobile, assenza di scorrimento orizzontale della pagina, conservazione delle bozze tra sezioni, invio combinato di Forza e capacità, errori numerici e JSON nelle sezioni nascoste, navigazione da tastiera. Il servizio della prova è simulato e non modifica Foundry.

La seconda revisione visiva include immagini locali effettivamente caricate, dossier con testo e blocchi modificabili, portamonete, armi e consumabili con nomi lunghi, icone di riserva, effetti e media idle/hover. Controllati tutti i pannelli a 320 px: nessuna eccedenza orizzontale e nessuna sovrapposizione tra immagine e titolo nell'inventario. Verificati anche il dossier pubblico senza editor, l'assenza di avatar, il mantenimento del layout giocatori e l'ingrandimento del ritratto dopo il suo spostamento nel dossier. Il salvataggio simulato di Forza 29 e del nome di un oggetto produce soltanto i due comandi attesi con i rispettivi valori di base.

Le schede delle capacità NPC mostrano direttamente il testo e mantengono danni, CD e portata in evidenza. I testi lunghi hanno un'anteprima espandibile con “Leggi tutto”. Il pannello “Dettagli di gioco” raccoglie attività, consumi, cure ed effetti collegati; se esiste soltanto un dato, questo viene mostrato direttamente. Le informazioni assenti non generano righe vuote. La descrizione resta distinta dalle meccaniche effettivamente esportate. Verificati lettura desktop/mobile, apertura del testo da tastiera e conservazione del nome modificato passando alla descrizione nell'editor; nessun invio reale.

La revisione del 18 settembre dispone le capacità NPC in righe a tutta larghezza: titolo e attivazione in testa, descrizione a sinistra e valori di gioco a destra. Sotto i 640 px disponibili nella scheda le colonne si dispongono una sotto l'altra; aprire la modifica sostituisce la lettura con l'editor e il comando diventa “Chiudi modifica”. Ricerca, filtri e risorse leggendarie hanno una disposizione più compatta. Verificati nel browser desktop, 390 e 320 px, effetti collegati e salvataggio simulato dopo cambio della scheda di modifica: un solo comando item.update per il nome cambiato, senza altre patch.

La revisione del dossier del 19 settembre usa una composizione editoriale dedicata (`managed-npc-dossier.css`). Il ritratto verticale ha i dati anagrafici sotto di sé; nome, ruolo, citazione e racconto iniziano accanto. Il flusso permette ai capitoli di usare anche lo spazio rimasto accanto a un'introduzione breve, poi recuperare tutta la larghezza. Un avatar orizzontale riceve una colonna più larga; senza avatar rimane una sola colonna. Su telefono il ritratto affianca l'identità, poi dati e racconto occupano tutta la larghezza. Il ritratto vivo è integrato nell'identità sia nella vista pubblica sia nella scheda completa. Pulsante, contenitore e livelli idle/hover condividono dimensioni e centro; tornando alle statistiche il controllo rientra nella testata originale.

L'indice riporta esclusivamente i titoli già presenti nel contenuto autorizzato, con collegamenti ai capitoli e trasferimento del focus; su mobile si apre a richiesta e si richiude alla selezione. I titoli dei capitoli hanno livello 2 sotto il nome del personaggio. Il titolo ripetuto “Storia e informazioni” non compare in lettura. Il collegamento alla versione precedente resta disponibile quando previsto.

Le illustrazioni dei capitoli condividono una larghezza standard di 340 px, quella adottata per le immagini quadrate. Il rapporto d'aspetto e la lunghezza del testo non cambiano più la larghezza: varia soltanto l'altezza naturale dell'immagine. I bordi delle immagini sono allineati anche tra introduzione e capitoli successivi. Nei contenitori più stretti la larghezza si riduce uniformemente per conservare spazio alla prosa (360 px nei blocchi ampi, 240 px nei blocchi intermedi, 180 px su mobile, oltre alla distanza dall'immagine). Conservati proporzioni, ingrandimento, animazione, fallback e visibilità. L'impaginazione sposta gli elementi già renderizzati, senza modificare testi, immagini o dati salvati. Gli observer sono rimossi al successivo rendering. L'editor mantiene i propri campi montati e le bozze durante i cambi di sezione.

Verificati il dossier reale di Deborah Von T su desktop, 390 e 320 px, indice da tastiera e ingrandimento delle illustrazioni; nel servizio locale simulato, avatar orizzontale e conservazione dei dati modificati nel dossier passando alle statistiche e tornando indietro. La suite managed actors mantiene i controlli di sicurezza, 28 verifiche dell'editor e 30 del percorso di sincronizzazione.

La modalità Modifica del dossier NPC raccoglie identità e dati accanto al ritratto; organizzazione e visibilità si aprono a richiesta. I capitoli occupano tutta la larghezza, con testo e anteprima dell'immagine affiancati su desktop e disposti in verticale su telefono. Duplicazione, spostamento ed eliminazione sono raccolti nel menu Azioni; formato e icona hanno un pannello dedicato. Ogni tipo di capitolo può gestire un'immagine, comprese quelle già presenti nei blocchi di testo. La sostituzione di un file conserva i campi ancora da salvare e la rimozione azzera anche l'eventuale immagine di riserva dei banner.

Verificati nel servizio locale simulato: duplicazione e riordino, rimozione e sostituzione delle immagini, anteprima di un file locale, mantenimento di ruolo, citazione, altezza e testo passando tra sezioni, salvataggio del dossier con immagini e capitolo riservato preservati. Controllata la disposizione a 390 e 320 px senza eccedenze orizzontali. Nessuna scrittura verso il servizio reale.

Nell'elenco NPC il comando Discord è sostituito, per i DM autorizzati, dal flag **Dossier · Tutti / Solo DM**. Il cambio salva immediatamente una patch contenente soltanto `visibility`, usando la revisione del profilo visualizzato. Le statistiche, i contenuti e la visibilità dei singoli capitoli non cambiano. Durante il salvataggio il flag evita invii ripetuti; un errore mantiene lo stato precedente e un conflitto richiede di ricaricare l'elenco. Gli NPC ancora in creazione e le schede legacy senza profilo gestito non espongono il controllo.

Verificati clic, tastiera, errore di revisione, vista senza permessi e disposizione mobile a 320 px. `test:npc-visibility`, incluso in `test:managed-actors`, esercita le funzioni FE e il Worker reale con dati in memoria: cambio pubblico/DM, conservazione dei contenuti e delle statistiche, filtro dei capitoli riservati e rifiuto delle scritture non autorizzate.

## Garanzie lato Worker e Foundry



Il Worker rifiuta richieste con campi non validi, senza accettarle parzialmente in silenzio. Una modifica a un comando ancora in coda riceve una nuova identità: un ACK del precedente comando non può cancellarla. Le modifiche a parti distinte dello stesso oggetto attività vengono composte preservando entrambe le intenzioni. In caso di applicazione concorrente, un conflitto esplicito può richiedere una nuova conferma dei valori.

Wiki-sync verifica i campi dell'Actor dopo l'aggiornamento. I campi ignorati o ricalcolati vengono segnalati come falliti. Un campo controllato da un effetto attivo viene rifiutato prima della scrittura, perché il valore effettivo esportato non identifica il suo valore di base. Il bonus di competenza viene mostrato come derivato. La conferma di applicazione segue la pubblicazione dello snapshot aggiornato; gli errori di validazione sono restituiti al sito.

## Verifiche

`npm run test:managed-actors` esegue la suite di sicurezza esistente, i test delle bozze e del salvataggio del frontend, e quelli del percorso Worker–modulo–rilettura. Il test del modulo accetta anche il percorso del file installato come argomento. Le API e i documenti sono simulati: nessun Actor della campagna viene modificato.

La verifica nel browser usa il codice frontend reale con il payload di Plexus e un servizio locale simulato. Copre la lettura degli effetti non esportati, l'editor di consumi/area, salvataggio combinato dopo una modifica remota, protezione delle bozze e disposizione su schermi piccoli.

## Distribuzione

FE e Worker sono modificati nel repository. Il modulo di test installato è aggiornato a **0.10.8** e richiede il ricaricamento del client GM. Il pacchetto `dist/cripta-wiki-sync-0.10.8.zip` è preparato dalla versione installata 0.10.7 con le correzioni di questo intervento, conservando le sue funzionalità aggiuntive.

La cartella `module/` è ignorata da Git ed è una sorgente 0.9.6 differente; contiene la stessa correzione del servizio per consentire i test del repository, ma non va usata per ricreare la distribuzione 0.10.8. La patch del servizio è conservata in `docs/patches/wiki-sync-0.10.8.patch` per revisione. Il precedente `dist/cripta-wiki-sync.zip`, già modificato prima di questo lavoro, è conservato.

Per attivare tutto sul sito pubblico servono la pubblicazione degli asset FE, il deploy del Worker e la distribuzione del pacchetto aggiornato con il relativo manifest di release. Nessun deploy remoto o modifica dei dati del mondo è stato eseguito qui. La verifica completa in una sessione Foundry connessa al Worker pubblicato resta il controllo finale della release.
