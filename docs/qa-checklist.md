# QA Checklist

## Dati
- `npm run validate:data` passa senza errori.
- Nessun riferimento rotto a markdown o immagini nei personaggi.
- `sessions.json` ha solo campi supportati.

## Encoding
- `npm run check:encoding` non segnala errori bloccanti.
- Se ci sono warning mojibake, correggere prima del merge.

## Ricerca
- `npm run build:search` aggiorna `assets/data/search-index.json`.
- Aprendo `pages/cerca.html`, ricerca e link risultati funzionano.

## Visual
- Pagine principali aprono senza errori console:
  - `index.html`
  - `pages/npcs.html`
  - `pages/giocatori.html`
  - `pages/missioni.html`
  - `pages/sessioni.html`
  - `pages/characters/character.html?id=<id>`
