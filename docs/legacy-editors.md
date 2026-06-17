# Legacy Editors

Gli editor generali in `tools/` sono strumenti admin/DM. Non sono la UI ordinaria di authoring e non vanno linkati nella navigazione principale.

## Editor canonici

- NPC: editor interno della scheda NPC.
- Oggetti e materiali: editor interno della pagina Oggetti.
- Bestiario: editor interno della scheda creatura.
- Luoghi: sezione Luoghi e schede luogo.

## Strumenti mantenuti

| Strumento | Stato | Uso previsto |
| --- | --- | --- |
| `tools/characters-editor.html` | Legacy admin | Import/export NPC, manutenzione massiva, correzioni strutturali. |
| `tools/items-editor.html` | Legacy admin | Import/export oggetti, materiali e correzioni massive. |
| `tools/bestiary-editor.html` | Legacy admin | Import/export creature e correzioni massive. |
| `tools/map-editor.html` | Legacy admin | Manutenzione POI, coordinate, import/export mappa. |

## Regole

- Le modifiche editoriali normali devono passare dagli editor interni.
- Le pagine legacy devono restare protette con `data-requires-dm`.
- Ogni nuovo flusso di upload immagini deve usare `CriptaApp.media`.
- Prima di rimuovere uno strumento legacy, verificare che import/export e manutenzione massiva siano coperti dall'editor canonico corrispondente.
