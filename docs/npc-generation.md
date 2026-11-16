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
visibile e sfondo bianco piatto all'esterno. Non è imposta una vista frontale
né a tre quarti. Le anteprime si possono ingrandire alla dimensione reale.

Durante la compilazione le anteprime restano sempre visibili: su desktop sono
accanto ai campi, con scorrimento separato del modulo; sugli schermi stretti
occupano una fascia fissa sopra i campi. Aprire riferimenti e impostazioni non
sposta le immagini fuori dalla vista.

Si possono scegliere fino a tre NPC della campagna, assegnando a ciascuno un
ruolo: stile e palette, aspetto e lineamenti, abbigliamento, cornice del token.
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
conferme ripetute e ricevute dopo ACK. Il test SQL usa l'interfaccia D1 locale
e il codice di produzione; non sostituisce il controllo della distribuzione
nel runtime Cloudflare. Non vengono effettuate chiamate a pagamento.

`node scripts/preview-npc-generator.mjs --static` prepara la pagina reale con
API e autenticazione simulate sotto `output/npc-generator-qa/`. Aprire
`/output/npc-generator-qa/npcs.html` dal server locale già attivo; `mobile.html`
contiene un viewport di 320 px. Il layout simulato non legge o modifica il token
reale del browser e le chiamate API della fixture non raggiungono i servizi online.
Senza `--static`, lo script può anche avviare un server autonomo sulla porta 8769.

La verifica include il pulsante nelle sezioni NPC e Bestiario e il renderer delle
creazioni in attesa, che legge i tag dal profilo senza richiedere un Actor esistente.
