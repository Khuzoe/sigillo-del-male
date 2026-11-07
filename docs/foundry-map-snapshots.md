# Prova delle mappe Foundry

Il prototipo è installato in Foundry DEV. Dopo aver ricaricato Foundry, aprire
come DM una scena con un solo livello. Nel menu contestuale della scena già
aperta, scegliere **Mappa sul sito**, controllare la selezione di tile e token
e premere **Anteprima giocatori**. La composizione di anteprima è locale.

Per la pubblicazione end-to-end servono la migrazione
`0006_foundry_maps.sql`, il nuovo Worker e la pagina **Luoghi** aggiornata.
Sul modulo Wiki Sync 0.11.20 la patch del manifest va accompagnata da
`foundry-map-snapshots.mjs` in `scripts/services/`.

- **Pubblica e collega** rende disponibile la scena in **Luoghi → Mappe
  pubblicate da Foundry**. Il collegamento identifica mondo e scena.
- **Aggiorna all’avvio** esporta la scena attiva già aperta, una volta
  per avvio e dal solo GM designato. Cambi di sfondo o impostazioni di
  visuale richiedono una nuova anteprima. Tile nuovi e texture sostituite
  devono essere approvati prima di comparire nella vista giocatori.
- Con la nebbia, la vista condivisa combina l’esplorazione salvata
  dei giocatori. La versione giocatori oscura i pixel inesplorati prima
  della codifica. Tile e token nascosti sono esclusi dalla sua composizione.
- Le immagini sono in R2 privato. La vista DM richiede il ruolo DM o admin
  della campagna. Per la vista giocatori l’account deve essere associato
  a un personaggio della campagna. Quando le viste coincidono, si usa
  un solo file. Un errore conserva la pubblicazione precedente.
- L’export è una fotografia dello stato della scena, con un lato massimo
  di 3072 pixel e 4 MB per vista. Riproduce le texture di scena, tile e token.
  La prova è limitata a scene con un solo livello e non simula l’illuminazione
  o la linea di vista in tempo reale.

`npm run test:foundry-map-snapshots` verifica permessi, separazione delle
viste, nebbia condivisa e aggiornamento all’avvio. Il rendering è stato
controllato su una scena sintetica nel browser con la versione Pixi di
Foundry DEV.
