# Icone dei sondaggi

L’admin globale può aprire **Personalizza icone** dalla barra del sondaggio, nella home, nella pagina sessioni o nel sondaggio a pagina intera. Il pannello include il DM e i partecipanti attivi della campagna.

Ogni partecipante ha tre immagini indipendenti: Sì, Forse e No. Il caricamento accetta PNG, JPEG e WebP fino a 5 MB; `CriptaMedia` converte in WebP quando necessario. L’anteprima usa lo stesso ritaglio quadrato delle caselle. Le modifiche diventano pubbliche solo premendo **Salva icone**. **Ripristina**, seguito da **Salva icone**, rimuove la personalizzazione e riprende l’icona definita nei dati statici del sito.

È possibile trascinare un file dal computer sulla casella desiderata: la destinazione viene evidenziata durante il trascinamento. Ogni casella accetta un’immagine alla volta, con gli stessi controlli del pulsante **Carica**. Rilasciare un file fuori dalle caselle non cambia le icone e non apre il file al posto del sito. Durante il salvataggio il trascinamento è disabilitato.

## Persistenza e accesso

- `GET /api/poll-icons?campaign=<id>` restituisce `{ campaignId, voteIcons, version, updatedAt }`.
- `POST /api/poll-icons?campaign=<id>` richiede l’admin globale e un corpo `{ campaignId, version, changes: [{ playerId, state, path }] }`. `path: null` ripristina una singola risposta. Una versione obsoleta restituisce 409.
- Il documento è salvato in KV alla chiave `campaign:<id>:poll-icons`, separata dai sondaggi. Creare o modificare un sondaggio non modifica questa configurazione.
- Gli upload usano `/media/upload` con la cartella `poll-icons`, riservata all’admin. Ogni file riceve un nome univoco. Il salvataggio verifica che tutte le immagini esistano in R2 e appartengano alla stessa campagna.
- I file precedenti non vengono eliminati al ripristino; un upload riuscito seguito da annullamento o errore del salvataggio può lasciare un file non associato.

Le risposte esistenti di lettura e salvataggio sessione includono `voteIconOverrides` e `voteIconsVersion`. Il frontend sovrappone solo le risposte personalizzate alle icone locali, preservando le altre. Anche i suggerimenti semitrasparenti usano le icone risultanti. Non viene aggiunta una GET dedicata alle icone durante la normale consultazione: il worker legge il documento KV insieme ai dati della sessione. Il pannello admin rilegge la configurazione quando viene aperto.

La cache dei sondaggi resta di due minuti. Dopo un salvataggio viene invalidata la configurazione della campagna nella scheda corrente e la tabella si aggiorna immediatamente; altre schede recepiscono le modifiche alla successiva lettura dopo la scadenza della propria cache.

## Verifica e rilascio

Eseguire `npm run test:poll`, `npm run test:auth` e `npm run check:all`. I test coprono permessi admin/DM/giocatore, upload, isolamento tra campagne, percorsi non validi, immagini mancanti, versioni obsolete, nuovi sondaggi, ripristino e unione delle icone predefinite con quelle personalizzate.

Pubblicare prima il worker aggiornato e poi i file del sito. Non sono richiesti nuovi secret, bucket o namespace KV; le configurazioni vengono create al primo salvataggio.
