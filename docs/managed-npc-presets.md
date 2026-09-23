# Editor NPC: effetti e preset (21 settembre 2026)

Implementazione per Foundry 14.367 e D&D5e 5.3.3: Wiki Sync 0.11.0 e Khuzoe Automations 0.26.1. La revisione delle automazioni CAT esistenti resta 0.26.0: questa aggiunta non richiede di riapplicarle ai personaggi.

## Uso

Nella scheda del sito: **Modifica → Capacità → Modifica capacità → Attività → Effetti rapidi**.

- Cura dell'utilizzatore: nessuna, metà o tutti i danni. Il calcolo usa il danno dopo resistenze, immunità e riduzioni, include i PF temporanei e il danno eccedente i PF rimasti. Per più bersagli si somma prima di arrotondare per difetto. Le cure e i PF temporanei concessi non sono danni.
- Una o più delle 14 condizioni classiche, con durata 0–100 round e scadenza a inizio/fine turno. Zero indica rimozione manuale.
- Condizioni applicate tramite effetti nativi collegati all'attività: ai colpiti negli attacchi e ai fallimenti nei TS. Ogni condizione ha il proprio effetto, così le immunità possono intervenire separatamente.
- Le condizioni rapide non implementano prove ripetute, fuga da una presa, concentrazione o rimozioni speciali. Queste regole richiedono configurazione dedicata.

La cura richiede Midi-QOL con applicazione automatica dei danni e un token dell'utilizzatore. Con danni manuali compare un avviso e la cura non viene inventata sulla base dell'anteprima. Per le condizioni valgono le impostazioni normali di applicazione degli effetti Midi/DAE. La cura passa da Midi, senza scrivere direttamente i PF.

Le scelte rimangono bozze fino a **Invia a Foundry** / **Salva scheda**. Una capacità invia un solo comando anche se cambiano più preset. Per un'abilità già dotata di cure automatiche (es. Tocco Vampirico) lascia il preset cura disattivato, altrimenti aggiungeresti una seconda cura.

## Scambio dati

Wiki Sync esporta gli effetti incorporati dell'Item con i loro ID e i campi di configurazione `flags.midi-qol`, `flags.dae`, `flags.khuzoe-automations.npcRules`. Restano disponibili i dati delle attività e dei consumi; gli utilizzi massimi accettano formule. Gli altri flag dell'Item rimangono conservati in Foundry e non vengono sostituiti dall'editor.

Il contratto dei preset è `npcRules = {version: 1, activities: {ACTIVITY_ID: {healing: 0|0.5|1, conditions: string[], rounds: 0..100, expiry: "turnStart"|"turnEnd"}}}`. Attività assenti, condizioni sconosciute, dati troppo grandi o troncati sono rifiutati prima delle modifiche. Non è un interprete di macro arbitrarie.

Gli effetti si modificano attraverso le API dei documenti incorporati. Gli ID sono stabili, i riferimenti vengono verificati e le scritture rilette. Un reinvio completa un preset parzialmente applicato senza duplicare gli effetti. Come già per il salvataggio di più capacità, l'intero insieme di scritture non è una transazione: un errore rimane visibile e può richiedere un reinvio.

Per i campi di statistiche supportati, il sito riceve separatamente valore base ed effettivo. I valori controllati da effetti attivi sono mostrati come non modificabili; va modificato l'effetto responsabile. Questa versione modifica l'Actor gestito, non introduce un nuovo selettore delle istanze dei token.

## Costi Cloudflare

Nessun nuovo servizio o piano a pagamento. Nessuna nuova lettura/scrittura R2 per queste modifiche: le immagini rimangono nel flusso media già esistente.

- Il Worker evita la scrittura KV quando il runtime ricevuto è identico a quello già presente (una lettura aggiuntiva, nessuna scrittura per quel caso).
- Il sito controlla la coda solo se ci sono comandi in attesa, sospende le richieste nelle schede nascoste, aumenta l'intervallo fino a 60 secondi e si ferma dopo 20 controlli. Lo stato resta «in coda» con invito a ricaricare; non viene mostrato un successo fittizio.
- Le modifiche ai controlli non generano richieste. Si conserva il raggruppamento/debounce e il controllo degli hash già presenti in Wiki Sync.
- Nessuna migrazione automatica dell'intera campagna o caricamento massivo di immagini: sincronizzare inizialmente solo gli NPC da modificare.

Quote ufficiali verificate: [KV](https://developers.cloudflare.com/kv/platform/pricing/) Free 100.000 letture e 1.000 scritture/giorno, 1 GB; [R2 Standard](https://developers.cloudflare.com/r2/pricing/) 10 GB-mese, 1 milione di operazioni A e 10 milioni B/mese gratuiti. Le quote sono condivise con il resto dell'account; queste ottimizzazioni non costituiscono un limite di spesa dell'account R2. Una modifica può comportare anche scritture della coda, dell'ACK e dello snapshot: non equivale necessariamente a una sola scrittura KV.

## Attivazione e verifiche

Pubblicare insieme Worker, JavaScript/CSS della pagina e cachebuster HTML; installare le due versioni dei moduli e ricaricare il GM. Sincronizzare un NPC da Foundry per ricevere i nuovi effetti e le capacità dichiarate dell'editor. Non lanciare allineamenti o conversioni Actor Link per attivare questi preset.

Le modifiche locali non hanno aggiornato documenti dei mondi, impostazioni Midi o risorse Cloudflare. Il browser è stato provato con un NPC fittizio e API locali, senza richieste al mondo reale. Prima dell'uso in campagna resta opportuna la verifica del primo attacco nel mondo di test con le impostazioni Midi effettive.

Test: suite completa Khuzoe Automations, test dei preset, scambio NPC con Worker/Foundry simulati, editor, roundtrip, sicurezza Actor e visibilità NPC. I test di sicurezza ora ricevono anche gli helper D&D5e realmente importati dal modulo e usano uno Spell per verificare la preparazione.

Per verificare il modulo installato anziché la vecchia copia `module/` del sito:

```powershell
node scripts/test-managed-actor-roundtrip.mjs '<percorso-modulo>/scripts/services/managed-actor-sync.js'
node scripts/test-managed-npc-rules.mjs '<percorso-modulo>/scripts/services/managed-actor-sync.js' '<percorso-khuzoe-automations>/scripts/npc-rules.mjs'
node --experimental-default-type=module scripts/test-managed-actor-safety.mjs '<percorso-modulo>/scripts/services/managed-actor-sync.js'
```
