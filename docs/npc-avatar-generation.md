# Generazione avatar NPC

Nel dossier, accanto al ritratto, e in **Modifica → Immagini e impostazioni → Avatar**, «Genera avatar» apre il confronto tra il ritratto attuale e una nuova proposta. I due pulsanti condividono stile e comportamento. Disponibile al DM della campagna e all’admin, non ai soli proprietari dei companion. Le modifiche già aperte nella scheda devono essere salvate prima di aprire il generatore.

Il servizio invia a OpenAI l’avatar corrente salvato su R2 e gli eventuali dettagli aggiuntivi. Lo stile completo richiesto è obbligatorio sul server (`AVATAR_STYLE`), con figura intera, nuova posa e immagine WebP **9:16**. La posa e la fedeltà artistica restano risultati generativi da valutare in anteprima; formato e dimensioni sono verificati prima del salvataggio. Il modello rimane `gpt-image-2.5-sunburst`, una sola immagine per richiesta.

Due selettori indipendenti permettono di scegliere **Qualità Media (`medium`) / Alta (`high`)** e **Risoluzione Media (864 × 1536) / Alta (1296 × 2304)**. I valori iniziali sono Alta / Alta. Le impostazioni vengono validate dal server e salvate nel lavoro: recupero dopo chiusura, riavvio e invii duplicati mantengono le scelte originali. Qualità e risoluzione più alte consumano più budget. Non è un cambio di modello.

Un clic sull’immagine o su **Ingrandisci** apre il ritratto a tutta finestra. **Dimensione reale** mostra i pixel originali con scorrimento; **Adatta allo schermo** torna alla vista completa. Chiudere l’ingrandimento riporta alla proposta senza applicarla o avviare nuove generazioni.

L’avatar cambia soltanto premendo **Usa questo avatar**. Il salvataggio segue il percorso già usato dalla wiki: aggiorna il dossier e notifica wiki-sync. Statistiche, token, varianti, proprietà e visibilità rimangono invariati. Il vecchio avatar resta referenziato in `site.avatarHistory` ed escluso dalla pulizia dei media. Non è ancora presente un’interfaccia per sfogliare lo storico.

Il file su R2 usa la chiave `campaigns/…/base/avatar-ai-….webp`; il percorso salvato e restituito al sito deve invece iniziare con `media/campaigns/…`. Le prime conferme omettevano `media/`: la compatibilità in lettura corregge queste immagini su scheda, elenco e dossier (anche se lo snapshot del dossier aveva scartato l’avatar), senza riscrivere i dati KV. Gli stessi percorsi corretti vengono restituiti al lettore Foundry. Non serve rigenerare l’immagine. Una nuova conferma del vecchio lavoro può normalizzare anche il percorso salvato, senza chiamare OpenAI.

## Attivazione

1. Configurare `OPENAI_API_KEY` come **secret** del Worker `sigillo-api`, con una chiave di progetto OpenAI autorizzata alle immagini e relativa fatturazione. Non inserirla nel frontend, nel repository o in chat. Dalla directory `workers/main-worker`: `npx wrangler secret put OPENAI_API_KEY` (inserimento interattivo).
2. Pubblicare il Worker con il nuovo binding `AVATAR_GENERATOR` e la migrazione `avatar-generation-v1`, presenti in `wrangler.jsonc`: `npx wrangler deploy`.
3. Pubblicare anche frontend, script e foglio di stile aggiornati. Il frontend locale può usare il Worker pubblicato.

Senza secret o binding la generazione è disabilitata e i dati esistenti continuano a funzionare. Non serve cambiare configurazioni o dati di Foundry. Questa implementazione non esegue alcuna migrazione o cancellazione dei documenti KV esistenti.

## Spesa, recupero e conservazione

- `AVATAR_MONTHLY_LIMIT`, inizialmente **20**, limita le richieste complessive di tutte le campagne per mese UTC. Impostare `0` per bloccare nuove richieste. È un limite di tentativi, **non un tetto monetario**; anche i tentativi falliti prenotano una quota, conservativamente.
- Il modello è fisso; qualità e dimensioni sono limitate alle quattro combinazioni consentite dal server. Valori arbitrari vengono rifiutati prima di prenotare quota. Ogni nuova proposta richiesta esplicitamente può avere un costo.
- Il Durable Object coordina una generazione alla volta. Le richieste duplicate riusano il lavoro già avviato; un alarm lo esegue anche dopo la chiusura della pagina. La riapertura recupera l’ultima proposta dell’NPC.
- Dopo un’interruzione con esito incerto non si ripete automaticamente la chiamata a pagamento. Un nuovo tentativo richiede un clic esplicito e avvisa del possibile addebito precedente.
- Le proposte sono conservate su R2 sotto `_private/ai-avatars/`, inaccessibile dalla route pubblica `/media/`. La preview richiede autenticazione e permesso DM/admin. Al momento non è prevista eliminazione automatica delle proposte, per privilegiare il recupero. Il limite mensile ne contiene la crescita.
- Confermare due volte la stessa proposta è innocuo. Se il ritratto è cambiato nel frattempo la proposta viene rifiutata. Il salvataggio usa anche il controllo `expectedRevision` già esistente; la consistenza delle altre scritture contemporanee resta quella del backend KV attuale, non una transazione globale tra KV e R2.
- Le reference devono essere immagini PNG/JPEG/WebP già disponibili su R2 nella campagna, massimo 12 MB. Nessun URL esterno fornito dal browser viene scaricato dal server. Per avatar ancora presenti solo come file locali di Foundry o asset statici, caricare e salvare prima l’immagine sulla wiki.

## Verifica

`npm run test:avatar-generation` copre le route reali con API immagini, KV, R2 e storage del Durable Object simulati: autorizzazione, isolamento campagne, doppio invio, stile e reference, formato, anteprima privata, conferma, quota e recupero dopo interruzione. Non usa chiavi reali o chiamate a pagamento.

Riferimenti implementativi: [Image edits API](https://developers.openai.com/api/reference/resources/images/methods/edit), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [limiti di durata](https://developers.cloudflare.com/durable-objects/platform/limits/).
