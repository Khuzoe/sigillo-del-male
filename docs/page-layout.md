# Impaginazione condivisa

Le pagine principali e le schede usano `assets/css/components/page-layout.css`,
caricato dopo gli stili della pagina con `data-page-style`. Questo mantiene lo
stesso ordine anche nella navigazione interna senza ricaricamento completo.

`site-layout` sul body abilita le regole; `page-frame` identifica il contenitore
centrale. Nelle pagine precedenti, il contenitore include sia la testata sia il
contenuto, evitando di sommare margini esterni e padding della vecchia `.container`.

## Dimensioni e varianti

- Larghezza massima utile: 1760 px, calcolata nello spazio disponibile dopo la
  navigazione laterale. Il limite evita righe e schede eccessivamente larghe sui
  monitor ultrawide.
- Margini laterali: da 16 a 32 px su desktop, 16 px su tablet, 12 px fino a 640 px.
- Distanza iniziale: 32 px su desktop; su tablet e telefono si aggiunge l'altezza
  della barra di navigazione. Negli embed Foundry non si aggiunge la barra.
- Testate delle raccolte: altezza minima 220 px, 190 px su telefono.
- Testate semplici degli strumenti: altezza minima 172 px, 150 px su telefono.
- Titoli interni: scala comune da 32 a circa 54 px, ridotta sui telefoni.
- Home: copertina distinta, con titolo più grande e altezza minima 280 px.
- Schede personaggio: conservano la composizione con ritratto e informazioni;
  il nome usa una scala dedicata da 32 a circa 61 px.
- Le griglie NPC e oggetti aggiungono colonne quando ogni scheda dispone di almeno
  440 px. Le griglie dei giocatori conservano la disposizione a due colonne.
- I paragrafi di cronache, missioni, dossier e appunti hanno un limite di 76ch;
  tabelle, immagini e strumenti possono usare l'intera cornice.

Colori, immagini e identità delle campagne restano nei rispettivi temi. Login,
stampa e pagine legacy di reindirizzamento non usano questa cornice.

## Verifica

Controllare le pagine con menu laterale aperto e chiuso, navigazione interna e
cambio campagna. Su telefono la cornice deve iniziare sotto la barra superiore e
lo scorrimento orizzontale deve restare nei componenti che lo richiedono.

La verifica locale comprende pagine di raccolta, cronache, calendario, economia,
appunti, crafting, ricerca, albero familiare, sondaggi e schede NPC nelle tre
campagne. L'anteprima usa richieste in sola lettura; non modifica i dati online.
