# Strumenti AI per il proprietario del personaggio

Nella scheda collegata a Foundry, il proprietario di un personaggio (`character` o `player`) trova **Strumenti AI** nella barra, sia in lettura sia in modifica. Sono disponibili:

| Azione | Proposta | Conferma |
| --- | --- | --- |
| Genera icone abilità | Icone di capacità, attacchi e incantesimi, con avatar salvato come riferimento | **Usa icona**, modifica soltanto `img` |
| Traduci abilità | Nome e descrizione in italiano, senza richiedere un avatar | **Applica traduzione**, modifica soltanto `name` e `system.description.value` |

La traduzione ha ricerca per nome, selezione delle abilità visibili, deselezione totale e confronto originale/proposta. Le richieste vengono eseguite una alla volta; chiudere conserva i lavori già avviati e ferma quelli della selezione non ancora iniziati. L'applicazione di ogni abilità richiede un clic separato. Si usano normali comandi `item.update`: Foundry deve sincronizzare prima di vedere il risultato nella scheda.

I permessi sono controllati dal Worker con `ownerAccountIds` del documento canonico e l'account autenticato, anche su lettura bozze, anteprime, interruzione e conferma. Un lettore pubblico o il solo permesso di modifica delle statistiche non autorizza spese AI. Il proprietario di un companion NPC non ottiene i permessi AI del DM. Creazione, modifica meccanica delle capacità, modifica completa, avatar/token, analisi e bottino restano riservati ai gestori della campagna. DM e admin possono usare anche i due strumenti sui personaggi.

Il servizio di traduzione è `ability-translations`, con lavori isolati per campagna, mondo, personaggio e capacità nel coordinatore esistente `ABILITY_GENERATOR`. La capability `abilityTranslations:1` impedisce chiamate involontarie al precedente compilatore durante un aggiornamento. La richiesta testo invia soltanto nome e descrizione dell'abilità; non invia la scheda, dossier, account, flag o macro. Usa il modello testo già configurato per le abilità, con output strutturato e `store:false`.

Il validatore condiviso consente solo i due campi testuali e conserva numeri, dadi, formule, riferimenti Foundry, tag HTML e attributi. Controlla anche il contesto di CD, CA e distanze senza conversioni di unità. Nessuna risposta AI può scrivere statistiche o automazioni. Il significato linguistico va comunque valutato nell'anteprima.

Lavori e contatori restano conservati; nessuna ripetizione automatica delle chiamate a pagamento. Le conferme ricontrollano il testo di partenza, le modifiche pendenti e la proprietà attuale. La coda conserva un identificativo AI assegnato soltanto dal server, per recuperare lo stesso invio dopo una risposta persa. I client non possono impostarlo nelle richieste manuali.

Per i personaggi non occorre estendere l'archivio nativo NPC né aggiornare il modulo Foundry: si usa la scheda sincronizzata con `definition.editor.version:1`. Occorre pubblicare Worker e frontend insieme; nessun nuovo binding o migrazione.

Verifiche: `npm run test:player-ability-ai`, `npm run test:npc-ai-tools`, `npm run test:npc-ability-icons`, `npm run test:ability-generation` e `npm run test:managed-actor-storage`. La prova visiva usa `node scripts/preview-npc-ai-tools.mjs --serve`, poi `http://127.0.0.1:8769/output/npc-ai-tools-qa/player-1180.html` e `player-320.html`. Il proprietario e le risposte AI sono simulati; non si usano credenziali o chiamate a pagamento.
