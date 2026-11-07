# Oggetti e Materiali su D1

## Attivazione del 6 novembre 2026

Cripta di Sangue, Mago Folle e Oltre il Velo sono attive su D1 con i
salvataggi riaperti. Versione Worker `6a5fb0d0-4bf6-4d39-b925-d1b0c56658f5`.
Sono stati copiati sei documenti per 615.758 byte, con 125 oggetti e 17
cartelle registrate. Prima della riapertura sono state confrontate le sei
risposte pubbliche di catalogo e cartelle. Dopo la riapertura sono stati
ricontrollati i byte, i metadati e le scadenze KV e le copie originali in D1.

Backup locali, esportazioni, piani di importazione e report si trovano in
`output/items-d1/cutover-20261106/`.

## Archivio

Il catalogo e il registro delle cartelle per campagna usano il database D1
`khuzoe-wiki` quando la campagna è abilitata. Si conserva il formato dei
documenti e l’API usata dal sito e da Wiki Sync. Le immagini restano in R2.
Il Worker riusa le transazioni già usate per gli NPC. La conferma di un drop
può quindi salvare il materiale, la sottocartella e il comando per l’inventario
in un solo commit. Foundry applica il comando alla sincronizzazione successiva.

## Procedura operativa

1. Eseguire `npm run test:campaign-item-storage` e applicare lo schema
   additivo `0005_campaign_items.sql` al database condiviso.
2. Pubblicare il Worker con la campagna in
   `CAMPAIGN_ITEMS_WRITES_PAUSED_CAMPAIGNS`, ancora esclusa da
   `CAMPAIGN_ITEMS_D1_CAMPAIGNS`. Attendere la propagazione prima della copia.
3. Riutilizzare `scripts/migrate-managed-actors-d1.mjs` con `--items`,
   `--campaign=...` e la stessa `--folder=output/items-d1/...` per tutta la
   procedura. Eseguire `backup`, `api-baseline`, `plan`, `import`, `verify`
   e `activate` in quest’ordine. L’importatore legge KV e conserva i byte,
   gli hash, i metadati e le scadenze. I valori originali sono salvati
   anche in D1, separati dai documenti attivi. Una chiave assente mantiene
   il comportamento precedente del catalogo statico o del registro vuoto.
4. Abilitare la campagna in `CAMPAIGN_ITEMS_D1_CAMPAIGNS` mantenendo la
   pausa. Eseguire `api-verify` e confrontare le risposte con il riferimento
   rilevato prima del passaggio. L’header `X-Campaign-Items-Storage: d1`
   identifica il nuovo archivio. Il campo JSON `source` mantiene il formato
   atteso dagli editor esistenti.
5. Riaprire le scritture. Eseguire `verify-kv` per ricontrollare le chiavi
   originali e le copie D1 anche dopo le prime modifiche reali.

Una campagna abilitata con importazione incompleta restituisce un errore di
archivio. Prima di un eventuale ripristino dopo la riapertura, sospendere le
scritture ed esportare le modifiche D1 successive al passaggio. Disabilitare
direttamente il flag mostrerebbe lo snapshot KV precedente.
