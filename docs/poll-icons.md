# Icone dei sondaggi

L’admin globale può aprire **Personalizza icone** dalla barra del sondaggio, nella home, nella pagina sessioni o nel sondaggio a pagina intera. Il pannello include il DM e i partecipanti attivi della campagna.

Ogni partecipante ha tre immagini indipendenti: Sì, Forse e No. Le basi comuni in `assets/img/ui/poll-templates/` mantengono dimensioni, scritte e allineamenti identici. Le immagini già presenti vengono sovrapposte nello spazio superiore; eventuali scritte o sfondi nell’originale rimangono parte dell’immagine.

Le basi `*-v2.webp` usano sfondi verdi, ambrati e rossi più luminosi. Un’immagine finale già salvata conserva i colori con cui era stata composta: per aggiornarla, aprire il partecipante, premere **Prepara le 3 icone**, quindi **Salva icone**. Le regolazioni e gli originali restano conservati.

Il selettore **Partecipante** mostra le tre anteprime affiancate su desktop e in colonna su mobile. Si può trascinare il ritratto nell’anteprima oppure regolare **Orizzontale (X)** e **Verticale (Y)** da −100% a +100%, e **Zoom** dal 20% al 300%, con cursori o valori numerici. Gli spostamenti sono relativi allo spazio del ritratto; il contenuto resta confinato sopra la fascia della risposta. **Centra** azzera X/Y e riporta lo zoom al 100%. Cambiare partecipante conserva le bozze.

**Prepara le 3 icone** include nel prossimo salvataggio tutte le risposte del partecipante selezionato, anche senza modificare l’inquadratura. **Cambia immagine** accetta PNG, JPEG e WebP fino a 5 MB; `CriptaMedia` converte l’originale in WebP quando necessario. **Salva icone** crea immagini finali WebP quadrate da 1254 px, mantenendo separatamente originale e regolazioni per le modifiche future. Una riapertura usa sempre l’originale, senza aggiungere un’altra cornice all’immagine finale. **Ripristina**, seguito da **Salva icone**, rimuove la personalizzazione e riprende l’immagine dei dati statici sulla base comune.

È possibile trascinare un file dal computer sulla casella desiderata: la destinazione viene evidenziata durante il trascinamento. Ogni casella accetta un’immagine alla volta, con gli stessi controlli del pulsante **Carica**. Rilasciare un file fuori dalle caselle non cambia le icone e non apre il file al posto del sito. Durante il salvataggio il trascinamento è disabilitato.

## Persistenza e accesso

- `GET /api/poll-icons?campaign=<id>` restituisce `{ campaignId, voteIcons, compositions, compositionVersion: 1, version, updatedAt }`. `voteIcons` contiene i percorsi delle immagini finali; `compositions[playerId][state]` conserva `{ version: 1, sourcePath, x, y, scale }`.
- `POST /api/poll-icons?campaign=<id>` richiede l’admin globale e un corpo `{ campaignId, version, changes: [{ playerId, state, path, composition }] }`. `path: null` ripristina una singola risposta e rimuove anche i metadati. Una versione obsoleta restituisce 409. Per compatibilità, una sostituzione senza `composition` resta valida e rimuove eventuali metadati precedenti.
- `composition.sourcePath` è il percorso dell’originale nella stessa cartella `poll-icons` della campagna, diverso dal file finale; `null` indica l’immagine predefinita del sito. Il worker valida versione, campi consentiti e intervalli numerici, e verifica in R2 sia l’originale sia il risultato prima di modificare la configurazione.
- Il documento è salvato in KV alla chiave `campaign:<id>:poll-icons`, separata dai sondaggi. Creare o modificare un sondaggio non modifica questa configurazione.
- Gli upload usano `/media/upload` con la cartella `poll-icons`, riservata all’admin. Ogni file riceve un nome univoco. Il salvataggio verifica che tutte le immagini esistano in R2 e appartengano alla stessa campagna.
- I file precedenti non vengono eliminati al ripristino; un upload riuscito seguito da annullamento o errore del salvataggio può lasciare un file non associato.

Le risposte esistenti di lettura e salvataggio sessione includono `voteIconOverrides`, `voteIconCompositions` e `voteIconsVersion`. Il frontend mostra direttamente i risultati già composti; immagini predefinite e personalizzazioni precedenti prive di metadati vengono sovrapposte alla base durante la visualizzazione, senza una migrazione dei file. Anche i suggerimenti semitrasparenti usano le icone risultanti. Non viene aggiunta una GET dedicata alle icone durante la normale consultazione: il worker legge il documento KV insieme ai dati della sessione. Il pannello admin rilegge la configurazione quando viene aperto.

Il rendering dell’anteprima e quello del file finale condividono area del ritratto e coordinate in `poll-icon-composer.js`. Gli originali remoti devono consentire l’accesso CORS per la composizione su canvas; se non sono leggibili, il salvataggio invita a ricaricare il file dal computer. Un errore conserva le bozze; un nuovo tentativo riutilizza gli upload riusciti finché la relativa immagine non viene modificata.

La cache dei sondaggi resta di due minuti. Dopo un salvataggio viene invalidata la configurazione della campagna nella scheda corrente e la tabella si aggiorna immediatamente; altre schede recepiscono le modifiche alla successiva lettura dopo la scadenza della propria cache.

## Verifica e rilascio

Eseguire `npm run test:poll`, `npm run test:auth` e `npm run check:all`. I test coprono permessi admin/DM/giocatore, upload, isolamento tra campagne, percorsi non validi, immagini mancanti, versioni obsolete, nuovi sondaggi, ripristino, persistenza delle regolazioni, immagini finali senza doppia cornice, geometria di immagini verticali/orizzontali, protezione della fascia di testo e recupero dopo un errore di caricamento.

Pubblicare prima il worker aggiornato e poi i file del sito, incluse le tre basi WebP. L’editor richiede `compositionVersion: 1` prima di consentire modifiche, per evitare che un worker precedente perda il riferimento all’originale. Non sono richiesti nuovi secret, bucket o namespace KV; le configurazioni vengono create al primo salvataggio.
