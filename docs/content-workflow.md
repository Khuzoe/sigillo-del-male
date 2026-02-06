# Content Workflow

## Single Source of Truth
Modifica solo questi file come sorgente primaria:
- `assets/data/characters/*.yaml`
- `assets/content/**/*.md`
- `assets/data/players.json`
- `assets/data/quests.json`
- `assets/data/sessions.json`
- `assets/data/skills.json`
- `assets/data/family_von_t.json`

File derivati (non editare a mano):
- `assets/data/search-index.json` (generato da `npm run build:search`)
- `assets/data/foundry.json` (generato da `npm run build:foundry`, ignorato da git)

## Flusso Consigliato
1. Modifica contenuti sorgente (YAML/JSON/MD).
2. Esegui `npm run qa`.
3. Verifica la wiki in locale.
4. Committa solo i file sorgente e `assets/data/search-index.json` quando cambia.

## Hook Pre-Commit
Per bloccare commit con errori:
1. Esegui una volta `npm run hooks:install`.
2. Da quel momento il commit lancia automaticamente `npm run qa`.

## Regole Pratiche
- Ogni `content_blocks[].markdown` deve puntare a un file reale in `assets/content`.
- Evita campi non standard in `sessions.json` (es. `cliffhanger`, `tipo`, `eventoTrama`).
- Usa immagini `.webp` quando possibile (pipeline: `npm run images:webp -- --input <file>`).
