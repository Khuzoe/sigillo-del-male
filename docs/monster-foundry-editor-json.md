# Monster Foundry Editor JSON

Documento di riferimento per generare JSON compatibili con l'editor mostri del bestiario.

Questo file deve essere aggiornato ogni volta che cambiano i campi dell'editor, l'import JSON, l'export Foundry o la logica del modulo Foundry collegata ai mostri.

## Obiettivo

Permettere a una AI o a un servizio esterno di generare uno o piu mostri nel formato usato dal sito, cosi da importarli dall'editor del bestiario e ottenere i campi gia compilati.

L'import del bestiario accetta:

- un singolo oggetto creatura;
- un array di oggetti creatura.

Se una creatura importata ha lo stesso `name` o uno stesso `foundryName` di una creatura esistente, l'editor chiede se sostituirla.

Nella pagina dettaglio di un singolo mostro esiste anche il bottone `Import JSON`, vicino a `Export Foundry`. Questo import accetta solo una singola creatura JSON, sostituisce i campi del mostro attualmente aperto e non salva automaticamente online. Dopo l'import bisogna controllare i campi e premere `Salva`.

## Regole generali

- Il JSON deve essere valido, senza commenti.
- I path immagine devono essere stringhe relative o URL risolubili dal sito.
- Per immagini R2 usare preferibilmente path `media/...` restituiti dall'upload.
- Le immagini devono essere WebP.
- Nell'editor, avatar, token, icone abilita e icone condizioni possono essere caricati da file oppure incollati con `Ctrl+V` dopo aver portato focus o mouse sul relativo pulsante immagine.
- I campi non necessari possono essere omessi, ma i campi documentati qui sono quelli riconosciuti dall'editor.
- Per generare un mostro importabile in Foundry, compilare sempre `foundry`.

## Struttura minima

```json
{
  "id": "slug-mostro",
  "name": "Nome Mostro",
  "image": "media/creatures/bestiary/nome-mostro.webp",
  "tokenImage": "media/creatures/bestiary/tokens/nome-mostro-token.webp",
  "category": "Senza Categoria",
  "details": {
    "description": "Descrizione narrativa.",
    "dndType": "Mostruosita",
    "size": "Media",
    "traits": [],
    "drops": []
  },
  "foundry": {
    "ac": "15",
    "hp": {
      "value": 45,
      "formula": "6d8 + 18"
    },
    "cr": "3",
    "size": "med",
    "movement": {
      "walk": 30,
      "fly": "",
      "swim": "",
      "climb": ""
    },
    "abilities": {
      "str": { "value": 16 },
      "dex": { "value": 12 },
      "con": { "value": 16 },
      "int": { "value": 8 },
      "wis": { "value": 10 },
      "cha": { "value": 8 }
    },
    "abilitiesList": []
  }
}
```

## Campi creatura

| Campo | Tipo | Uso |
| --- | --- | --- |
| `id` | string | Slug stabile. Se manca, viene derivato dal nome in alcune logiche. |
| `name` | string | Nome reale della creatura. Obbligatorio per un risultato chiaro. |
| `mysteryName` | string | Nome pubblico quando `discovered` e `false`. |
| `discovered` | boolean | `false` mostra `mysteryName` sul sito e nel modulo quando serve evitare spoiler. |
| `hidden` | boolean | `true` nasconde la creatura ai non DM. |
| `image` | string | Avatar/immagine principale. Path consigliato: `media/creatures/bestiary/<slug>.webp`. |
| `tokenImage` | string | Immagine token Foundry. Path consigliato: `media/creatures/bestiary/tokens/<slug>-token.webp`. Se assente, Foundry usa `image`. |
| `imageAdjust` | object | Regolazione immagine nel sito: `{ "x": 50, "y": 50, "size": 1 }`. |
| `category` | string | Categoria mostrata nel bestiario. |
| `rank` | string | Categoria speciale visuale, ad esempio `mini_boss`, `unique_monster`, `special`. |
| `foundryName` | string o string[] | Nomi Foundry che devono matchare questa creatura. Usare array se ci sono alias/token diversi. |
| `sourceCharacterId` | string | Collegamento opzionale a un NPC/character del sito. |

## `details`

```json
{
  "description": "Testo descrittivo.",
  "dndType": "Costrutto",
  "size": "Grande",
  "height": "2.80 m",
  "weight": "900 kg",
  "traits": [
    { "name": "Rigenerazione", "icon": "fa-heart-pulse" }
  ],
  "drops": [
    {
      "itemId": "id-oggetto-wiki",
      "name": "Nome Drop",
      "image": "media/items/drop.webp",
      "rarity": "Raro",
      "note": "Nota sul drop."
    }
  ],
  "resistances": ["Freddo"],
  "immunities": ["Veleno", "Contundente magico"],
  "vulnerabilities": ["Fuoco"]
}
```

### Valori `details.dndType`

Usare uno di:

`Aberrazione`, `Bestia`, `Celestiale`, `Costrutto`, `Drago`, `Elementale`, `Folletto`, `Gigante`, `Immondo`, `Melma`, `Mostruosita`, `Non morto`, `Pianta`, `Umanoide`.

### Valori `details.size`

Valore descrittivo italiano:

`Minuscola`, `Piccola`, `Media`, `Grande`, `Enorme`, `Mastodontica`.

Il valore tecnico Foundry sta invece in `foundry.size`.

### Difese

Le difese del sito stanno in:

- `details.resistances`
- `details.immunities`
- `details.vulnerabilities`

Valori accettati:

`Acido`, `Freddo`, `Fuoco`, `Forza`, `Fulmine`, `Necrotico`, `Psichico`, `Radiante`, `Tuono`, `Veleno`, `Contundente`, `Tagliente`, `Perforante`.

Per danni fisici magici, usare:

- `Contundente magico`
- `Tagliente magico`
- `Perforante magico`

Regola UI: per `Contundente magico`, `Tagliente magico`, `Perforante magico`, deve esistere anche la corrispondente difesa base nello stesso gruppo o l'editor non potra mostrare correttamente il toggle magico.

Esempio corretto:

```json
{
  "immunities": ["Contundente", "Contundente magico"]
}
```

## `foundry`

Contiene i dati usati per generare l'actor NPC Foundry v12.

```json
{
  "ac": "17",
  "hp": {
    "value": 95,
    "formula": "10d10 + 40"
  },
  "cr": "5",
  "size": "lg",
  "legendaryActions": 3,
  "legendaryResistances": 2,
  "spellcastingAbility": "cha",
  "movement": {
    "walk": 30,
    "fly": 60,
    "swim": "",
    "climb": ""
  },
  "senses": "darkvision 18, truesight 3",
  "languages": "Comune, Infernale",
  "conditionImmunities": ["poisoned", "frightened"],
  "skills": {
    "prc": { "value": 1 },
    "ste": { "value": 2 }
  },
  "abilities": {
    "str": { "value": 18 },
    "dex": { "value": 14 },
    "con": { "value": 18 },
    "int": { "value": 10 },
    "wis": { "value": 12 },
    "cha": { "value": 16 }
  },
  "abilitiesList": []
}
```

### `foundry.size`

Usare uno di:

- `tiny`
- `sm`
- `med`
- `lg`
- `huge`
- `grg`

L'editor traduce automaticamente la taglia italiana in `details.size`.

### `foundry.hp`

- `value`: punti ferita medi/fissi.
- `formula`: formula D&D, ad esempio `10d8 + 30`.

Quando l'utente modifica la formula nell'editor, il sito puo calcolare automaticamente il valore medio.

### `foundry.cr`

Stringa o numero. Esempi validi:

- `"1/8"`
- `"1/4"`
- `"1/2"`
- `"3"`
- `5`

Il bonus competenza viene calcolato dal CR.

### `foundry.legendaryActions` e `foundry.legendaryResistances`

Numeri o stringhe numeriche.

In export diventano:

- `system.resources.legact`
- `system.resources.legres`

### `foundry.movement`

Usare numeri o stringhe vuote.

```json
{
  "walk": 30,
  "fly": 60,
  "swim": "",
  "climb": ""
}
```

Nel sito, volo/nuoto/scalata sono attivi se il campo contiene un numero.

### `foundry.senses`

Stringa libera parsata dal sito. Formati consigliati:

- `"darkvision 18"`
- `"blindsight 3, darkvision 18"`
- `"tremorsense 9, truesight 18"`

Valori riconosciuti:

- `darkvision`
- `blindsight`
- `tremorsense`
- `truesight`

### `foundry.spellcastingAbility`

Caratteristica usata per calcolare CD TS standard:

`str`, `dex`, `con`, `int`, `wis`, `cha`.

CD suggerita: `8 + bonus competenza + modificatore caratteristica`.

### `foundry.conditionImmunities`

Array di condizioni Foundry.

Valori:

`blinded`, `charmed`, `deafened`, `frightened`, `grappled`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`, `prone`, `restrained`, `stunned`, `unconscious`, `exhaustion`.

### `foundry.skills`

Oggetto indicizzato con gli skill key Foundry dnd5e.

Valori:

- `0` o assente: nessuna competenza.
- `1`: proficiency.
- `2`: expertise.

Skill key supportate:

| Key | Skill |
| --- | --- |
| `acr` | Acrobazia |
| `ani` | Addestrare Animali |
| `arc` | Arcano |
| `ath` | Atletica |
| `dec` | Inganno |
| `his` | Storia |
| `ins` | Intuizione |
| `itm` | Intimidire |
| `inv` | Indagare |
| `med` | Medicina |
| `nat` | Natura |
| `prc` | Percezione |
| `prf` | Intrattenere |
| `per` | Persuasione |
| `rel` | Religione |
| `slt` | Rapidita di Mano |
| `ste` | Furtivita |
| `sur` | Sopravvivenza |

## Abilita del mostro: `foundry.abilitiesList`

Ogni elemento rappresenta una feature/azione/attacco da esportare in Foundry.

Struttura comune:

```json
{
  "id": "morso",
  "name": "Morso",
  "kind": "attack",
  "type": "weapon",
  "section": "action",
  "activation": "action",
  "icon": "fa-teeth",
  "iconImage": "media/monster-abilities/morso.webp",
  "description": "Descrizione dell'abilita.",
  "range": "5",
  "recharge": "",
  "damageParts": [],
  "rider": {}
}
```

### `kind`

Valori supportati:

- `attack`: attacco con tiro per colpire. Esporta come item `weapon`.
- `save`: effetto con tiro salvezza. Esporta come item `feat` con activity `save`.
- `aura`: tratto/aura.
- `passive`: tratto passivo.
- `reaction`: reazione.
- `legendary`: azione leggendaria.

### Passive riutilizzabili

Le passive sono normali elementi di `foundry.abilitiesList` con `kind: "passive"`, `type: "feat"` e in genere `section: "trait"`. L'editor mostra una tab `Passive` nella libreria drag-and-drop.

Struttura consigliata:

```json
{
  "id": "regeneration",
  "name": "Regeneration",
  "kind": "passive",
  "type": "feat",
  "section": "trait",
  "icon": "fa-heart-pulse",
  "description": "All'inizio del proprio turno, la creatura recupera i punti ferita indicati.",
  "passiveValueLabel": "PF rigenerati",
  "passiveValue": "10",
  "passive": {
    "id": "regeneration",
    "automation": "midi-qol",
    "hasNumberParam": true,
    "valueLabel": "PF rigenerati"
  }
}
```

Campi specifici:

| Campo | Tipo | Note |
| --- | --- | --- |
| `passiveValueLabel` | string | Etichetta del parametro mostrato nell'editor. Esempi: `PF rigenerati`, `Danno da contatto`, `Tipo danno assorbito`. |
| `passiveValue` | string | Valore compilato dall'utente. Viene aggiunto alla descrizione esportata in Foundry. |
| `passive.id` | string | Identificatore stabile della passiva. |
| `passive.automation` | string | `manual` se e solo testo/feature Foundry; `midi-qol` se esporta un Active Effect Midi-QOL; `module-required` se richiede logica custom runtime. |
| `passive.hasNumberParam` | boolean | Se `true`, l'editor mostra un campo valore anche quando non c'e `passiveValueLabel`. |
| `passive.valueLabel` | string | Fallback per `passiveValueLabel`. |

Caso speciale: per `passive.id: "absorption"`, `passiveValue` deve essere uno dei tipi danno tecnici usati dal builder, per esempio `fire`, `cold`, `necrotic`, `radiant`. L'editor lo mostra come selettore invece che come testo libero.

Passive built-in attualmente previste:

| `passive.id` | Nome | Parametro | Automazione |
| --- | --- | --- | --- |
| `avoidance` | Avoidance | no | `manual` |
| `damage-transfer` | Damage Transfer | no | `module-required` |
| `enlarge` | Enlarge | danni extra per round | `manual` |
| `heated-body` | Heated Body | danno da contatto | `module-required` |
| `magic-resistance` | Magic Resistance | no | `midi-qol` |
| `martial-advantage` | Martial Advantage | danni extra per round | `manual` |
| `parry` | Parry | no | `manual` |
| `regeneration` | Regeneration | PF rigenerati | `midi-qol` |
| `relentless` | Relentless | no | `module-required` |
| `stench` | Stench | no | `manual` |
| `undead-fortitude` | Undead Fortitude | no | `module-required` |
| `absorption` | Assorbimento | tipo danno assorbito | `midi-qol` |

Nota pratica: `midi-qol` genera Active Effects trasferiti sull'actor. `module-required` significa invece che l'item viene esportato come feature leggibile in Foundry, ma l'automazione in combattimento richiede codice del modulo Foundry. Non assumere che Midi/DAE applichino automaticamente queste passive se non esiste una regola specifica nel modulo.

Passive `midi-qol` attuali:

- `magic-resistance`: aggiunge `flags.midi-qol.magicResistance.all = 1`.
- `regeneration`: aggiunge `flags.midi-qol.OverTime` con `turn=start`, `damageType=healing` e valore preso da `passiveValue`.
- `absorption`: aggiunge `flags.midi-qol.absorption.<tipoDanno> = 1`.

### `section` e `activation`

Valori consigliati:

| Uso | `section` | `activation` |
| --- | --- | --- |
| Azione | `action` | `action` |
| Azione bonus | `bonus` | `bonus` |
| Reazione | `reaction` | `reaction` |
| Leggendaria | `legendary` | `legendary` |
| Tratto/passiva | `trait` | `""` |

### `recharge`

Campo esplicito per la ricarica classica su d6.

Valori:

- `""` oppure omesso: nessuna ricarica.
- `"6"`: Recharge 6.
- `"5"`: Recharge 5-6.
- `"4"`: Recharge 4-6.
- `"3"`: Recharge 3-6.
- `"2"`: Recharge 2-6.

In export Foundry v12 produce:

- `system.uses.max = "1"`
- `system.uses.recovery[0].period = "recharge"`
- `system.uses.recovery[0].formula = recharge`
- activity consumption `itemUses`
- activation condition `Recharge X-6`

Se `recharge` non e presente, il sito prova a leggere `Ricarica 5-6` o `Recharge 5-6` dalla descrizione. Per dati generati da AI e meglio usare sempre il campo esplicito.

## Danni: `damageParts`

Usare `damageParts` al posto dei campi legacy `damageFormula` e `damageType`.

```json
{
  "damageParts": [
    {
      "formula": "2d8 + 4",
      "type": "slashing",
      "magic": true
    },
    {
      "formula": "1d6",
      "type": "necrotic"
    }
  ]
}
```

Tipi danno:

`acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`, `piercing`, `psychic`, `radiant`, `slashing`, `thunder`, `poison`.

### Bonus statici nelle formule danno

Attenzione agli attacchi weapon con `attackAbility` uguale a `str`, `dex`, `con`, `int`, `wis` o `cha`: Foundry aggiunge gia il modificatore della caratteristica al danno base dell'arma.

Per evitare doppi modificatori, nell'export Foundry il sito rimuove il bonus statico dal primo `damageParts` degli attacchi non custom. Esempio: `1d8 + 3` viene esportato come dado base `1d8`, perche il `+3` sara aggiunto da Foundry tramite `attackAbility`.

Regole pratiche:

- Per attacchi standard, puoi scrivere `1d8 + 3` per leggibilita nell'editor, ma l'export Foundry usera solo `1d8` come danno base e lascera a Foundry il modificatore.
- Se vuoi un bonus extra oltre al modificatore, preferisci aggiungerlo come seconda riga danno oppure usa `attackAbility: "custom"` e `attackBonus` manuale.
- I danni extra e le abilita TS non rimuovono il bonus statico.

`magic: true` ha effetto solo su danni fisici:

- `bludgeoning`
- `piercing`
- `slashing`

Se almeno una riga di danno fisico ha `magic: true`, l'item Foundry riceve la proprieta `mgc`.

## Attacco: `kind: "attack"`

Esempio:

```json
{
  "id": "artiglio",
  "name": "Artiglio",
  "kind": "attack",
  "type": "weapon",
  "section": "action",
  "activation": "action",
  "range": "10",
  "attackAbility": "str",
  "attackBonusExtra": "1",
  "description": "Attacco in mischia con artiglio.",
  "damageParts": [
    { "formula": "2d6 + 4", "type": "slashing", "magic": true }
  ],
  "rider": {
    "alwaysConditions": ["grappled"],
    "failConditions": [],
    "failDamageParts": [],
    "successMode": "half",
    "advancedEffects": []
  }
}
```

### Bonus attacco

`attackAbility` puo essere:

`str`, `dex`, `con`, `int`, `wis`, `cha`, `custom`.

Se non e `custom`, il sito calcola:

`modificatore caratteristica + bonus competenza + attackBonusExtra`

Campi:

- `attackAbility`: caratteristica usata.
- `attackBonusExtra`: bonus aggiuntivo, ad esempio `"2"` o `"+2"`.
- `attackBonus`: bonus finale o manuale. Usare soprattutto se `attackAbility` e `custom`.

## Tiro salvezza: `kind: "save"`

Esempio con cono:

```json
{
  "id": "onda-gelida",
  "name": "Onda Gelida",
  "kind": "save",
  "type": "feat",
  "section": "action",
  "activation": "action",
  "range": "9",
  "saveAbility": "con",
  "saveDc": "15",
  "targetTemplateType": "cone",
  "targetTemplateSize": "9",
  "description": "La creatura emette un'ondata di gelo.",
  "damageParts": [
    { "formula": "4d8", "type": "cold" }
  ],
  "rider": {
    "successMode": "half",
    "failConditions": ["restrained"],
    "alwaysConditions": [],
    "failDamageParts": [],
    "advancedEffects": []
  }
}
```

### Campi TS

| Campo | Tipo | Uso |
| --- | --- | --- |
| `saveAbility` | string | `str`, `dex`, `con`, `int`, `wis`, `cha`. |
| `saveDc` | string/number | CD del tiro salvezza. Se manca, viene calcolata dalla spellcasting ability. |
| `targetTemplateType` | string | `""`, `line`, `circle`, `cube`, `cone`. |
| `targetTemplateSize` | string/number | Dimensione area/template. |
| `targetTemplateWidth` | string/number | Larghezza linea. Usata solo se `targetTemplateType` e `line`; default UI `5`. |
| `target` | string | Testo libero per target speciale. |

## Rider ed effetti aggiuntivi

`rider` controlla condizioni, danni aggiuntivi e automazioni custom del modulo Foundry.

```json
{
  "rider": {
    "alwaysConditions": ["grappled"],
    "failConditions": ["prone"],
    "saveAbility": "str",
    "saveDc": "14",
    "successMode": "half",
    "failDamageParts": [
      { "formula": "2d6", "type": "bludgeoning" }
    ],
    "advancedEffects": [],
    "notes": "Nota opzionale."
  }
}
```

### Condizioni

`alwaysConditions`: condizioni applicate automaticamente quando l'effetto base va a segno.

`failConditions`: condizioni applicate in caso di fallimento TS.

Valori condizione:

`blinded`, `charmed`, `deafened`, `frightened`, `grappled`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`, `prone`, `restrained`, `stunned`, `unconscious`, `exhaustion`.

### Successo TS

`successMode`:

- `"half"`: il successo dimezza i danni.
- `"negates"`: il successo annulla danni ed effetti da fallimento.
- `""` o omesso: trattato come `"half"` nell'export.

## Advanced effects

Gli advanced effects sono usati dal modulo Foundry custom per condizioni o effetti piu complessi.

Formato:

```json
{
  "id": "minus-3-ac-next-turn",
  "name": "-3 CA",
  "timing": "hit",
  "kind": "effect",
  "iconImage": "media/monster-conditions/minus-3-ca.webp",
  "duration": {
    "rounds": 1,
    "turns": 1
  },
  "changes": [
    {
      "key": "system.attributes.ac.bonus",
      "mode": 2,
      "value": "-3",
      "priority": 20
    }
  ]
}
```

### `timing`

- `hit`: applica con l'effetto automatico/base.
- `failedSave`: applica solo su fallimento TS.

### `kind`

- `effect`: effetto Active Effect standard/custom.
- `startTurnDamage`: effetto gestito dal modulo, infligge danno a inizio turno del bersaglio.

### Effetto danno a inizio turno

```json
{
  "id": "frost-dot-fire-break",
  "name": "Gelo persistente",
  "timing": "hit",
  "kind": "startTurnDamage",
  "iconImage": "media/monster-conditions/gelo-persistente.webp",
  "damage": {
    "formula": "1d8",
    "type": "cold"
  },
  "endsOnDamageType": "fire"
}
```

`endsOnDamageType` permette al modulo Foundry di rimuovere l'effetto quando il bersaglio subisce quel tipo di danno.

## Esempio completo

```json
{
  "id": "guardiano-di-ferro",
  "name": "Guardiano di Ferro",
  "mysteryName": "Costrutto Mascherato",
  "discovered": true,
  "hidden": false,
  "image": "media/creatures/bestiary/guardiano-di-ferro.webp",
  "tokenImage": "media/creatures/bestiary/tokens/guardiano-di-ferro-token.webp",
  "imageAdjust": { "x": 50, "y": 38, "size": 1.1 },
  "category": "Costrutti",
  "rank": "mini_boss",
  "foundryName": ["Guardiano di Ferro", "Iron Guardian"],
  "details": {
    "description": "Costrutto pesante progettato per bloccare i corridoi della cripta.",
    "dndType": "Costrutto",
    "size": "Grande",
    "height": "3.10 m",
    "weight": "1800 kg",
    "traits": [
      { "name": "Corpo Metallico", "icon": "fa-shield-halved" }
    ],
    "drops": [],
    "resistances": ["Freddo"],
    "immunities": ["Veleno", "Contundente", "Contundente magico"],
    "vulnerabilities": ["Fulmine"]
  },
  "foundry": {
    "ac": "18",
    "hp": {
      "value": 126,
      "formula": "12d10 + 60"
    },
    "cr": "8",
    "size": "lg",
    "legendaryActions": 2,
    "legendaryResistances": 1,
    "spellcastingAbility": "con",
    "movement": {
      "walk": 30,
      "fly": "",
      "swim": "",
      "climb": ""
    },
    "senses": "darkvision 18, tremorsense 9",
    "languages": "comprende il Comune ma non parla",
    "conditionImmunities": ["poisoned", "frightened", "exhaustion"],
    "skills": {
      "prc": { "value": 1 },
      "ath": { "value": 2 }
    },
    "abilities": {
      "str": { "value": 20 },
      "dex": { "value": 8 },
      "con": { "value": 20 },
      "int": { "value": 6 },
      "wis": { "value": 12 },
      "cha": { "value": 8 }
    },
    "abilitiesList": [
      {
        "id": "pugno-pesante",
        "name": "Pugno Pesante",
        "kind": "attack",
        "type": "weapon",
        "section": "action",
        "activation": "action",
        "icon": "fa-hand-fist",
        "description": "Il guardiano colpisce con un pugno metallico.",
        "range": "10",
        "attackAbility": "str",
        "attackBonusExtra": "",
        "damageParts": [
          { "formula": "2d10 + 5", "type": "bludgeoning", "magic": true }
        ],
        "rider": {
          "alwaysConditions": [],
          "failConditions": ["prone"],
          "saveAbility": "str",
          "saveDc": "16",
          "successMode": "negates",
          "failDamageParts": [],
          "advancedEffects": [],
          "notes": ""
        }
      },
      {
        "id": "scarica-elettrica",
        "name": "Scarica Elettrica",
        "kind": "save",
        "type": "feat",
        "section": "action",
        "activation": "action",
        "icon": "fa-bolt",
        "description": "Il guardiano rilascia energia elettrica in linea retta.",
        "range": "18",
        "recharge": "5",
        "saveAbility": "dex",
        "saveDc": "16",
        "targetTemplateType": "line",
        "targetTemplateSize": "18",
        "targetTemplateWidth": "5",
        "damageParts": [
          { "formula": "6d6", "type": "lightning" }
        ],
        "rider": {
          "alwaysConditions": [],
          "failConditions": ["stunned"],
          "successMode": "half",
          "failDamageParts": [],
          "advancedEffects": [
            {
              "id": "minus-3-ac-next-turn",
              "name": "-3 CA",
              "timing": "failedSave",
              "kind": "effect",
              "duration": { "rounds": 1, "turns": 1 },
              "changes": [
                { "key": "system.attributes.ac.bonus", "mode": 2, "value": "-3", "priority": 20 }
              ]
            }
          ],
          "notes": ""
        }
      }
    ]
  }
}
```

## Checklist per AI esterne

Quando generi un mostro:

1. Genera `id` slug stabile.
2. Compila `name`, `image`, `tokenImage`, `category`, `details`.
3. Compila `foundry.ac`, `foundry.hp`, `foundry.cr`, `foundry.size`, `foundry.abilities`.
4. Usa `foundry.spellcastingAbility` se ci sono CD TS calcolabili.
5. Usa `damageParts` per ogni abilita con danni.
6. Usa `recharge` esplicito se l'abilita si ricarica.
7. Usa `rider` per condizioni, TS secondari e automazioni custom.
8. Usa `targetTemplateType` e `targetTemplateSize` sulle abilita TS ad area.
9. Usa `foundryName` se la creatura deve essere trovata dal modulo Foundry cliccando il token.
10. Non usare campi inventati se non servono: il sito li conserva in parte, ma l'editor potrebbe non mostrarli.

## Note di manutenzione

Aggiornare questo documento quando cambiano:

- campi della sezione `Mostro Foundry`;
- valori ammessi di `kind`, `section`, `activation`, `recharge`;
- struttura di `damageParts`;
- struttura di `rider`;
- template e logica degli advanced effects;
- mapping export Foundry v12;
- logica import JSON del bestiario.
