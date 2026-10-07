# Probabilità per attività — aggiornamento 2 ottobre 2026

Implementazione locale per Foundry 14.367, D&D5e 5.3.3, Midi-QOL 14.0.11, Dice So Nice 6.2.9. Wiki Sync locale aggiornato a **0.11.5**. Il runtime dei tiri resta Khuzoe Automations **0.26.3**; questo aggiornamento non lo modifica. Non occorre riapplicare le automazioni CAT o modificare i compendi.

## Uso sul sito

Solo un **admin globale del sito** trova i controlli in **Modifica → capacità → Avanzato → Probabilità dei tiri**. Il ruolo DM o proprietario dell'Actor non è sufficiente. I dati sono esclusi dalle risposte API per gli altri utenti, anche per i comandi in attesa e per le risposte a modifiche ordinarie accorpate con una modifica admin.

Il pannello non dipende più da `definition.editor.midiRollConfig`: compare anche sulle vecchie schede senza questo metadato e senza configurazioni già memorizzate. Per i controlli guidati servono le attività native dell'abilità nello snapshot; solo se mancano occorre sincronizzare di nuovo l'NPC. Un flag assente parte da `{version: 1, activities: {}}`, senza alterare i tiri.

Per ciascuna attività di attacco, danno o tiro salvezza: interruttore e probabilità del massimo sui danni; per gli attacchi anche probabilità del 20 naturale. Campo vuoto/omesso o `null` significa normale. Sono ammessi 0–100 inclusi; 0 rende impossibile il massimo, 100 lo rende certo. Disabilitando la regola si conservano le percentuali. Le modifiche restano bozze fino al normale salvataggio. Controlli e JSON si aggiornano reciprocamente.

```json
{
  "version": 1,
  "activities": {
    "ID_ATTIVITA": {
      "enabled": true,
      "attackMaxChance": 20,
      "damageMaxChance": 50
    }
  }
}
```

L'ID è quello già presente nelle attività della capacità. Il campo è `flags.khuzoe-automations.midiRollConfig`. Nessun `when`, codice eseguibile o condizione. Il Worker e Wiki Sync verificano struttura, intervalli e attività prima delle scritture. Il flag è modificato tramite la coda esistente, con baseline, rilevamento dei conflitti, verifica della persistenza e conservazione degli altri flag.

Wiki Sync usa il proprio validatore puro `scripts/services/midi-roll-config.mjs`, senza chiamare l'API di Khuzoe Automations. Può salvare, disattivare o cancellare la configurazione anche con Automations precedente, disattivato o assente. I flag rimangono nei successivi snapshot e nelle modifiche ordinarie. `definition.editor.midiRollConfig` continua a indicare il supporto del runtime, senza essere usato come requisito per mostrare il pannello. Nessuna scansione aggiuntiva, nuovo polling o migrazione automatica dei documenti.

## Comportamento Foundry

Il nuovo file `midi-roll-config.mjs` appartiene a Khuzoe Automations; non modifica Midi-QOL o il suo namespace. Non aggiunge impostazioni, campi alle schede, notifiche o messaggi di chat. Questa è invisibilità nell'interfaccia, non segretezza del codice o del flag a chi ispeziona i documenti Foundry.

Salvare il flag non richiede aggiornare Automations. Con un modulo precedente o disattivato i dadi mantengono le probabilità normali; quando il runtime aggiornato viene caricato e attivato, usa le regole già salvate con `enabled: true`.

Gli hook D&D5e `postAttackRollConfiguration` e `postDamageRollConfiguration` associano una regola al Roll prima della valutazione. Un wrapper di `Die.mapRandomFace` usa il generatore uniforme già configurato da Foundry. La probabilità specificata va al massimo; il resto si divide uniformemente tra le altre facce. I dadi supportati sono d4, d6, d8, d10, d12 e d20. Nell'attacco si modifica solo il d20 principale, non i dadi bonus come Benedizione. Nei danni si applica a tutti i dadi dei Roll restituiti dall'attività, compresi critici e componenti con tipi diversi; altre attività e Roll aggiunti separatamente non ereditano la regola.

Vantaggio, svantaggio, keep/drop, ritiri dei termini e critici usano le normali regole dopo la generazione. I ritiri tramite `Roll.reroll()` conservano la regola sulla copia in memoria. Ogni estrazione è indipendente. Minimo/massimo espliciti e risultati manuali imposti dal metodo di risoluzione restano autorevoli. Le formule con modificatori ricorsivi mantengono i limiti di iterazione nativi di Foundry.

WeakMap separate per i Roll evitano di contaminare tiri simultanei e di aggiungere percentuali ai dati serializzati dei dadi/chat. Un Roll ricostruito arbitrariamente da JSON senza il contesto dell'attività non può ricostruire una regola dalla sola formula: per rilanciare la capacità dopo il ricaricamento usare la sua attività.

L'integrazione interviene prima del calcolo: i risultati arrivano già definitivi a chat e al percorso Dice So Nice di Midi-QOL. L'ordine è stato verificato nei sorgenti installati; la visualizzazione 3D in una sessione attiva resta da provare dopo il rilascio. Non sono stati effettuati tiri su NPC reali o modificati documenti dei mondi.

## File e attivazione

- FE: `assets/js/pages/managed-actor.js`, `assets/css/pages/managed-npc-editor.css`, cachebuster in `pages/characters/managed-actor.html`.
- API: `workers/main-worker/src/index.js`.
- Sorgente del runtime: `integrations/khuzoe-automations/midi-roll-config.mjs`.
- Sorgente del validatore indipendente Wiki Sync: `integrations/cripta-wiki-sync/midi-roll-config.mjs`.
- Installazione riproducibile: `scripts/install-midi-roll-config.mjs`. Controlla le versioni e tutte le sostituzioni prima di scrivere, conserva copie dei file modificati in `.maintenance/midi-roll-config/` e preserva le versioni successive già installate. Con `--storage-only` modifica solo Wiki Sync e conserva le copie nel suo modulo.

Le modifiche Wiki Sync sono applicate al modulo di sviluppo installato in Foundry DEV TEST. L'installer applica la stessa modifica alle installazioni 0.11.x supportate senza sostituire l'intero modulo, conservando preset NPC e correzioni successive. Nessuno ZIP è stato generato.

Il sorgente `module/` nel repository resta alla versione **0.9.6**: non usare `build:module` su questa vecchia copia per distribuire l'aggiornamento.

Per un'altra installazione compatibile:

```powershell
node scripts/install-midi-roll-config.mjs 'PERCORSO/Foundry/Data/modules'
```

Per aggiornare soltanto il salvataggio, lasciando Automations invariato:

```powershell
node scripts/install-midi-roll-config.mjs 'PERCORSO/Foundry/Data/modules' --storage-only
```

Per questo aggiornamento sul sito pubblico: pubblicare il FE aggiornato, aggiornare Wiki Sync e ricaricare i client Foundry. Il Worker con i permessi admin e il contratto dei tiri già implementati non richiede modifiche. Non occorre risincronizzare le schede con attività native già presenti. Per eseguire le probabilità servono invece il runtime aggiornato e attivo di Automations e una regola abilitata. Nessun deploy, push o attivazione su capacità reali eseguito durante questa lavorazione.

## Verifiche eseguite

Aggiornamento del 2 ottobre: 51 verifiche editor (compresa la visualizzazione completa su snapshot precedenti), 70 API, 156 di integrazione Wiki Sync/preset, 101 di parità dei validatori storage/API/runtime, 30 roundtrip e suite sicurezza Actor. Il salvataggio è provato con Automations aggiornato, precedente, disattivato e assente, con export successivo, retry, conflitti, rimozioni e rifiuto dei dati invalidi prima delle scritture. L'installer è verificato con file in memoria, inclusi backup, idempotenza e assenza di accessi ad Automations in modalità `--storage-only`.

- 65 verifiche su distribuzione, limiti, isolamento, clone/ritiro, bonus immutati e dadi/modificatori **nativi di Foundry v14**, caricati dai sorgenti installati.
- 54 verifiche API: admin/DM/proprietario/anonimo, lettura riservata, normalizzazione dei percorsi, comandi accorpati, valori/attività invalidi e revisioni.
- 60 verifiche di integrazione Wiki Sync/preset, comprese applicazione, disattivazione, cancellazione dei valori annidati, conflitti e conservazione delle altre impostazioni.
- 42 verifiche editor, roundtrip 30 verifiche, suite sicurezza Actor, visibilità dossier e permessi admin.
- Suite completa Khuzoe Automations esistente superata.
- Anteprima browser con dati fittizi: campi → JSON, JSON → campi e assenza dei controlli per non admin.

```powershell
npm run test:midi-roll-api
npm run test:midi-roll-config -- 'PERCORSO/Foundry'
node scripts/test-midi-roll-storage.mjs
node scripts/test-midi-roll-installer.mjs 'PERCORSO/Foundry/Data/modules/cripta-wiki-sync/scripts/services/managed-actor-sync.js'
node scripts/test-managed-npc-rules.mjs 'PERCORSO/Foundry/Data/modules/cripta-wiki-sync/scripts/services/managed-actor-sync.js' 'PERCORSO/Foundry/Data/modules/khuzoe-automations/scripts/npc-rules.mjs'
node scripts/test-managed-actor-editor.mjs
```
