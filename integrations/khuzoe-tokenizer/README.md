# Avatar delle varianti — khuzoe-tokenizer 1.2.0

La patch `variant-avatars-1.2.0.patch` conserva le modifiche al modulo installato in Foundry DEV TEST. È stata verificata sulla copia originale di khuzoe-tokenizer 1.1.0 e comprende codice, interfaccia, traduzioni, documentazione e test. Non contiene dati dei mondi o immagini.

Il modulo installato è già aggiornato. Dopo aver ricaricato Foundry, aprire **Gestisci varianti** e usare **Associa avatar** sulla variante desiderata. L'anteprima con **M** mostra l'avatar associato alla variante attiva del singolo token. **Usa avatar base** rimuove l'associazione senza cancellare file.

Il ritratto dell'Actor condiviso, le schede, la chat e il dossier wiki mantengono il ritratto base. Il nuovo campo opzionale `avatarSrc` viene conservato quando un aggiornamento esterno della variante non lo specifica; un valore vuoto o `null` lo rimuove. Questa versione non aggiunge il caricamento su R2 o la modifica degli avatar variante dal sito.

Per applicare la patch a un'altra copia di **1.1.0**, dalla cartella del modulo verificare prima con `git apply --check <percorso-patch>` e poi applicare con `git apply <percorso-patch>`. Non applicarla alla copia già aggiornata a 1.2.0.

Verifiche: controllo sintassi JavaScript e 31 test automatici del modulo, con documenti e caricamenti simulati. Anteprima del template reale verificata anche a 320 px. Non sono stati modificati dati del mondo per eseguire le verifiche.
