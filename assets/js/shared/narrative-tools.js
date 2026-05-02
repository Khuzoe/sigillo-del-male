(function () {
    const MOJIBAKE_FIXES = [
        ['Ã ', 'à'],
        ['Ã¨', 'è'],
        ['Ã©', 'é'],
        ['Ã¬', 'ì'],
        ['Ã²', 'ò'],
        ['Ã¹', 'ù'],
        ['Ã€', 'À'],
        ['Ãˆ', 'È'],
        ['Ã‰', 'É'],
        ['ÃŒ', 'Ì'],
        ['Ã’', 'Ò'],
        ['Ã™', 'Ù'],
        ['Ã—', '×'],
        ['Ãˆ', 'È'],
        ['Ã‰', 'É'],
        ['Ãˆ', 'È'],
        ['Ã', 'à'],
        ['â€”', '—'],
        ['â€“', '–'],
        ['â€˜', "'"],
        ['â€™', "'"],
        ['â€œ', '"'],
        ['â€', '"'],
        ['â€"', '"'],
        ['â€¦', '...'],
        ['Â°', '°'],
        ['Â', ''],
        ['�', '']
    ];

    const LOCATION_DEFS = [
        { id: 'ingresso', label: 'Ingresso della Cripta', terms: ['porta d ingresso', 'porta d\'ingresso', 'ingresso della cripta', 'ingresso'] },
        { id: 'primo-piano', label: 'Primo Piano', terms: ['primo piano', 'primo livello'] },
        { id: 'secondo-piano', label: 'Secondo Piano', terms: ['secondo piano', 'secondo livello'] },
        { id: 'terzo-piano', label: 'Terzo Piano', terms: ['terzo piano', 'terzo livello'] },
        { id: 'stanza-rabber', label: 'Stanza di Rabber', terms: ['stanza di rabberduscolanderson', 'stanza di rabber', 'stanza di rabberduscolanderson'] },
        { id: 'stanza-karla', label: 'Sala di Karla', terms: ['da karla', 'stanza di karla', 'sala di karla'] },
        { id: 'laboratorio-franky', label: 'Laboratorio di Franky', terms: ['laboratorio di franky', 'laboratorio macabro'] },
        { id: 'laboratorio-nino', label: 'Laboratorio di Nino', terms: ['laboratorio di nino', 'studio di nino', 'studio, dove trovate'] },
        { id: 'giardino-albert', label: 'Giardino di Albert', terms: ['giardino di albert', 'giardino di fiori', 'fiori di albert'] },
        { id: 'zona-sud', label: 'Zona Sud', terms: ['zona sud', 'parte sud', 'verso sud'] },
        { id: 'zona-nord', label: 'Zona Nord', terms: ['zona nord', 'piu a nord', 'più a nord', 'verso nord'] },
        { id: 'stanzino-bracieri', label: 'Stanza dei Bracieri', terms: ['stanza con i bracieri', 'bracieri'] },
        { id: 'corridoio-ragnatele', label: 'Corridoio delle Ragnatele', terms: ['lungo corridoio', 'ragnatele sulle pareti', 'corridoio'] },
        { id: 'caverna-fangosa', label: 'Caverna Fangosa', terms: ['caverna fangosa', 'tunnel', 'struttura diventa una sorta di caverna'] }
    ];

    const OBJECT_DEFS = [
        { id: 'cuori', label: 'Cuori Arcani', terms: ['cuore', 'cuori', 'batteria arcana'] },
        { id: 'libri-documenti', label: 'Libri e Documenti', terms: ['libro', 'libri', 'documenti', 'fascicoli'] },
        { id: 'pergamene', label: 'Pergamene', terms: ['pergamena', 'pergamene'] },
        { id: 'sigillo', label: 'Sigillo Von T', terms: ['sigillo'] },
        { id: 'prisma', label: 'Prisma di Luce', terms: ['prisma di luce', 'prisma'] },
        { id: 'anelli-amuleti', label: 'Anelli e Amuleti', terms: ['anello', 'amuleto', 'medaglione', 'ciondolo', 'collana', 'bracciale', 'spilla', 'specchio'] },
        { id: 'pozioni-sieri', label: 'Pozioni e Sieri', terms: ['pozione', 'pozioni', 'siero', 'sieri'] },
        { id: 'ritratti', label: 'Ritratti e Targhette', terms: ['ritratto', 'ritratti', 'targhetta', 'targhette', 'portafoto'] }
    ];

    const REVELATION_DEFS = [
        { id: 'visioni', label: 'Visioni', terms: ['visione', 'visioni'] },
        { id: 'incubi', label: 'Incubi', terms: ['incubo', 'incubi'] },
        { id: 'rituali', label: 'Rituali', terms: ['rituale', 'rituali'] },
        { id: 'linee-realta', label: 'Linee della Realtà', terms: ['linea vicina', 'linea reale', 'repliche'] },
        { id: 'origine-von-t', label: 'Segreti Von T', terms: ['von t', 'stirpe', 'ultima foglia'] },
        { id: 'ritorno-tempo', label: 'Ritorno nel Tempo', terms: ['tornare indietro nel tempo', 'ritorno nel tempo'] },
        { id: 'trasmutazioni', label: 'Trasmutazioni', terms: ['tramutazione', 'non morto', 'alambicco vivente'] }
    ];

    const FAMILY_DEFS = [
        { id: 'von-t', label: 'Famiglia Von T', terms: ['von t', 'stirpe von t'] },
        { id: 'klaren', label: 'Klaren', terms: ['klaren', 'abrak'] }
    ];

    const BOSS_DEFS = [
        { id: 'karla', label: 'Karla', terms: ['karla'] },
        { id: 'zara', label: 'Zara', terms: ['zara', 'giullare'] },
        { id: 'nino', label: 'Nino Olegna', terms: ['nino olegna'] },
        { id: 'franky', label: 'Franky', terms: ['franky'] },
        { id: 'deborah', label: 'Deborah', terms: ['deborah'] },
        { id: 'gianni', label: 'Gianni', terms: ['gianni'] },
        { id: 'assistente', label: 'Assistente', terms: ['assistente', 'bacio mortale'] },
        { id: 'gigante', label: 'Giganti', terms: ['gigante', 'gargantuesca'] }
    ];

    function repairMojibake(value) {
        if (typeof value !== 'string') return value;
        let text = value;
        MOJIBAKE_FIXES.forEach(([from, to]) => {
            text = text.split(from).join(to);
        });
        return text;
    }

    function normalizeDeep(input) {
        if (typeof input === 'string') return repairMojibake(input);
        if (Array.isArray(input)) return input.map(normalizeDeep);
        if (!input || typeof input !== 'object') return input;

        const output = {};
        Object.keys(input).forEach((key) => {
            output[key] = normalizeDeep(input[key]);
        });
        return output;
    }

    function stripHtml(value) {
        const text = repairMojibake(String(value || ''));
        return text
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeText(value) {
        return stripHtml(value)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function uniqueBy(items, keyFn) {
        const seen = new Set();
        return items.filter((item) => {
            const key = keyFn(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function makeCharacterUrl(record) {
        if (!record || !record.id) return '';
        return record.type === 'player'
            ? `pages/characters/character.html?id=${record.id}&type=player`
            : `pages/characters/character.html?id=${record.id}`;
    }

    function deriveAliases(record) {
        const rawAliases = Array.isArray(record.aliases) ? record.aliases : [];
        const baseNames = [record.name, record.title, record.entityId, record.id]
            .filter(Boolean)
            .map((value) => String(value).replace(/[_-]+/g, ' '));
        const firstTokens = baseNames
            .map((value) => value.split(' ')[0])
            .filter(Boolean);
        const withoutSuffix = baseNames
            .map((value) => value.replace(/\bVon T\b/gi, '').trim())
            .filter(Boolean);

        return uniqueBy(
            [...rawAliases, ...baseNames, ...firstTokens, ...withoutSuffix]
                .map((value) => repairMojibake(String(value || '')).trim())
                .filter(Boolean),
            (value) => normalizeText(value)
        );
    }

    function buildEntityRecords(items) {
        const normalizedItems = normalizeDeep(Array.isArray(items) ? items : []);
        return normalizedItems
            .filter((item) => item && (item.id || item.entityId || item.title || item.name))
            .map((item) => {
                const id = item.id || item.entityId;
                const type = item.type || 'npc';
                const name = item.name || item.title || id;
                return {
                    id,
                    type,
                    name,
                    role: item.role || item.subtitle || '',
                    url: item.url || makeCharacterUrl({ id, type }),
                    images: item.images || {},
                    aliases: deriveAliases({
                        id,
                        entityId: item.entityId || id,
                        name,
                        title: item.title,
                        aliases: item.aliases
                    })
                };
            });
    }

    function hasAliasMatch(normalizedTextValue, rawTextValue, alias) {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias) return false;

        if (normalizedAlias.length === 1) {
            const exact = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(alias)}(?=[^A-Za-z0-9]|$)`, 'i');
            return exact.test(rawTextValue);
        }

        const pattern = `(^|[^a-z0-9])${escapeRegex(normalizedAlias).replace(/\s+/g, '\\s+')}(?=[^a-z0-9]|$)`;
        return new RegExp(pattern, 'i').test(normalizedTextValue);
    }

    function detectEntityMentions(summaryText, entities) {
        const rawText = repairMojibake(String(summaryText || ''));
        const normalizedValue = normalizeText(rawText);

        return entities
            .map((entity) => {
                const matchedAlias = (entity.aliases || []).find((alias) => hasAliasMatch(normalizedValue, rawText, alias));
                if (!matchedAlias) return null;
                return {
                    id: entity.id,
                    label: entity.name,
                    url: entity.url,
                    role: entity.role,
                    type: entity.type,
                    matchedAlias
                };
            })
            .filter(Boolean);
    }

    function collectCatalogMatches(text, defs, category) {
        const normalizedValue = normalizeText(text);
        return defs
            .filter((entry) => entry.terms.some((term) => hasAliasMatch(normalizedValue, text, term)))
            .map((entry) => ({
                id: entry.id,
                label: entry.label,
                category
            }));
    }

    function flattenQuestItems(quests) {
        const output = [];
        (Array.isArray(quests) ? quests : []).forEach((quest) => {
            if (!quest) return;
            output.push(quest);
            if (Array.isArray(quest.subquests)) {
                output.push(...flattenQuestItems(quest.subquests));
            }
        });
        return output;
    }

    function buildSessionTagGroups(session, entities) {
        const summaryText = stripHtml(session.summary || '');
        const mentions = detectEntityMentions(summaryText, entities);

        const groups = {
            characters: uniqueBy(
                mentions.map((mention) => ({
                    id: mention.id,
                    label: mention.label,
                    url: mention.url,
                    category: 'characters'
                })),
                (item) => item.id
            ),
            locations: collectCatalogMatches(summaryText, LOCATION_DEFS, 'locations'),
            objects: collectCatalogMatches(summaryText, OBJECT_DEFS, 'objects'),
            revelations: collectCatalogMatches(summaryText, REVELATION_DEFS, 'revelations'),
            bosses: collectCatalogMatches(summaryText, BOSS_DEFS, 'bosses'),
            families: collectCatalogMatches(summaryText, FAMILY_DEFS, 'families')
        };

        if (Array.isArray(session.tags)) {
            session.tags.forEach((tag) => {
                const label = repairMojibake(String(tag || '').trim());
                if (!label) return;
                groups.revelations.push({
                    id: normalizeText(label).replace(/\s+/g, '-'),
                    label,
                    category: 'revelations'
                });
            });
        }

        Object.keys(groups).forEach((key) => {
            groups[key] = uniqueBy(groups[key], (item) => `${item.category}:${item.id}`);
        });

        return {
            summaryText,
            mentions,
            groups
        };
    }

    function enrichSessions(sessions, entities) {
        const normalizedSessions = normalizeDeep(Array.isArray(sessions) ? sessions : []);
        return normalizedSessions.map((session) => {
            const tagData = buildSessionTagGroups(session, entities);
            return {
                ...session,
                summaryText: tagData.summaryText,
                mentionDetails: tagData.mentions,
                entityIds: tagData.mentions.map((item) => item.id),
                tagGroups: tagData.groups
            };
        });
    }

    function aggregateTags(sessions, category, limit = 6) {
        const counts = new Map();
        (Array.isArray(sessions) ? sessions : []).forEach((session) => {
            (session.tagGroups?.[category] || []).forEach((tag) => {
                const key = `${tag.category}:${tag.id}`;
                const current = counts.get(key) || { ...tag, count: 0 };
                current.count += 1;
                counts.set(key, current);
            });
        });
        return [...counts.values()]
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'it'))
            .slice(0, limit);
    }

    function getRecentDiscoveries(sessions, limit = 4) {
        const recent = [...(Array.isArray(sessions) ? sessions : [])].sort((a, b) => b.id - a.id);
        const highlights = [];
        const cues = ['scoprite', 'capite', 'rivela', 'rivelando', 'visione', 'incubo', 'rituale'];

        recent.forEach((session) => {
            const sentences = stripHtml(session.summary || '')
                .split(/(?<=[.!?])\s+/)
                .map((sentence) => sentence.trim())
                .filter(Boolean);

            const match = sentences.find((sentence) => {
                const normalizedSentence = normalizeText(sentence);
                return cues.some((cue) => normalizedSentence.includes(cue));
            }) || sentences[0];

            if (!match) return;

            highlights.push({
                sessionId: session.id,
                text: match.length > 150 ? `${match.slice(0, 147)}...` : match
            });
        });

        return uniqueBy(highlights, (item) => item.text).slice(0, limit);
    }

    function getActiveQuestThreads(questGroups, limit = 5) {
        const groups = normalizeDeep(Array.isArray(questGroups) ? questGroups : []);
        const items = [];

        groups.forEach((group) => {
            flattenQuestItems(group.quests).forEach((quest) => {
                if (!quest || (quest.status !== 'active' && quest.status !== 'in_progress')) return;
                items.push({
                    groupId: group.id,
                    groupTitle: group.title,
                    title: quest.title,
                    rewards: quest.rewards || ''
                });
            });
        });

        return items.slice(0, limit);
    }

    function buildCharacterHub(character, sessions, entities, questGroups) {
        const normalizedCharacter = normalizeDeep(character || {});
        const normalizedSessions = Array.isArray(sessions) ? sessions : [];
        const normalizedEntities = Array.isArray(entities) ? entities : [];
        const normalizedQuestGroups = normalizeDeep(Array.isArray(questGroups) ? questGroups : []);
        const characterRecord = buildEntityRecords([normalizedCharacter])[0];

        if (!characterRecord) {
            return {
                mentionCount: 0,
                firstAppearance: null,
                lastAppearance: null,
                keySessions: [],
                linkedQuests: [],
                locations: [],
                relatedCharacters: []
            };
        }

        const relatedSessionList = normalizedSessions.filter((session) => session.entityIds.includes(characterRecord.id));
        const firstAppearance = relatedSessionList.length > 0
            ? [...relatedSessionList].sort((a, b) => a.id - b.id)[0]
            : null;
        const lastAppearance = relatedSessionList.length > 0
            ? [...relatedSessionList].sort((a, b) => b.id - a.id)[0]
            : null;

        const keySessionIds = new Set();
        if (firstAppearance) keySessionIds.add(firstAppearance.id);
        if (lastAppearance) keySessionIds.add(lastAppearance.id);
        relatedSessionList
            .slice()
            .sort((a, b) => b.id - a.id)
            .slice(0, 4)
            .forEach((session) => keySessionIds.add(session.id));

        const keySessions = [...keySessionIds]
            .map((sessionId) => relatedSessionList.find((session) => session.id === sessionId))
            .filter(Boolean)
            .sort((a, b) => a.id - b.id)
            .map((session) => ({
                id: session.id,
                date: session.date,
                summaryText: session.summaryText
            }));

        const linkedQuests = normalizedQuestGroups
            .map((group) => {
                const questMatches = flattenQuestItems(group.quests).filter((quest) => {
                    if (!quest || quest.status === 'hidden') return false;
                    if (group.npc_id === characterRecord.id) return true;
                    const haystack = [quest.title, quest.rewards, group.title].filter(Boolean).join(' ');
                    return (characterRecord.aliases || []).some((alias) => hasAliasMatch(normalizeText(haystack), haystack, alias));
                });
                if (questMatches.length === 0) return null;
                return {
                    id: group.id,
                    title: group.title,
                    url: 'pages/missioni.html',
                    quests: uniqueBy(
                        questMatches.map((quest) => ({
                            title: quest.title,
                            status: quest.status || 'active'
                        })),
                        (quest) => `${quest.title}:${quest.status}`
                    )
                };
            })
            .filter(Boolean);

        const locationCounts = aggregateTags(relatedSessionList, 'locations', 6);

        const explicitRelationships = new Map();
        (Array.isArray(normalizedCharacter.relationships) ? normalizedCharacter.relationships : []).forEach((relationship) => {
            if (!relationship || !relationship.id) return;
            explicitRelationships.set(relationship.id, relationship.description || 'Legame noto');
        });

        const cooccurrence = new Map();
        relatedSessionList.forEach((session) => {
            session.mentionDetails.forEach((mention) => {
                if (!mention || mention.id === characterRecord.id) return;
                const current = cooccurrence.get(mention.id) || { count: 0, record: null };
                current.count += 1;
                current.record = normalizedEntities.find((entity) => entity.id === mention.id) || current.record;
                cooccurrence.set(mention.id, current);
            });
        });

        explicitRelationships.forEach((description, relatedId) => {
            if (!cooccurrence.has(relatedId)) {
                cooccurrence.set(relatedId, {
                    count: 0,
                    record: normalizedEntities.find((entity) => entity.id === relatedId) || null
                });
            }
        });

        const relatedCharacters = [...cooccurrence.entries()]
            .map(([relatedId, meta]) => {
                const record = meta.record;
                if (!record) return null;
                return {
                    id: relatedId,
                    name: record.name,
                    role: record.role,
                    url: record.url || makeCharacterUrl(record),
                    count: meta.count,
                    basis: explicitRelationships.has(relatedId) ? 'relationship' : 'cooccurrence',
                    description: explicitRelationships.get(relatedId) || `${meta.count} sessioni condivise`
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (a.basis !== b.basis) return a.basis === 'relationship' ? -1 : 1;
                if (a.count !== b.count) return b.count - a.count;
                return a.name.localeCompare(b.name, 'it');
            })
            .slice(0, 6);

        return {
            mentionCount: relatedSessionList.length,
            firstAppearance,
            lastAppearance,
            keySessions,
            linkedQuests,
            locations: locationCounts,
            relatedCharacters
        };
    }

    window.CriptaNarrative = {
        repairMojibake,
        normalizeDeep,
        stripHtml,
        normalizeText,
        buildEntityRecords,
        enrichSessions,
        aggregateTags,
        getRecentDiscoveries,
        getActiveQuestThreads,
        buildCharacterHub
    };
})();
