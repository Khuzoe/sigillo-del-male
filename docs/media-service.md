# Media Service

`assets/js/shared/media-service.js` espone `window.CriptaMedia` ed e il punto unico frontend per upload immagini verso R2.

## Responsabilita

- Conversione immagine in WebP con qualita configurabile.
- Upload a `/media/upload`.
- Inserimento `folder`, `filename` e `campaignId` nel `FormData`.
- Header `Authorization`.
- Validazione payload: dimensione salvata e presenza di `path`/`key`.
- Fallback canonico `media/campaigns/<campaign>/<folder>/<file>`.
- Risoluzione URL e cache busting tramite `CriptaApp.utils`.

## Uso

```js
const payload = await window.CriptaMedia.uploadImageFile(file, {
  folder: "items",
  fileName: "spada.webp",
  quality: 0.96
});

const imagePath = payload.path;
```

Per blob gia preparati da crop/resize:

```js
const payload = await window.CriptaMedia.uploadBlob(blob, {
  folder: "characters/randra",
  fileName: "avatar.webp"
});
```

## Regole

- Non creare nuovi upload manuali con `fetch("/media/upload")` fuori da questo service.
- Se un flusso deve preservare qualita alta, passa `quality`.
- Se un flusso produce gia un blob croppato o ridimensionato, usa `uploadBlob`.
- I path locali/R2 specifici del dominio restano nel chiamante; l'upload HTTP resta qui.
