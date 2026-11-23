# Genera NPC

Nell'elenco NPC, in modalità Modifica, **Genera NPC** affianca **Nuovo NPC**.
Il DM o l'admin inserisce nome, breve descrizione e categoria, prepara avatar
e token e conferma con **Crea NPC e sincronizza**. Il mondo Foundry viene
preselezionato quando disponibile; il dossier parte come Solo DM.
La descrizione viene conservata nel dossier. Le statistiche iniziali sono
quelle del flusso di creazione manuale.

## Immagini e riferimenti

La prima fase genera un avatar a figura intera 9:16 nello stile del generatore
avatar esistente. La seconda usa precisamente quell'avatar per creare il token
1:1: volto e busto, angolazione e posa libere, cornice circolare completamente
visibile e trasparenza all'esterno. Non è imposta una vista frontale
né a tre quarti. Le anteprime si possono ingrandire alla dimensione reale.

Durante la compilazione le anteprime restano sempre visibili: su desktop sono
accanto ai campi, con scorrimento separato del modulo; sugli schermi stretti
occupano una fascia fissa sopra i campi. Aprire riferimenti e impostazioni non
sposta le immagini fuori dalla vista.

Il token richiede `background: "transparent"`, WebP e `output_compression: 100`
direttamente al modello. Qualità e risoluzione restano quelle scelte; il file
restituito viene salvato e confermato senza ridimensionamenti o ricompressioni.
Il server verifica dimensioni e presenza del canale alpha prima di rendere pronta
la proposta, anche durante il recupero di un lavoro. Un risultato opaco conserva
l'avatar e richiede un nuovo clic esplicito per riprovare il solo token.
Il fondo a scacchi dell'anteprima rende riconoscibile l'area trasparente.
Le vecchie proposte opache rimangono disponibili: il pannello indica di rigenerare
il token se si vuole la trasparenza, senza avviare chiamate automatiche.
`tokenTransparencyVersion: 1` viene dichiarato dal coordinatore effettivo;
un coordinatore precedente non può avviare silenziosamente un token opaco.

### Pose per la scheda NPC

Per un **NPC già esistente**, apri la sua scheda dal catalogo NPC, scegli
**Strumenti AI → Immagini → Genera pose idle e hover**. In modifica trovi lo
stesso pulsante in **Aspetto condiviso**, accanto ai campi delle immagini.
Se hai già un idle, **Genera hover** parte direttamente da quel ritratto.
Puoi anche generare o caricare un altro idle e vedere entrambe le pose prima
di applicarle. **Applica hover** aggiorna il solo hover, **Applica le due pose**
salva la nuova coppia sullo stesso NPC. In entrambi i casi il token della mappa
e l’avatar mantengono i loro file.

Dopo aver visto avatar e token, apri **Pose per la scheda NPC**. **Genera idle**
prepara un ritratto quadrato trasparente nello stile dell’avatar, con il token
come riferimento secondario per l’inquadratura. Il ritratto è senza cornice.
Puoi anche caricare un idle WebP quadrato con trasparenza, fino a 12 MB.

**Approva idle e genera hover** modifica l’idle visualizzato. Di norma l’NPC
compie un gesto riconoscibile anche in miniatura, mantenendo il volto allineato
all’idle. Il DM può descrivere un’azione, un effetto o chiedere espressamente
un cambiamento lieve. Ogni posa generata
richiede una chiamata aggiuntiva. Un idle caricato si può usare direttamente.
Passa sul ritratto o premi **Prova la transizione** per confrontare le pose.
Seleziona **Usa queste due pose nella scheda** prima di confermare l’NPC.
Un nuovo idle richiede un nuovo hover. Se una generazione fallisce, puoi usare
la coppia precedente oppure confermare solo avatar e token.

Il profilo inviato da Wiki Sync collega le pose confermate all’Actor creato.
Il Worker copia entrambe nella cartella del sito per quell’Actor prima
dell’ACK di Foundry. La mappa continua a usare il token con la cornice.

In **Immagini di riferimento**, il DM può combinare fino a tre file e NPC della
campagna. **Allega immagini** accetta anche una selezione multipla di PNG, JPEG
o WebP. Ogni file ha un’anteprima, un ruolo (personaggio, emblema, equipaggiamento,
abbigliamento o stile) e una nota facoltativa dedicata. Un concept del personaggio
rende facoltativa la descrizione. Il nome serve per creare la scheda. Le note dei
concept guidano l’avatar e il token viene ricavato dall’avatar risultante.

I file vengono caricati quando si preme **Genera anteprime**. Il server conserva
i byte originali in uno spazio privato per campagna e account. Il digest del
contenuto permette di recuperare lo stesso allegato nei tentativi successivi.
Solo le immagini confermate entrano nella scheda. I limiti di 12 MB per file
e 24 MB complessivi valgono anche per le selezioni miste.

Per gli NPC della campagna si può assegnare a ciascuno un
ruolo: stile e palette, aspetto e lineamenti, abbigliamento, cornice del token.
**Scegli NPC di esempio** apre una finestra con ricerca per nome, ruolo, categoria
e mondo, filtri di categoria/sottocategoria e tipo, conteggi e paginazione di
24 risultati. Nessun NPC viene perso oltre i primi risultati. L'elenco completo
viene aggiornato all'apertura, indipendentemente dai filtri della pagina principale,
e include creature e NPC archiviati accessibili al DM. Gli NPC senza un'immagine
utilizzabile restano elencati con l'indicazione di caricarla sulla wiki.
Accenti e ordine delle parole non impediscono la ricerca. Le selezioni, fino a
tre NPC, rimangono conservate cambiando pagina o filtro.
Per i primi tre si usa l'avatar; per la cornice si usa il token. Le cornici non
sono inviate al generatore dell'avatar. I riferimenti devono essere immagini
PNG/JPEG/WebP già disponibili su R2 nella campagna: massimo 12 MB ciascuna e
24 MB complessivi. Il server risolve gli Actor della campagna, controlla l'ETag
e copia le immagini nella bozza all'avvio. Non scarica URL arbitrari.

Modello e qualità sono condivisi con il generatore avatar. Le qualità disponibili
sono medium, high e xhigh. Le risoluzioni richieste direttamente al modello sono:

| Scelta | Avatar | Token |
| --- | --- | --- |
| Media | 864 × 1536 | 1024 × 1024 |
| Alta | 1296 × 2304 | 1536 × 1536 |
| 2K | 1440 × 2560 | 2048 × 2048 |

I valori iniziali sono Alta / Alta. 2K e xhigh mostrano l'avviso di costo elevato.
Una coppia comporta due chiamate immagini. **Rigenera solo token** ne richiede
una e conserva l'avatar precedente. **Rigenera avatar e token** prepara una nuova
coppia e impedisce la conferma di una proposta precedente ormai superata.

## Bozze e conferma

`NpcGenerationStore` conserva l'ultima bozza per account e campagna. La route
`GET /api/npc-generation` restituisce la proposta e le opzioni effettivamente
supportate. Le immagini sotto `_private/ai-npcs/` richiedono autenticazione,
non vengono pubblicate dalla route media e restano recuperabili.

Gli alarm eseguono una fase alla volta, indipendentemente dalla pagina.
Richieste duplicate riusano lo stesso lavoro. Arresti e timeout non causano
tentativi automatici a pagamento. Se fallisce il token, l'avatar resta disponibile.
Un avatar recuperato dopo un'interruzione richiede un clic esplicito per avviare
il token. **Interrompi attesa** libera il generatore senza garantire l'annullamento
del costo del provider. Risultati tardivi non sovrascrivono o sbloccano altri lavori.

La conferma copia le immagini nel percorso canonico
`media/campaigns/<campagna>/managed-actors/site-pending/ai-<bozza>/base/`
e usa il contratto `actor.create` già letto da Wiki Sync. Non richiede modifiche
al modulo Foundry. L'identificativo di creazione resta stabile anche dopo la
rigenerazione del token. La proposta diventa accettata soltanto dopo il commit
della coda D1. La ricevuta persistita rende innocua una seconda conferma, anche
dopo l'ACK di Foundry. L'invio in coda resta distinto dalla creazione nel mondo,
che richiede un GM collegato.

## Attivazione e controlli

Pubblicare frontend e Worker insieme. Il binding `NPC_GENERATOR` e la migrazione
additiva `npc-generation-v1` registrano la nuova classe Durable Object.
Si riutilizzano `OPENAI_API_KEY`, R2 e il database esistenti; non si migrano i
documenti delle campagne e gli originali KV restano invariati.

`npm run test:npc-generation` verifica le route reali con provider simulato e
le query D1 con SQLite transazionale nello stesso processo. Copre riferimenti,
permessi, isolamento campagne, recupero delle due fasi, errori di commit,
conferme ripetute e ricevute dopo ACK. Verifica inoltre selezione dell'intero
catalogo, filtri, selezione multipla delle icone, trasparenza nativa e conservazione
esatta dei byte dell'immagine alla conferma. Il test SQL usa l'interfaccia D1 locale
e il codice di produzione; non sostituisce il controllo della distribuzione
nel runtime Cloudflare. Non vengono effettuate chiamate a pagamento.

`node scripts/preview-npc-generator.mjs --static` prepara la pagina reale con
API e autenticazione simulate sotto `output/npc-generator-qa/`. Aprire
`/output/npc-generator-qa/npcs.html` dal server locale già attivo; `mobile.html`
contiene un viewport di 320 px. Il layout simulato non legge o modifica il token
reale del browser e le chiamate API della fixture non raggiungono i servizi online.
La variante `/output/npc-generator-qa/npcs.html?pose=1` apre il generatore con
avatar e token di esempio già pronti e permette di provare la transizione di Nino.
Senza `--static`, lo script può anche avviare un server autonomo sulla porta 8769.

La verifica include il pulsante nelle sezioni NPC e Bestiario e il renderer delle
creazioni in attesa, che legge i tag dal profilo senza richiedere un Actor esistente.
