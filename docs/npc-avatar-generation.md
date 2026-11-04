# Generazione avatar NPC

Nel dossier, accanto al ritratto, e in **Modifica → Immagini e impostazioni → Avatar**, «Genera avatar» apre il confronto tra il ritratto attuale e una nuova proposta. I due pulsanti condividono stile e comportamento. Disponibile al DM della campagna e all’admin, non ai soli proprietari dei companion. Le modifiche già aperte nella scheda devono essere salvate prima di aprire il generatore.

Il servizio invia a OpenAI l’avatar corrente salvato su R2 e gli eventuali dettagli aggiuntivi. Lo stile completo richiesto è obbligatorio sul server (`AVATAR_STYLE`), con figura intera, nuova posa e immagine WebP **9:16**. La posa e la fedeltà artistica restano risultati generativi da valutare in anteprima; formato e dimensioni sono verificati prima del salvataggio. Il modello rimane `gpt-image-2.5-sunburst`, una sola immagine per richiesta.

Due selettori indipendenti permettono di scegliere **Qualità Media (`medium`) / Alta (`high`) / Extra alta (`xhigh`)** e **Risoluzione Media (864 × 1536) / Alta (1296 × 2304) / 2K (1440 × 2560)**, sempre 9:16. I valori iniziali sono Alta / Alta. Scegliendo 2K (`2k`) o qualità Extra alta (`xhigh`) compare **«Solo per NPC importanti, alto costo!»**; anche le opzioni dei selettori indicano il costo elevato. Extra alta è combinabile con tutte e tre le risoluzioni. Risoluzione e qualità vengono richieste direttamente al modello, senza ingrandire un risultato più piccolo. Le impostazioni vengono validate dal server e salvate nel lavoro: recupero dopo chiusura, riavvio e invii duplicati mantengono le scelte originali. Qualità e risoluzione più alte consumano più budget. Non è un cambio di modello. Il coordinatore attivo dichiara `supportedResolutions` e `supportedQualities`; i client precedenti continuano a usare le proprie scelte e il nuovo FE abilita le opzioni aggiuntive solo quando sono supportate dal coordinatore effettivo.

Un clic sull’immagine o su **Ingrandisci** apre il ritratto a tutta finestra. **Dimensione reale** mostra i pixel originali con scorrimento; **Adatta allo schermo** torna alla vista completa. Chiudere l’ingrandimento riporta alla proposta senza applicarla o avviare nuove generazioni.

L’avatar cambia soltanto premendo **Usa questo avatar**. Il salvataggio segue il percorso già usato dalla wiki: aggiorna il dossier e notifica wiki-sync. Statistiche, token, varianti, proprietà e visibilità rimangono invariati. Il vecchio avatar resta referenziato in `site.avatarHistory` ed escluso dalla pulizia dei media. Non è ancora presente un’interfaccia per sfogliare lo storico.

Il file su R2 usa la chiave `campaigns/…/base/avatar-ai-….webp`; il percorso salvato e restituito al sito deve invece iniziare con `media/campaigns/…`. Le prime conferme omettevano `media/`: la compatibilità in lettura corregge queste immagini su scheda, elenco e dossier (anche se lo snapshot del dossier aveva scartato l’avatar), senza riscrivere i dati KV. Gli stessi percorsi corretti vengono restituiti al lettore Foundry. Non serve rigenerare l’immagine. Una nuova conferma del vecchio lavoro può normalizzare anche il percorso salvato, senza chiamare OpenAI.

## Attivazione

1. Configurare `OPENAI_API_KEY` come **secret** del Worker `sigillo-api`, con una chiave di progetto OpenAI autorizzata alle immagini e relativa fatturazione. Non inserirla nel frontend, nel repository o in chat. Dalla directory `workers/main-worker`: `npx wrangler secret put OPENAI_API_KEY` (inserimento interattivo).
2. Pubblicare il Worker con il nuovo binding `AVATAR_GENERATOR` e la migrazione `avatar-generation-v1`, presenti in `wrangler.jsonc`: `npx wrangler deploy`.
3. Pubblicare anche frontend, script e foglio di stile aggiornati. Il frontend locale può usare il Worker pubblicato.

Senza secret o binding la generazione è disabilitata e i dati esistenti continuano a funzionare. Non serve cambiare configurazioni o dati di Foundry. Questa implementazione non esegue alcuna migrazione o cancellazione dei documenti KV esistenti.

## Spesa, recupero e conservazione

- **Non esiste un limite mensile di generazioni avatar.** Il vecchio `AVATAR_MONTHLY_LIMIT` non viene più usato, anche se ancora presente in una configurazione precedente. Il contatore mensile dei tentativi e lo storico esistenti restano conservati; non bloccano nuove richieste. L'accesso resta riservato al DM della campagna e all'admin.
- Il modello è fisso; qualità e dimensioni sono limitate alle nove combinazioni consentite dal server. Valori arbitrari vengono rifiutati prima di avviare un lavoro. Ogni nuova proposta richiesta esplicitamente può avere un costo.
- Il Durable Object coordina una generazione alla volta. Le richieste duplicate riusano il lavoro già avviato; un alarm lo esegue anche dopo la chiusura della pagina. La riapertura recupera l’ultima proposta dell’NPC.
- Dopo un’interruzione con esito incerto non si ripete automaticamente la chiamata a pagamento. Un nuovo tentativo richiede un clic esplicito e avvisa del possibile addebito precedente.
- Le proposte sono conservate su R2 sotto `_private/ai-avatars/`, inaccessibile dalla route pubblica `/media/`. La preview richiede autenticazione e permesso DM/admin. Al momento non è prevista eliminazione automatica delle proposte, per privilegiare il recupero.
- Confermare due volte la stessa proposta è innocuo. Se il ritratto è cambiato nel frattempo la proposta viene rifiutata. Il salvataggio usa anche il controllo `expectedRevision` già esistente; la consistenza delle altre scritture contemporanee resta quella del backend KV attuale, non una transazione globale tra KV e R2.
- Le reference devono essere immagini PNG/JPEG/WebP già disponibili su R2 nella campagna, massimo 12 MB. Nessun URL esterno fornito dal browser viene scaricato dal server. Per avatar ancora presenti solo come file locali di Foundry o asset statici, caricare e salvare prima l’immagine sulla wiki.

## Verifica

`npm run test:avatar-generation` copre le route reali con API immagini, KV, R2 e storage del Durable Object simulati: autorizzazione, isolamento campagne, doppio invio, stile e reference, formato, anteprima privata, conferma, assenza del limite mensile anche con vecchie configurazioni e contatori elevati, conservazione dello storico, blocco dei lavori simultanei e recupero dopo interruzione. Non usa chiavi reali o chiamate a pagamento.

Riferimenti implementativi: [Image edits API](https://developers.openai.com/api/reference/resources/images/methods/edit), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [limiti di durata](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Recupero delle attese bloccate

Ogni lavoro ha una scadenza persistita: due minuti per iniziare l’esecuzione e quindici minuti dall’inizio di ciascuna fase. Per i lavori precedenti senza scadenza si usa `createdAt + 15 minuti`. La chiamata immagini mantiene il timeout di dodici minuti. Letture e nuovi invii controllano anche il blocco globale, oltre all’alarm: un lavoro scaduto non impedisce altre generazioni e non viene ripetuto a pagamento. Il tentativo resta registrato nel contatore mensile.

Prima di dichiarare l’esito incerto si controlla se l’immagine privata era già stata salvata. Risultati validi arrivati in ritardo vengono conservati nel proprio lavoro, senza rimuovere blocchi/alarm di richieste successive. Le icone recuperate non sovrascrivono modifiche manuali alla capacità; un testo recuperato dopo la scadenza non avvia automaticamente un’ulteriore chiamata immagini.

Il browser mostra il tempo trascorso, permette di chiudere la finestra e riprende il controllo dello stato dopo un errore temporaneo. Le richieste di stato hanno un timeout di 20 secondi e il controllo automatico avviene ogni 10 secondi. Non viene mai ritentata automaticamente una generazione a pagamento. Il Worker va pubblicato per recuperare i blocchi remoti; il frontend va pubblicato per distribuire anche i nuovi comportamenti dell’interfaccia.

`npm run test:generation-recovery` verifica blocchi scaduti/precedenti/orfani, risultati già caricati, richieste ancora valide, completamenti tardivi, conservazione delle modifiche e dei blocchi successivi, senza chiamate a pagamento o modifiche ai mondi/KV.

Durante una generazione, **Interrompi attesa** libera il blocco senza avviare un altro lavoro. Il browser tenta di interrompere la richiesta al provider; questo non garantisce l’annullamento della generazione o del costo sul servizio. Il tentativo resta registrato. Le icone interrotte mantengono la capacità modificabile e confermabile senza icona. Il comando è riservato a DM/admin sulla stessa campagna e sullo stesso NPC, è ripetibile senza ulteriori spese e controlla l’identità del tentativo per non interrompere un’icona più recente da una scheda obsoleta. Risultati validi tardivi restano recuperabili.

Durante la propagazione di un deploy, il Worker può raggiungere un Durable Object ancora sulla versione precedente. `canStop` viene quindi dichiarato dal coordinatore effettivo e propagato al frontend, mai dedotto dalla sola versione del Worker. Un vecchio coordinatore che risponde `409 Operazione non disponibile.` viene riconosciuto come `503 GENERATOR_UPDATING`, senza ripetere chiamate a pagamento. L’interruzione scrive soltanto lo stato e libera il blocco: non attende R2. Per un intervento urgente usare una versione ufficiale di Wrangler che supporti `--durable-objects-code-update-mode immediate`; è una scelta per quel deploy, non una nuova impostazione permanente. Il reset delle istanze interrompe il lavoro in memoria ma conserva lo storage persistente.
