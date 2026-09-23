# Consultazione e compilazione dei sondaggi

Le viste nella home, nella pagina sessioni e nella pagina sondaggio usano lo stesso componente per tutte le campagne. La pagina dedicata ha una testata compatta, con campagna, sessione e comandi nel riquadro del sondaggio.

## Date e riepilogo

Le fasce consecutive dello stesso giorno condividono l'intestazione; una linea verticale distingue l'inizio di una nuova settimana, calcolata da lunedì. Il raggruppamento conserva gli ID e l'ordine delle opzioni. Le date importate non riconosciute restano separate.

Il riepilogo mostra fino a tre date con almeno un Sì, escludendo quelle per cui il DM ha votato No. A parità di altre condizioni privilegia meno No, più Sì, meno risposte mancanti e infine l'ordine originale. I Forse, le risposte mancanti e la disponibilità incerta del DM sono indicati esplicitamente. “Tutti disponibili” richiede il Sì di ogni partecipante, compreso il DM. Se il DM ha risposto No ovunque, viene mostrato un messaggio dedicato. Selezionare una proposta porta alla sua colonna: non conferma la sessione.

## Vista personale e avanzamento

Chi può votare può passare tra “Le mie disponibilità” e “Tabella completa”. Sui telefoni fino a 640 px la vista iniziale è quella personale; per gli utenti senza una riga modificabile rimane la tabella. Le scelte personali Sì, Forse e No sono dirette; Rimuovi riporta la risposta a vuoto. La tabella conserva il ciclo di voto esistente.

I suggerimenti delle altre campagne sono visibili anche nella vista personale ma non diventano risposte, né contribuiscono ai conteggi o al completamento. Ogni riga distingue Da compilare, compilazione parziale e Completo. Il pulsante “Prima risposta mancante” porta il focus alla prima fascia vuota nella vista corrente.

Le immagini dei suggerimenti hanno opacità 0,16 in entrambe le viste; nella tabella riportano anche “Altre campagne”. Sono mostrate solo nelle proprie caselle senza risposta. I voti effettivi conservano la piena opacità anche durante il salvataggio. Aprire i dettagli o aggiornare i suggerimenti non ricrea le immagini già presenti, evitando sfarfallii che possono sembrare deselezioni.

## Salvataggio e richieste

Le due viste condividono lo stesso stato e lo stesso POST esistente. Durante il salvataggio i comandi di voto e modifica sessione sono temporaneamente disabilitati per evitare scritture sovrapposte. “Salvato” compare dopo la risposta del server. In caso di errore viene ripristinato lo stato precedente e Riprova invia nuovamente solo quella scelta. Nella vista personale l'esito compare anche accanto alla fascia modificata. Le risposte tardive non modificano una pagina o campagna che nel frattempo è cambiata.

Una lettura iniziata prima di un salvataggio restituisce il risultato aggiornato anche al chiamante, senza ripristinare voti vecchi. Lettura e persistenza mantengono la campagna originale durante la navigazione. Nell'unione di righe storiche duplicate, l'assenza di una fascia non cancella una risposta già presente; un valore esplicitamente vuoto continua a rimuoverla.

Riepilogo, raggruppamenti, completamento e cambio vista non aggiungono GET. Rimane la cache esistente dei suggerimenti tra campagne. Questi miglioramenti richiedono solo il frontend; l'aggiornamento del worker descritto in `poll-icons.md` riguarda invece la precedente personalizzazione delle immagini.

## Verifica

La tabella riserva meno spazio ai nomi (96 px, 88 px su telefono) e usa celle dei voti più grandi (108 px, 104 px su telefono), con margini interni ridotti per valorizzare le immagini. I nomi lunghi possono andare a capo e la colonna resta visibile durante lo scorrimento orizzontale. Le stesse regole si applicano a tutte le campagne, alla home, alle sessioni e alla pagina sondaggio.

`npm run test:poll` verifica cache e suggerimenti, icone, raggruppamento delle date anche a cavallo dell'anno, disponibilità del DM, risposte mancanti, completamento, permessi della vista personale ed escape dei dati. Completare con `npm run test:auth` e `npm run check:all`.

Le regressioni dei suggerimenti includono GET tardive dopo un salvataggio, errori tardivi e invalidazioni della cache, righe duplicate parziali con rimozioni esplicite, stabilità del contenuto delle celle e isolamento della persistenza per campagna.

La prova in browser usa dati locali e include desktop/telefono, entrambe le viste, focus alla prima risposta mancante, salvataggio, errore con ripristino, nuovo tentativo e assenza di GET aggiuntive passando da una vista all'altra.
