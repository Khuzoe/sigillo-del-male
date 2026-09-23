# Editor capacità NPC

L'interfaccia mantiene l'aspetto originale del sito: colori delle campagne, decorazioni, immagini e tipografia provengono dai fogli esistenti. Non viene aggiunto un tema globale.

## Organizzazione dell'editor

- Navigazione laterale fra Attività, Impostazioni, Descrizione e Avanzato; su telefono diventa una barra orizzontale scorrevole.
- Attività selezionabili singolarmente, con anteprima collegata ai campi e pulsanti aggiornati quando cambia il nome dell'attività.
- Le sezioni vuote non vengono mostrate. I controlli rimangono montati: cambiando sezione si conservano i dati in corso di modifica e gli ascoltatori esistenti.
- Navigazione da tastiera: frecce su/giù nei menu verticali, sinistra/destra in quelli orizzontali, Home/End in entrambi. La validazione apre l'attività contenente il campo non valido.
- Su telefono i comandi della scheda restano sotto la barra di navigazione.

`assets/css/pages/managed-npc-editor.css` regola soltanto disposizione, spaziatura e navigazione dell'editor. Non modifica la palette del sito, i ritratti o l'aspetto delle schede in lettura. Salvataggio, permessi, conflitti e collegamento con Foundry mantengono i percorsi esistenti.

## Verifica

La modifica funzionale è stata verificata con le suite editor (28 controlli), roundtrip contro il modulo installato (30 controlli) e visibilità NPC. Nel browser, usando dati locali, sono stati verificati modifica e conservazione dei valori su due attività, invio nello stesso comando, conservazione delle proprietà MidiQOL e navigazione da tastiera.

La suite storica `test-managed-actor-safety.mjs` ha un limite preesistente nell'estrazione delle funzioni: non include `normalizePreparedState`. Lo stesso errore è riproducibile sul frontend originale.

Le verifiche visive usano un'anteprima locale con dati di esempio, senza contattare il mondo Foundry.
