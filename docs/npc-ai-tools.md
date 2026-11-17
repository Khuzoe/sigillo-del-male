# Strumenti AI nella scheda NPC

Anche il proprietario di un personaggio può usare **Genera icone abilità** e **Traduci abilità**, con conferma delle singole proposte e controlli di proprietà nel Worker. Gli altri strumenti rimangono riservati ai gestori della campagna. [Permessi e percorso del personaggio](player-ability-ai.md).

DM e admin aprono **Strumenti AI** dalla barra della scheda, in lettura e in modifica. Il pannello riunisce gli accessi prima distribuiti fra dossier, media, combattimento e inventario:

| Sezione | Azioni |
| --- | --- |
| Immagini | Genera avatar, Genera token, Genera icone abilità |
| Abilità | Traduci abilità, Crea abilità, Modifica abilità |
| Scheda NPC | Modifica scheda NPC, Suggerisci miglioramenti |
| Bottino | Genera bottino |

**Modifica abilità** mostra attacchi, capacità e incantesimi con ricerca per nome e tipo. Le capacità con modifiche in attesa di Foundry sono disabilitate. Il collegamento contestuale **Modifica con AI** resta anche sulle singole capacità e nell’editor completo.

**Suggerisci miglioramenti** permette di consultare o scartare l’analisi precedente anche senza un avatar attuale. **Scarta analisi** torna alla schermata iniziale e conserva lo scarto sul servizio; una nuova analisi richiede sempre il proprio clic esplicito.

**Genera token** usa l’avatar salvato per proporre un token circolare 1:1 con esterno trasparente; l’applicazione richiede **Usa questo token**. [Dettagli e verifica](npc-token-generation.md).

Il pannello apre i generatori esistenti, conservando gli stessi percorsi API, bozze, anteprime, conferme e callback di sincronizzazione. Aprire il pannello o scegliere uno strumento non avvia una generazione. Le azioni non disponibili mostrano il motivo: avatar mancante, modifiche non salvate, salvataggio in corso o modifica completa della scheda in attesa di Foundry. Il controller ricontrolla permessi, modifiche e identità dell’NPC prima di aprire lo strumento.

Nell’elenco NPC, **Genera NPC con AI** è visibile ai gestori anche senza attivare **Modifica**.

Verifica: `npm run test:npc-ai-tools`, `npm run test:avatar-generation`, `npm run test:ability-generation`, `npm run test:npc-reading`. Per la prova visiva: `node scripts/preview-npc-ai-tools.mjs --serve`, poi aprire `http://127.0.0.1:8769/output/npc-ai-tools-qa/1180.html` o `320.html`. L’analisi precedente e lo scarto sono simulati nella sessione del browser; token, icone e traduzioni hanno risposte locali simulate, mentre le altre scritture sono escluse dalla prova.
