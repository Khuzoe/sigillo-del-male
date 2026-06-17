# Data Source Map

Questa mappa definisce cosa si modifica a mano e cosa viene prodotto da script o import.
Il manifest verificabile e in `docs/data-source-map.json`.

## Regola pratica

- `authoring`: sorgente canonica, si puo modificare da sito/editor o a mano.
- `authoring-import`: import iniziale da Foundry o tool esterno, poi trattato come contenuto wiki.
- `generated`: output ricostruibile, non va modificato a mano.
- `generated-draft`: output ricostruibile da revisionare prima di promuoverlo a sorgente.
- `template`: base per nuove campagne, non e contenuto giocato.

## Sorgenti canoniche

- `assets/data/*.json`: fallback/default legacy della wiki, esclusi i file generati elencati sotto.
- `assets/data/characters/**`: NPC legacy/default in YAML.
- `assets/content/**`: blocchi markdown legacy/default.
- `assets/data/maps/**`: mappe/POI default.
- `campaigns/<campaign>/data/*.json`: dati canonici della singola campagna, esclusi i file generati elencati sotto.
- `campaigns/<campaign>/data/characters/**`: NPC della campagna in YAML.
- `campaigns/<campaign>/data/content/**`: blocchi markdown della campagna.
- `campaigns/<campaign>/data/locations.json`: luoghi importati da Foundry ma poi trattati come contenuto wiki.

## File generati

- `assets/data/search-index.json`: `npm run build:search`
- `assets/data/npc-recency.json`: `npm run build:npc-recency`
- `assets/data/home-recent-npcs.json`: `npm run build:home-recent`
- `assets/data/foundry.json`: `npm run build:foundry`
- `campaigns/<campaign>/data/search-index.json`: `npm run build:search`, quando presente
- `campaigns/<campaign>/data/npc-recency.json`: `npm run build:npc-recency`, quando presente
- `campaigns/<campaign>/data/home-recent-npcs.json`: `npm run build:home-recent`, quando presente
- `campaigns/<campaign>/data/foundry.json`: `npm run build:foundry`, quando presente

## Bozze generate

- `assets/data/items_populated.json`
- `assets/data/reports/**`
- `campaigns/<campaign>/data/items_populated.json`
- `campaigns/<campaign>/data/timeline.draft.json`

Questi file non sono sorgente canonica. Se il contenuto e utile, va promosso nei file `authoring` appropriati.

## Flusso consigliato

1. Modifica solo file `authoring` o `authoring-import`.
2. Esegui `npm run check:data-sources` per verificare che i dati siano classificati.
3. Esegui `npm run qa` o almeno gli script build necessari.
4. Committa i sorgenti e gli output generati solo quando l'output serve al sito statico.

## Note operative

- Non cancellare output generati solo perche sono duplicati: prima verifica che lo script li ricrei correttamente.
- Non usare `items_populated.json` o `timeline.draft.json` come origine permanente.
- Le cartelle `campaigns/_template/data/**` sono template, non dati di campagna reale.
