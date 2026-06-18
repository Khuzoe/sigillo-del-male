(function () {
    let runtime = {};
    let ABILITY_DAMAGE_TYPE_OPTIONS = [];
    let CONDITION_IMMUNITY_OPTIONS = [];

    function applyRuntime(context = {}) {
        runtime = context || {};
        ABILITY_DAMAGE_TYPE_OPTIONS = Array.isArray(runtime.ABILITY_DAMAGE_TYPE_OPTIONS) ? runtime.ABILITY_DAMAGE_TYPE_OPTIONS : [];
        CONDITION_IMMUNITY_OPTIONS = Array.isArray(runtime.CONDITION_IMMUNITY_OPTIONS) ? runtime.CONDITION_IMMUNITY_OPTIONS : [];
    }

    function callRuntime(name, ...args) {
        const fn = runtime[name];
        if (typeof fn !== 'function') throw new Error(`Funzione export Foundry non disponibile: ${name}`);
        return fn(...args);
    }

    function ensureFoundryMonsterData(...args) { return callRuntime('ensureFoundryMonsterData', ...args); }
    function getMonsterAbilities(...args) { return callRuntime('getMonsterAbilities', ...args); }
    function resolveImageUrl(...args) { return callRuntime('resolveImageUrl', ...args); }
    function normalizeFoundryAbilities(...args) { return callRuntime('normalizeFoundryAbilities', ...args); }
    function toLeadingNumberOrNull(...args) { return callRuntime('toLeadingNumberOrNull', ...args); }
    function toNumberOrNull(...args) { return callRuntime('toNumberOrNull', ...args); }
    function normalizeFoundryMovement(...args) { return callRuntime('normalizeFoundryMovement', ...args); }
    function normalizeFoundrySenses(...args) { return callRuntime('normalizeFoundrySenses', ...args); }
    function mapWikiTypeToFoundry(...args) { return callRuntime('mapWikiTypeToFoundry', ...args); }
    function toNumberOrString(...args) { return callRuntime('toNumberOrString', ...args); }
    function parseCsvLower(...args) { return callRuntime('parseCsvLower', ...args); }
    function normalizeDamageTypes(...args) { return callRuntime('normalizeDamageTypes', ...args); }
    function buildFoundryResource(...args) { return callRuntime('buildFoundryResource', ...args); }
    function normalizeFoundrySkills(...args) { return callRuntime('normalizeFoundrySkills', ...args); }
    function tokenSizeForFoundrySize(...args) { return callRuntime('tokenSizeForFoundrySize', ...args); }
    function foundryItemTypeForAbilityRuntime(...args) { return callRuntime('foundryItemTypeForAbility', ...args); }
    function getAbilityRider(...args) { return callRuntime('getAbilityRider', ...args); }
    function getAbilityDamageParts(...args) { return callRuntime('getAbilityDamageParts', ...args); }
    function getAbilityRiderDamageParts(...args) { return callRuntime('getAbilityRiderDamageParts', ...args); }
    function foundryIconFromFa(...args) { return callRuntime('foundryIconFromFa', ...args); }
    function inferAbilityKind(...args) { return callRuntime('inferAbilityKind', ...args); }
    function activationFromSection(...args) { return callRuntime('activationFromSection', ...args); }
    function parseRangeValue(...args) { return callRuntime('parseRangeValue', ...args); }
    function parseRangeUnits(...args) { return callRuntime('parseRangeUnits', ...args); }
    function buildFoundryItemUses(...args) { return callRuntime('buildFoundryItemUses', ...args); }
    function normalizeConditionImmunities(...args) { return callRuntime('normalizeConditionImmunities', ...args); }
    function getAbilityRechargeValue(...args) { return callRuntime('getAbilityRechargeValue', ...args); }
    function inferActionType(...args) { return callRuntime('inferActionType', ...args); }
    function isAttackAbility(...args) { return callRuntime('isAttackAbility', ...args); }
    function isRangedAttackAbility(...args) { return callRuntime('isRangedAttackAbility', ...args); }
    function getPrimaryAbilityDamageType(...args) { return callRuntime('getPrimaryAbilityDamageType', ...args); }
    function isPhysicalAbilityDamageType(...args) { return callRuntime('isPhysicalAbilityDamageType', ...args); }
    function getFoundryProficiency(...args) { return callRuntime('getFoundryProficiency', ...args); }
    function slugify(...args) { return callRuntime('slugify', ...args); }
    function escapeHtml(...args) { return callRuntime('escapeHtml', ...args); }
    function rechargeLabel(...args) { return callRuntime('rechargeLabel', ...args); }
    function conditionLabel(...args) { return callRuntime('conditionLabel', ...args); }
    function abilityLabel(...args) { return callRuntime('abilityLabel', ...args); }

function buildFoundryActorExport(creature) {
    const foundry = ensureFoundryMonsterData(creature);
    const abilities = getMonsterAbilities(creature);
    const damageAbsorptions = getFoundryPassiveAbsorptions(abilities);
    const damageAbsorptionSet = new Set(damageAbsorptions);
    const damageImmunities = Array.from(new Set([
        ...normalizeDamageTypes(creature.details?.immunities),
        ...damageAbsorptions
    ]));
    return {
        name: creature.name || "Creatura",
        type: "npc",
        img: resolveImageUrl(creature.image),
        system: {
            abilities: normalizeFoundryAbilities(foundry.abilities),
            attributes: {
                ac: { flat: toLeadingNumberOrNull(foundry.ac), calc: "flat" },
                hp: {
                    value: toNumberOrNull(foundry.hp?.value) || 1,
                    max: toNumberOrNull(foundry.hp?.value) || 1,
                    formula: String(foundry.hp?.formula || "")
                },
                movement: normalizeFoundryMovement(foundry.movement),
                senses: normalizeFoundrySenses(foundry.senses),
                prof: getFoundryProficiency(foundry)
            },
            details: {
                type: { value: mapWikiTypeToFoundry(creature.details?.dndType), subtype: "", swarm: "", custom: creature.details?.dndType || "" },
                cr: toNumberOrString(foundry.cr),
                source: "Sigillo del Male Wiki",
                biography: { value: creature.details?.description || "" }
            },
            traits: {
                size: foundry.size || mapWikiSizeToFoundry(creature.details?.size),
                languages: { value: parseCsvLower(foundry.languages), custom: foundry.languages || "" },
                di: { value: damageImmunities, custom: "" },
                dr: { value: normalizeDamageTypes(creature.details?.resistances).filter((type) => !damageAbsorptionSet.has(type)), custom: "" },
                dv: { value: normalizeDamageTypes(creature.details?.vulnerabilities).filter((type) => !damageAbsorptionSet.has(type)), custom: "" },
                da: { value: [], custom: "", bypasses: [] },
                ci: { value: normalizeConditionImmunities(foundry.conditionImmunities), custom: "" }
            },
            resources: {
                legact: buildFoundryResource(foundry.legendaryActions),
                legres: buildFoundryResource(foundry.legendaryResistances)
            },
            skills: normalizeFoundrySkills(foundry.skills)
        },
        prototypeToken: {
            name: creature.name || "Creatura",
            displayName: 20,
            displayBars: 20,
            width: tokenSizeForFoundrySize(foundry.size),
            height: tokenSizeForFoundrySize(foundry.size),
            texture: { src: resolveImageUrl(creature.tokenImage || creature.image) },
            actorLink: false
        },
        items: abilities.map((ability) => buildFoundryItemFromAbilityV4(ability, foundry)),
        effects: [],
        flags: buildFoundryActorFlags(foundry.flags, damageAbsorptions)
    };
}

function getFoundryPassiveAbsorptions(abilities) {
    return (Array.isArray(abilities) ? abilities : [])
        .map((ability) => buildFoundryWikiPassiveFlags(ability))
        .filter((passive) => passive.enabled && passive.id === "absorption" && passive.value)
        .map((passive) => passive.value)
        .filter((value, index, list) => list.indexOf(value) === index);
}

function buildFoundryActorFlags(flags = {}, damageAbsorptions = []) {
    const wikiFlags = flags["cripta-wiki-sync"] && typeof flags["cripta-wiki-sync"] === "object"
        ? flags["cripta-wiki-sync"]
        : {};
    return {
        ...flags,
        "cripta-wiki-sync": {
            ...wikiFlags,
            damageAbsorptions
        }
    };
}

function buildFoundryItemFromAbilityV4(ability, foundry = {}) {
    const type = foundryItemTypeForAbility(ability);
    const rider = getAbilityRider(ability);
    const effects = buildFoundryPassiveEffects(ability, foundry);
    const system = {
        description: { value: buildFoundryAbilityDescription(ability, foundry), chat: "" },
        source: { custom: "Sigillo del Male Wiki", revision: 1, rules: "2024" },
        uses: buildFoundryItemUses(ability),
        activities: buildFoundryActivitiesForAbility(ability, foundry, type, effects),
        identifier: "",
        requirements: "",
        type: foundryItemSubtypeForAbility(ability, type)
    };

    if (type === "weapon") {
        const damageParts = getAbilityDamageParts(ability).filter((part) => part.formula);
        system.quantity = 1;
        system.weight = { value: 0, units: "lb" };
        system.price = { value: 0, denomination: "gp" };
        system.attunement = "";
        system.equipped = true;
        system.rarity = "";
        system.identified = true;
        system.range = buildFoundryWeaponRange(ability);
        system.damage = {
            base: damageFormulaToDnd5ePart(
                damageParts[0]?.formula || ability.damageFormula || "",
                damageParts[0]?.type || getPrimaryAbilityDamageType(ability),
                shouldStripAbilityDamageBonus(ability)
            ),
            versatile: {
                number: null,
                denomination: null,
                types: [],
                custom: { enabled: false },
                scaling: { number: 1 }
            }
        };
        system.unidentified = { description: "" };
        system.container = null;
        system.attuned = false;
        system.cover = null;
        system.crewed = false;
        system.ammunition = {};
        system.armor = { value: null };
        system.magicalBonus = null;
        system.properties = hasMagicalAbilityDamage(ability) ? ["mgc"] : [];
        system.proficient = true;
        system.weaponType = "natural";
        system.actionType = inferActionType(ability);
        system.attackBonus = ability.attackBonus || "";
    } else {
        system.activation = { type: ability.activation || activationFromSection(ability.section), cost: 1, condition: "" };
        system.target = { value: null, width: null, units: "", type: ability.target || "" };
        system.range = { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) };
        system.consume = { type: "", target: "", amount: null };
        system.actionType = inferActionType(ability);
        system.attackBonus = ability.attackBonus || "";
        system.damage = {
            parts: buildFoundryDamageParts(ability),
            versatile: ""
        };
        system.save = {
            ability: ability.saveAbility || rider.saveAbility || "",
            dc: toNumberOrNull(ability.saveDc || rider.saveDc || calculateFoundrySpellSaveDc(foundry)),
            scaling: "flat"
        };
        system.advancement = [];
        system.cover = null;
        system.crewed = false;
        system.enchant = {};
        system.prerequisites = { level: null, repeatable: false };
        system.properties = [];
    }

    return {
        name: ability.name || "Abilita",
        type,
        img: ability.iconImage ? resolveImageUrl(ability.iconImage) : foundryIconFromFa(ability.icon),
        system,
        effects,
        flags: {
            "midi-qol": {},
            dae: {},
            dnd5e: { persistSourceMigration: true },
            "cripta-wiki-sync": {
                riders: buildFoundryWikiRiderFlags(ability),
                passive: buildFoundryWikiPassiveFlags(ability)
            },
            ...(ability.flags || {})
        }
    };
}

function buildFoundryWikiPassiveFlags(ability) {
    const passive = ability.passive && typeof ability.passive === "object" ? ability.passive : {};
    const id = String(passive.id || "").trim();
    if (!id) return { enabled: false };
    return {
        enabled: true,
        id,
        automation: passive.automation || "manual",
        value: String(ability.passiveValue || "").trim(),
        valueLabel: ability.passiveValueLabel || passive.valueLabel || "",
        breakDamageTypes: normalizeDamageTypes(ability.passiveBreakDamageTypes)
    };
}

function buildFoundryPassiveEffects(ability, foundry = {}) {
    const passive = buildFoundryWikiPassiveFlags(ability);
    if (!passive.enabled) return [];
    if (passive.id === "magic-resistance") {
        return [buildFoundryTransferEffect("Magic Resistance", "icons/magic/defensive/shield-barrier-glowing-blue.webp", [
            {
                key: "flags.midi-qol.magicResistance.all",
                mode: 0,
                value: "1",
                priority: 20
            }
        ])];
    }
    if (passive.id === "enlarge") {
        const changes = [
            {
                key: "system.traits.size",
                mode: 5,
                value: nextFoundrySize(foundry.size),
                priority: 20
            }
        ];
        if (passive.value) {
            changes.push(
                { key: "system.bonuses.mwak.damage", mode: 2, value: passive.value, priority: 20 },
                { key: "system.bonuses.rwak.damage", mode: 2, value: passive.value, priority: 20 }
            );
        }
        return [buildFoundryTemporaryEffect("Enlarge", "icons/magic/control/buff-strength-muscle-damage.webp", changes, {
            seconds: 60,
            rounds: 10
        })];
    }
    if (passive.id === "absorption" && passive.value) {
        return [];
    }
    return [];
}

function nextFoundrySize(size) {
    const order = ["tiny", "sm", "med", "lg", "huge", "grg"];
    const index = order.indexOf(size || "med");
    return order[Math.min(order.length - 1, Math.max(0, index) + 1)] || "lg";
}

function buildFoundryTemporaryEffect(name, img, changes, duration = {}) {
    return {
        ...buildFoundryTransferEffect(name, img, changes),
        transfer: false,
        duration: {
            startTime: null,
            seconds: duration.seconds ?? null,
            combat: null,
            rounds: duration.rounds ?? null,
            turns: duration.turns ?? null,
            startRound: null,
            startTurn: null
        }
    };
}

function buildFoundryTransferEffect(name, img, changes) {
    return {
        _id: `effect${slugify(name).replace(/-/g, "").slice(0, 10).padEnd(10, "0")}`,
        name,
        img,
        origin: null,
        disabled: false,
        transfer: true,
        description: "",
        tint: "#ffffff",
        statuses: [],
        changes,
        duration: { startTime: null, seconds: null, combat: null, rounds: null, turns: null, startRound: null, startTurn: null },
        flags: {
            dae: { showIcon: true, specialDuration: [] },
            "midi-qol": {},
            core: { overlay: false }
        },
        type: "base",
        system: {},
        sort: 0
    };
}

function buildFoundryWikiRiderFlags(ability) {
    const rider = getAbilityRider(ability);
    return {
        enabled: true,
        alwaysConditions: normalizeConditionImmunities(rider.alwaysConditions),
        failConditions: normalizeConditionImmunities(rider.failConditions),
        saveAbility: rider.saveAbility || "",
        saveDc: rider.saveDc || "",
        successMode: rider.successMode === "negates" ? "negates" : "half",
        failDamageParts: getAbilityRiderDamageParts(ability).filter((part) => part.formula),
        advancedEffects: normalizeAdvancedRiderEffects(rider.advancedEffects),
        notes: rider.notes || ""
    };
}

function normalizeAdvancedRiderEffects(effects) {
    return (Array.isArray(effects) ? effects : [])
        .map((effect) => ({
            id: slugify(effect?.id || effect?.name || "advanced-effect"),
            name: String(effect?.name || "Effetto avanzato"),
            timing: normalizeAdvancedEffectTiming(effect?.timing),
            kind: String(effect?.kind || "effect"),
            iconImage: effect?.iconImage || "",
            duration: effect?.duration || {},
            changes: normalizeAdvancedEffectChanges(effect),
            damage: effect?.damage || null,
            endsOnDamageType: effect?.endsOnDamageType || ""
        }));
}

function normalizeAdvancedEffectTiming(value) {
    const timing = String(value || "hit");
    return timing === "failedSave" || timing === "failed-save" ? "failed-save" : "hit";
}

function normalizeAdvancedEffectChanges(effect) {
    const id = String(effect?.id || "");
    return (Array.isArray(effect?.changes) ? effect.changes : []).map((change) => {
        const normalized = { ...change };
        const key = String(normalized.key || "");
        if (id === "half-speed" && key.startsWith("system.attributes.movement.") && String(normalized.value) === "0.5") {
            normalized.mode = 1;
        }
        return normalized;
    });
}

function buildFoundryItemFromAbility(ability, foundry = {}) {
    const type = foundryItemTypeForAbility(ability);
    const rider = getAbilityRider(ability);
    const description = buildFoundryAbilityDescription(ability, foundry);
    const item = {
        name: ability.name || "AbilitÃ ",
        type,
        img: ability.iconImage ? resolveImageUrl(ability.iconImage) : foundryIconFromFa(ability.icon),
        system: {
            description: { value: description, chat: "" },
            activation: { type: ability.activation || activationFromSection(ability.section), cost: 1, condition: "" },
            target: { value: null, width: null, units: "", type: ability.target || "" },
            range: { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) },
            uses: buildFoundryItemUses(ability),
            consume: { type: "", target: "", amount: null },
            actionType: inferActionType(ability),
            attackBonus: ability.attackBonus || "",
            damage: {
                parts: buildFoundryDamageParts(ability),
                versatile: ""
            },
            save: {
                ability: ability.saveAbility || rider.saveAbility || "",
                dc: toNumberOrNull(ability.saveDc || rider.saveDc || calculateFoundrySpellSaveDc(foundry)),
                scaling: "flat"
            },
            type: foundryItemSubtypeForAbility(ability, type),
            requirements: "",
            recharge: buildFoundryRecharge(ability)
        },
        effects: [],
        flags: ability.flags || {}
    };
    if (type === "weapon") {
        item.system.equipped = true;
        item.system.proficient = true;
        item.system.weaponType = "natural";
        item.system.properties = hasMagicalAbilityDamage(ability) ? ["mgc"] : [];
    }
    return item;
}

function foundryItemTypeForAbility(ability) {
    if (isAttackAbility(ability)) return "weapon";
    if ((ability.kind || inferAbilityKind(ability)) === "save") return "feat";
    return ability.type || "feat";
}

function foundryItemSubtypeForAbility(ability, itemType) {
    if (itemType === "weapon") return { value: "natural", baseItem: "" };
    return { value: "", subtype: "" };
}

function buildFoundryDamageParts(ability) {
    const parts = getAbilityDamageParts(ability)
        .filter((part) => part.formula)
        .map((part) => [part.formula, part.type || ""]);
    if (parts.length) return parts;
    return ability.damageFormula ? [[ability.damageFormula, getPrimaryAbilityDamageType(ability)]] : [];
}

function hasMagicalAbilityDamage(ability) {
    const allParts = [
        ...getAbilityDamageParts(ability),
        ...getAbilityRiderDamageParts(ability)
    ];
    return allParts.some((part) => part?.magic === true && isPhysicalAbilityDamageType(part.type));
}

function buildFoundryActivitiesForAbility(ability, foundry, itemType, effects) {
    if (itemType === "weapon") {
        const activities = { dnd5eactivity000: buildFoundryAttackActivity(ability, effects) };
        if (hasAbilitySaveRider(ability)) activities.dnd5eactivity001 = buildFoundrySaveActivity(ability, foundry, effects, "dnd5eactivity001", { includeBaseDamage: false });
        return activities;
    }
    if (ability.saveAbility || getAbilityRider(ability).saveAbility) return { dnd5eactivity000: buildFoundrySaveActivity(ability, foundry, effects) };
    return { dnd5eactivity000: buildFoundryUtilityActivity(ability, effects) };
}

function buildFoundryAttackActivity(ability, effects) {
    const ranged = isRangedAttackAbility(ability);
    const attackAbility = ability.attackAbility === "custom" ? "" : (ability.attackAbility || "str");
    const damageParts = getAbilityDamageParts(ability).filter((part) => part.formula);
    return {
        _id: "dnd5eactivity000",
        type: "attack",
        activation: buildFoundryActivityActivation(ability),
        consumption: buildFoundryActivityConsumption(ability),
        description: { chatFlavor: "" },
        duration: buildFoundryInstantDuration(),
        effects: [],
        range: { units: ranged ? "ft" : "self", special: "", override: false, ...(ranged ? { value: parseRangeValue(ability.range) || "" } : {}) },
        target: buildFoundrySingleCreatureTarget(),
        uses: { spent: 0, max: "", recovery: [] },
        attack: {
            ability: attackAbility,
            bonus: ability.attackAbility === "custom" ? (ability.attackBonus || "") : (ability.attackBonusExtra || ""),
            critical: { threshold: null },
            flat: ability.attackAbility === "custom",
            type: { value: ranged ? "ranged" : "melee", classification: "weapon" }
        },
        damage: {
            critical: { bonus: "" },
            includeBase: true,
            parts: damageParts.slice(1).map((part) => damageFormulaToDnd5ePart(part.formula, part.type, false))
        },
        sort: 0,
        ...foundryMidiActivityDefaults(),
        attackMode: "oneHanded",
        ammunition: "",
        otherActivityUuid: ""
    };
}

function buildFoundrySaveActivity(ability, foundry, effects, activityId = "dnd5eactivity000", options = {}) {
    const rider = getAbilityRider(ability);
    const damageParts = [
        ...(options.includeBaseDamage === false ? [] : getAbilityDamageParts(ability).filter((part) => part.formula)),
        ...getAbilityRiderDamageParts(ability).filter((part) => part.formula)
    ];
    return {
        _id: activityId,
        type: "save",
        activation: buildFoundryActivityActivation(ability),
        consumption: buildFoundryActivityConsumption(ability),
        description: { chatFlavor: "" },
        duration: buildFoundryInstantDuration(),
        effects: buildFoundrySaveActivityEffectRefs(effects),
        range: { value: parseRangeValue(ability.range) || "", units: parseRangeUnits(ability.range) || "ft", special: "", override: false },
        target: buildFoundryTargetForAbility(ability),
        uses: { spent: 0, max: "", recovery: [] },
        damage: {
            onSave: rider.successMode === "negates" ? "none" : "half",
            parts: damageParts.map((part) => damageFormulaToDnd5ePart(part.formula, part.type, false)),
            critical: { allow: false }
        },
        save: {
            ability: [ability.saveAbility || rider.saveAbility || "con"],
            dc: { calculation: "", formula: String(ability.saveDc || rider.saveDc || calculateFoundrySpellSaveDc(foundry)) }
        },
        sort: 0,
        ...foundryMidiActivityDefaults()
    };
}

function hasAbilitySaveRider(ability) {
    const rider = getAbilityRider(ability);
    return Boolean(
        rider.saveAbility
        || rider.saveDc
        || getAbilityRiderDamageParts(ability).some((part) => part.formula)
        || normalizeConditionImmunities(rider.failConditions).length
    );
}

function buildFoundryUtilityActivity(ability, effects) {
    return {
        _id: "dnd5eactivity000",
        type: "utility",
        activation: buildFoundryActivityActivation(ability),
        consumption: buildFoundryActivityConsumption(ability),
        description: { chatFlavor: "" },
        duration: buildFoundryInstantDuration(),
        effects: effects.map((effect) => ({ _id: effect._id })),
        range: { units: "self", special: "", override: false },
        target: buildFoundrySingleCreatureTarget(),
        uses: { spent: 0, max: "", recovery: [] },
        roll: { formula: "", name: "", prompt: false, visible: false },
        sort: 0,
        ...foundryMidiActivityDefaults(),
        otherActivityId: "none"
    };
}

function buildFoundrySaveActivityEffectRefs(effects) {
    return [];
}

function buildFoundryActivityActivation(ability) {
    const recharge = getAbilityRechargeValue(ability);
    return {
        type: ability.activation || activationFromSection(ability.section),
        value: 1,
        condition: recharge ? `Recharge ${rechargeLabel(recharge)}` : "",
        override: false
    };
}

function buildFoundryActivityConsumption(ability) {
    const recharge = getAbilityRechargeValue(ability);
    return {
        targets: recharge ? [{
            type: "itemUses",
            target: "",
            value: "1",
            scaling: { mode: "", formula: "" }
        }] : [],
        scaling: { allowed: false, max: "" },
        spellSlot: true
    };
}

function buildFoundryInstantDuration() {
    return {
        concentration: false,
        units: "inst",
        special: "",
        override: false
    };
}

function buildFoundrySingleCreatureTarget() {
    return {
        template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
        affects: { count: "1", type: "creature", choice: false, special: "" },
        prompt: true,
        override: false
    };
}

function buildFoundryTargetForAbility(ability) {
    const templateType = String(ability?.targetTemplateType || "").trim();
    if (!templateType) return buildFoundrySingleCreatureTarget();
    const size = parseRangeValue(ability.targetTemplateSize) || parseRangeValue(ability.range) || "";
    const width = templateType === "line" ? (parseRangeValue(ability.targetTemplateWidth) || 5) : "";
    return {
        template: {
            count: "",
            contiguous: false,
            type: templateType,
            size,
            width,
            height: "",
            units: parseRangeUnits(ability.targetTemplateSize || ability.range) || "ft"
        },
        affects: {
            count: "",
            type: "creature",
            choice: false,
            special: ability.target || ""
        },
        prompt: true,
        override: false
    };
}

function foundryMidiActivityDefaults() {
    return {
        useConditionText: "",
        useConditionReason: "",
        effectConditionText: "",
        macroData: { name: "", command: "" },
        ignoreTraits: { idi: false, idr: false, idv: false, ida: false },
        midiProperties: {
            ignoreTraits: [],
            triggeredActivityId: "none",
            triggeredActivityConditionText: "",
            triggeredActivityTargets: "targets",
            triggeredActivityRollAs: "self",
            forceDialog: false,
            confirmTargets: "default",
            autoTargetType: "any",
            autoTargetAction: "default",
            automationOnly: false,
            otherActivityCompatible: true,
            identifier: "",
            displayActivityName: false,
            rollMode: "default",
            chooseEffects: false,
            toggleEffect: false,
            ignoreFullCover: false
        },
        isOverTimeFlag: false,
        overTimeProperties: { saveRemoves: true, preRemoveConditionText: "", postRemoveConditionText: "" },
        otherActivityId: ""
    };
}

function buildFoundryItemEffectsForAbility(ability) {
    const rider = getAbilityRider(ability);
    const effects = [];
    const always = normalizeConditionImmunities(rider.alwaysConditions);
    always.forEach((condition) => {
        effects.push({ ...buildFoundryConditionEffect(`${ability.name || "Attacco"} ${conditionLabel(condition)}`, [condition], "Applied on hit."), _applyOn: "hit" });
    });
    const failed = normalizeConditionImmunities(rider.failConditions);
    failed.forEach((condition) => {
        effects.push({ ...buildFoundryConditionEffect(`${ability.name || "Effetto"} ${conditionLabel(condition)}`, [condition], "Applied on a failed save."), _applyOn: "failedSave" });
    });
    return effects.map((effect, index) => ({ ...effect, _id: `effect${String(index + 1).padStart(10, "0")}` }));
}

function stripFoundryInternalEffectMeta(effect) {
    const { _applyOn, ...cleanEffect } = effect;
    return cleanEffect;
}

function buildFoundryConditionEffect(name, statuses, description) {
    return {
        name,
        img: foundryEffectIconForConditions(statuses),
        origin: null,
        disabled: false,
        transfer: false,
        description,
        tint: "#ffffff",
        statuses,
        changes: buildFoundryConditionChanges(statuses),
        duration: {
            startTime: null,
            seconds: null,
            combat: null,
            rounds: null,
            turns: null,
            startRound: null,
            startTurn: null
        },
        flags: { dae: {}, "midi-qol": {} },
        type: "base",
        system: {},
        sort: 0
    };
}

function buildFoundryConditionChanges(statuses) {
    if (!statuses.includes("grappled")) return [];
    return ["walk", "fly", "swim", "climb", "burrow"].map((movement) => ({
        key: `system.attributes.movement.${movement}`,
        mode: 5,
        value: "0",
        priority: 20
    }));
}

function foundryEffectIconForConditions(statuses) {
    if (statuses.includes("grappled") || statuses.includes("restrained")) return "icons/svg/net.svg";
    if (statuses.includes("prone")) return "icons/svg/falling.svg";
    if (statuses.includes("poisoned")) return "icons/svg/poison.svg";
    if (statuses.includes("frightened")) return "icons/svg/terror.svg";
    return "icons/svg/aura.svg";
}

function damageFormulaToDnd5ePart(formula, type, stripStaticBonus = false) {
    const cleanFormula = String(formula || "").trim();
    const match = cleanFormula.match(/^(\d+)d(\d+)\s*([+-]\s*\d+)?$/i);
    if (match) {
        return {
            number: Number(match[1]),
            denomination: Number(match[2]),
            bonus: stripStaticBonus ? "" : (match[3] ? match[3].replace(/\s+/g, "") : ""),
            types: type ? [type] : [],
            custom: { enabled: false, formula: "" },
            scaling: { mode: "whole", number: null, formula: "" }
        };
    }
    return {
        number: null,
        denomination: null,
        bonus: "",
        types: type ? [type] : [],
        custom: { enabled: Boolean(cleanFormula), formula: cleanFormula },
        scaling: { mode: "whole", number: null, formula: "" }
    };
}

function shouldStripAbilityDamageBonus(ability) {
    return isAttackAbility(ability) && ability.attackAbility !== "custom";
}

function buildFoundryWeaponRange(ability) {
    if (isRangedAttackAbility(ability)) {
        return { value: parseRangeValue(ability.range), long: null, units: parseRangeUnits(ability.range) || "ft" };
    }
    return { value: null, long: null, units: "self", reach: parseRangeValue(ability.range) || 5 };
}

function calculateFoundrySpellSaveDc(foundry = {}) {
    const ability = foundry.spellcastingAbility || "cha";
    const score = Number(foundry.abilities?.[ability]?.value || 10);
    const modifier = Math.floor((score - 10) / 2);
    return 8 + getFoundryProficiency(foundry) + modifier;
}

function buildFoundryAbilityDescription(ability, foundry = {}) {
    const base = String(ability.description || "").trim();
    const rider = getAbilityRider(ability);
    const lines = [];
    const recharge = getAbilityRechargeValue(ability);
    if (recharge) lines.push(`Ricarica ${rechargeLabel(recharge)}.`);
    const passive = ability.passive && typeof ability.passive === "object" ? ability.passive : {};
    const passiveValue = String(ability.passiveValue || "").trim();
    const passiveValueLabel = ability.passiveValueLabel || passive.valueLabel || "";
    if (passiveValue && passiveValueLabel) {
        const displayValue = passive.id === "absorption"
            ? (ABILITY_DAMAGE_TYPE_OPTIONS.find(([value]) => value === passiveValue)?.[1] || passiveValue)
            : passiveValue;
        lines.push(`${passiveValueLabel}: ${displayValue}.`);
    }
    if (passive.id === "regeneration") {
        const breakTypes = normalizeDamageTypes(ability.passiveBreakDamageTypes);
        if (breakTypes.length) {
            lines.push(`Interrotta fino al prossimo turno da: ${breakTypes.map((type) => ABILITY_DAMAGE_TYPE_OPTIONS.find(([value]) => value === type)?.[1] || type).join(", ")}.`);
        }
    }
    const alwaysConditions = normalizeConditionImmunities(rider.alwaysConditions);
    if (alwaysConditions.length) {
        lines.push(`Condizioni applicate: ${alwaysConditions.map(conditionLabel).join(", ")}.`);
    }
    const failDamage = getAbilityRiderDamageParts(ability).filter((part) => part.formula);
    const failConditions = normalizeConditionImmunities(rider.failConditions);
    if (rider.saveAbility || rider.saveDc || failDamage.length || failConditions.length) {
        const dc = rider.saveDc || calculateFoundrySpellSaveDc(foundry);
        const saveText = rider.saveAbility || rider.saveDc ? `TS ${abilityLabel(rider.saveAbility)} CD ${dc}` : "TS";
        const effects = [
            failDamage.length ? `subisce ${failDamage.map(formatDamagePartLabel).join(" + ")}` : "",
            failConditions.length ? `riceve ${failConditions.map(conditionLabel).join(", ")}` : ""
        ].filter(Boolean).join(" e ");
        lines.push(`${saveText}: su fallimento ${effects || "si applica l'effetto descritto"}.`);
        if (rider.saveAbility || rider.saveDc || failDamage.length || failConditions.length) {
            const successMode = rider.successMode === "negates" ? "negates" : "half";
            const successEffects = [
                successMode === "half" && failDamage.length ? "dimezza i danni" : "annulla i danni e gli effetti da fallimento",
            ].filter(Boolean).join(" e ");
            lines.push(`Successo: ${successEffects}.`);
        }
    }
    if (rider.notes) lines.push(String(rider.notes).trim());
    if (!lines.length) return base;
    return [base, `<hr><p><strong>Effetti aggiuntivi.</strong> ${escapeHtml(lines.join(" "))}</p>`].filter(Boolean).join("\n");
}

function formatDamagePartLabel(part) {
    const damageLabel = ABILITY_DAMAGE_TYPE_OPTIONS.find(([value]) => value === part.type)?.[1] || part.type || "danno";
    return `${part.formula} ${damageLabel}${part.magic ? " magico" : ""}`;
}

    function buildActorExport(creature, context = {}) {
        applyRuntime(context);
        return buildFoundryActorExport(creature);
    }

    window.CriptaBestiaryFoundryExport = Object.freeze({
        buildActorExport
    });
})();
