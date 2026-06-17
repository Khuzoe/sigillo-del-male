# Data Loading Performance

## Pattern corrente

Per JSON statici o generati della campagna usare:

```js
const data = await window.CriptaApp.data.json("items.json");
```

Per JSON globali usare:

```js
const data = await window.CriptaApp.data.globalJson("campaigns.json");
```

Questi helper passano da una cache in memoria condivisa e restituiscono una copia del payload, cosi le pagine non si contaminano tra loro se modificano array o oggetti.

## Quando non usare la cache statica

- Salvataggi `POST`.
- Letture KV fatte per verificare versioni prima di salvare.
- Sincronizzazioni e asset audit che devono vedere lo stato remoto piu recente.
- API dinamiche come inventario e stati abilita quando serve aggiornamento immediato.

## Regola pratica

Se il dato arriva da `campaigns/<campaign>/data/*.json` o `assets/data/*.json`, usare `CriptaApp.data`. Se arriva da `/api/data/*` e non e parte di un editor o sync, usare `CriptaApp.api.get` senza cache-bust manuale: il client deduplica e invalida dopo le scritture.

## Audit locale

Per controllare peso JS/CSS delle pagine, charset e fetch statici rimasti:

```bash
npm run check:performance
```

Lo script produce warning e non blocca il lavoro. Serve a individuare regressioni e prossimi refactor utili, soprattutto sulle pagine con JS molto grandi.
