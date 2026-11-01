# Testi delle abilità negli alberi

L'editor guidato e quello avanzato condividono la stessa barra di formattazione, con etichette visibili: Testo, Titolo, Grassetto, Corsivo, Sottolineato, Elenco puntato, Elenco numerato e Riquadro. Selezionare il testo o posizionare il cursore nel paragrafo da formattare. Titolo crea un'intestazione della descrizione; Testo la riporta a paragrafo. Riquadro raggruppa i paragrafi selezionati e, premuto di nuovo al suo interno, rimuove il riquadro conservando il contenuto.

Per capacità con un effetto condizionale, usare un titolo «Effetto base» seguito dalle regole normali, poi un riquadro con un titolo che espliciti la condizione, per esempio «Durante Abbraccio di Ginevra». Il riquadro distingue le regole aggiuntive senza creare livelli, requisiti o sblocchi. Le intestazioni e le etichette brevi rendono superfluo evidenziare interi paragrafi in grassetto.

Il contenuto usa HTML ordinario (`h4`, `blockquote`, `p`, liste e formattazione in linea), senza classi o attributi speciali. Salvataggio, incolla e riapertura conservano titoli e riquadri; script, attributi e commenti copiati dagli appunti vengono rimossi. Gli elenchi mostrano punti o numeri nell'editor, nell'anteprima e nella scheda. Passare da elenco puntato a numerato cambia il tipo della lista; premere nuovamente lo stesso comando la riporta a paragrafi.

Questa modifica richiede la pubblicazione degli asset frontend, senza aggiornamenti del Worker o del modulo Foundry. La versione del renderer e del foglio di stile è allineata nei percorsi managed actor e personaggio legacy. I testi delle definizioni restano nel database online: aggiornare i file del sito non li modifica.

## Verifica

Eseguire `npm run test:skill-trees` e `node scripts/test-skill-tree-rich-text.mjs`. Il secondo comando usa Playwright con un browser locale di test. Installare Playwright nell'ambiente di sviluppo oppure impostare `PLAYWRIGHT_MODULE` al modulo disponibile; `PLAYWRIGHT_BROWSER_CHANNEL` permette di scegliere un browser installato, per esempio `msedge`.

Le verifiche DOM coprono conservazione e pulizia dell'HTML, formattazione di più paragrafi, cambio del tipo di elenco, titoli, riquadri, liste dentro i riquadri, equivalenza tra editor/anteprima/lettura e assenza di eccedenze orizzontali della barra a 390 px. Non usano credenziali né dati di produzione.
