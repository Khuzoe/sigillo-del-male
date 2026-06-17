# Content Workflow

## Single Source of Truth

La classificazione ufficiale dei dati e in:

- `docs/data-source-map.md`
- `docs/data-source-map.json`

Prima di modificare o cancellare un file dati, controlla se e `authoring`, `generated`, `generated-draft`, `authoring-import` o `template`.

## File da modificare normalmente

- `assets/data/*.json`, salvo file generati.
- `assets/data/characters/**`.
- `assets/content/**`.
- `campaigns/<campaign>/data/*.json`, salvo file generati.
- `campaigns/<campaign>/data/characters/**`.
- `campaigns/<campaign>/data/content/**`.
- `campaigns/<campaign>/data/locations.json`, dopo l'import iniziale.

## File da non modificare a mano

- `assets/data/search-index.json`
- `assets/data/npc-recency.json`
- `assets/data/home-recent-npcs.json`
- `assets/data/foundry.json`
- `campaigns/<campaign>/data/search-index.json`
- `campaigns/<campaign>/data/npc-recency.json`
- `campaigns/<campaign>/data/home-recent-npcs.json`
- `campaigns/<campaign>/data/foundry.json`

Questi file si rigenerano con:

- `npm run build:search`
- `npm run build:npc-recency`
- `npm run build:home-recent`
- `npm run build:foundry`

## Bozze e output legacy

- `items_populated.json`
- `timeline.draft.json`

Sono bozze generate o output storici. Se contengono dati validi, promuovili nei file sorgente canonici invece di usarli direttamente come fonte permanente.

## Editor legacy

Gli editor generali in `tools/` sono strumenti admin/DM non linkati dalla navigazione ordinaria:

- `tools/characters-editor.html`
- `tools/items-editor.html`
- `tools/bestiary-editor.html`
- `tools/map-editor.html`

Gli editor canonici sono quelli interni alle singole schede o sezioni del sito. Le pagine in `tools/` restano solo per import, export, manutenzione massiva e correzioni amministrative.

Dettaglio operativo: `docs/legacy-editors.md`.

## Caricamento dati nel frontend

Per leggere JSON statici o generati della campagna usare `CriptaApp.data.json(...)` invece di `fetch(...)` diretto. Per i JSON globali usare `CriptaApp.data.globalJson(...)`.

Dettaglio operativo: `docs/performance-data-loading.md`.

## Flusso consigliato

1. Modifica solo file classificati come `authoring` o `authoring-import`.
2. Esegui `npm run check:data-sources` quando aggiungi file dati o nuove cartelle campagna.
3. Esegui `npm run qa` prima di committare.
4. Committa gli output generati solo se servono al sito statico.

## Hook Pre-Commit

Per bloccare commit con errori:

1. Esegui una volta `npm run hooks:install`.
2. Da quel momento il commit lancia automaticamente `npm run qa`.

## Regole Pratiche

- Ogni `content_blocks[].markdown` deve puntare a un file reale nella cartella contenuti corretta.
- Evita campi non standard nei JSON condivisi se non sono gestiti dal sito e dal modulo.
- Usa immagini `.webp` quando possibile: `npm run images:webp -- --input <file>`.
- Non cancellare file generati o snapshot senza verificare prima il comando che li ricrea.
