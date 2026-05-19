# Modulo Foundry: Cripta Wiki Sync

## Stato attuale

Il modulo base si trova in `module/` ed espone:

- browser wiki Foundry con sezioni:
  - panoramica
  - sessioni
  - NPC
  - giocatori
  - oggetti
  - bestiario
- pannello entita collegato a:
  - token HUD
  - pulsante nelle schede actor
- appunti separati in:
  - personali (`client setting`)
  - condivisi (`world setting`, modificabili dal GM)
  - note GM (`world setting`, visibili solo al GM)
- creazione di bozza wiki per token/actor non collegati:
  - disponibile al GM
  - la bozza viene salvata come dato Foundry locale
  - il documento riceve un flag di collegamento

## Come legge la wiki

Il modulo non duplica i dati del sito: legge direttamente da URL configurabile.

Impostazione usata:

- `Cripta Wiki Sync > URL base della wiki`

Default:

- `https://khuzoe.github.io/sigillo-del-male`

Endpoint letti dal modulo:

- `assets/data/foundry.json`
- `assets/data/items.json`
- `assets/data/bestiary.json`
- `assets/css/abyssal.css`

Questo permette di mantenere il look del sito il piu vicino possibile senza dover aggiornare il modulo a ogni piccolo cambio editoriale.

## Installazione in Foundry

Per una prima prova locale:

1. copia la cartella `module/` dentro la directory moduli di Foundry con nome:
   - `cripta-wiki-sync`
2. abilita il modulo nel mondo desiderato
3. apri i controlli token e usa il pulsante libro per aprire il browser wiki

## Limiti attuali del MVP

- le bozze create da Foundry restano locali al mondo e non scrivono ancora nel repo Git
- il matching automatico usa prima eventuali flag di collegamento, poi il nome dell'actor/token
- gli appunti condivisi sono gestiti solo dal GM in questa prima base
- il renderer e condiviso nello stile, ma non replica ancora tutte le interazioni avanzate del sito

## Prossimi passi consigliati

1. aggiungere export delle bozze Foundry verso file repo strutturati
2. introdurre linking esplicito actor <-> voce wiki da interfaccia
3. riusare renderer piu specifici del sito per bestiario e personaggi
4. aggiungere sync guidato per note e campi scelti, non bidirezionale totale
