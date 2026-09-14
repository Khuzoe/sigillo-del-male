import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/shared/next-session.js', import.meta.url), 'utf8');
const exposedSource = source.replace('window.CriptaNextSession = {', `window.testPoll = {
    sessionApiService, readCachedPoll, writePollCache, invalidatePollCache, getPollSlotKey,
    buildCrossCampaignHints, loadCrossCampaignHints, postRemoteVote, postRemoteSessionConfig,
    computeTotals, buildPollMarkup, sanitizeVotes, getNextVoteValue
}; window.CriptaNextSession = {`);
const copy = (value) => JSON.parse(JSON.stringify(value));
const identity = { accountId: 'alice', discordId: '100001' };
const slot = (id = 'lun-14-set-2030', time = '20:30 - 23:30') => ({ id, label: 'Lun 14 Set', time });
const config = (campaignId = 'main', options = [slot()]) => ({
    campaignId, number: 7, createdAt: '2026-09-01T12:00:00Z', availabilityOptions: options
});
const ownVote = (selections = { 'lun-14-set-2030': 'yes' }) => ({ ...identity, playerId: 'hero', name: 'Hero', selections });

function createHarness({ storage = new Map(), request = async () => ({}), data = {}, now = Date.parse('2026-09-14T12:00:00Z') } = {}) {
    let time = now;
    class TestDate extends Date {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
    }
    const window = {
        sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
        CriptaApp: {
            campaigns: { currentId: () => 'main' },
            utils: { escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') },
            api: { request },
            urls: { globalData: (name) => `global/${name}`, data: (name, options = {}) => `${options.campaignId || 'main'}/${name}` },
            fetchJson: async (url) => {
                if (!(url in data)) throw new Error(`Missing fixture ${url}`);
                return copy(data[url]);
            }
        },
        location: { pathname: '/pages/sondaggio.html' }
    };
    const context = vm.createContext({ window, document: { body: { classList: { contains: () => true } } }, Date: TestDate, URL, console });
    vm.runInContext(exposedSource, context);
    return { api: window.testPoll, window, advance: (ms) => { time += ms; }, storage };
}

// A cold read is deduplicated, survives navigation, expires after two minutes and is campaign-scoped.
{
    const calls = [];
    const request = async (path, options) => { calls.push({ path, options }); return { votes: [] }; };
    const h = createHarness({ request });
    await Promise.all([h.api.sessionApiService.getVotes(7, 'a'), h.api.sessionApiService.getVotes(7, 'a')]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.query.campaign, 'a');
    assert.equal(calls[0].options.cache, false, 'Avoid layering the old cache over the new TTL');
    await h.api.sessionApiService.getVotes(7, 'b');
    await h.api.sessionApiService.getVotes(8, 'a');
    assert.equal(calls.length, 3);
    const nextPage = createHarness({ request, storage: h.storage });
    await nextPage.api.sessionApiService.getVotes(7, 'a');
    assert.equal(calls.length, 3);
    nextPage.advance(120001);
    await nextPage.api.sessionApiService.getVotes(7, 'a');
    assert.equal(calls.length, 4);
}

// Failed optional reads are throttled, and blocked browser storage still permits an in-memory cache.
{
    let reads = 0;
    const h = createHarness({ request: async () => { reads += 1; throw new Error('offline'); } });
    h.window.sessionStorage.getItem = () => { throw new Error('blocked'); };
    await assert.rejects(h.api.sessionApiService.getCurrentSession('a'));
    await assert.rejects(h.api.sessionApiService.getCurrentSession('a'));
    assert.equal(reads, 1);
    h.advance(120001);
    await assert.rejects(h.api.sessionApiService.getCurrentSession('a'));
    assert.equal(reads, 2);
    h.window.sessionStorage.setItem = () => { throw new Error('blocked'); };
    h.api.writePollCache('usable', { ok: true });
    assert.equal((await h.api.readCachedPoll('usable', () => assert.fail('Memory cache missed'))).ok, true);
}

// A late GET must not overwrite the response received from a successful vote POST.
{
    let resolveRead;
    const h = createHarness();
    const pending = h.api.readCachedPoll('race', () => new Promise((resolve) => { resolveRead = resolve; }));
    await Promise.resolve();
    h.api.writePollCache('race', { value: 'new' });
    resolveRead({ value: 'old' });
    await pending;
    assert.equal((await h.api.readCachedPoll('race', () => assert.fail())).value, 'new');
}

// Successful writes refresh only the relevant campaign; rejected votes leave the cache unchanged.
{
    const calls = [];
    let rejectSave = false;
    const h = createHarness({ request: async (path, options) => {
        calls.push({ path, options });
        if (rejectSave) throw new Error('save failed');
        return path === 'api/session' ? { session: { ...config('a'), number: 8 } } : { data: { votes: [ownVote({ x: 'no' })] } };
    } });
    h.api.writePollCache('votes:a:7', { votes: [ownVote({ x: 'yes' })] });
    h.api.writePollCache('votes:b:7', { votes: [] });
    await h.api.postRemoteVote({ campaignId: 'a', sessionNumber: 7, playerAccountId: 'alice', optionId: 'x', value: 'no', token: 'test' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.body.campaignId, 'a');
    assert.equal((await h.api.sessionApiService.getVotes(7, 'a')).votes[0].selections.x, 'no');
    assert.equal((await h.api.sessionApiService.getVotes(7, 'b')).votes.length, 0);
    rejectSave = true;
    await assert.rejects(h.api.postRemoteVote({ campaignId: 'a', sessionNumber: 7, playerAccountId: 'alice', optionId: 'x', value: 'yes' }));
    assert.equal((await h.api.sessionApiService.getVotes(7, 'a')).votes[0].selections.x, 'no');
    rejectSave = false;
    await h.api.postRemoteSessionConfig({ ...config('a'), number: 8 });
    assert.equal((await h.api.sessionApiService.getCurrentSession('a')).number, 8);
}

// Match date AND the entire time range, including explicit years and year boundaries.
{
    const { api } = createHarness();
    const legacy = api.getPollSlotKey(slot(), config());
    assert.equal(legacy, '2026-9-14|20:30|23:30');
    assert.equal(api.getPollSlotKey(slot('lun-14-set-2026-2030'), config()), legacy);
    assert.notEqual(api.getPollSlotKey(slot('lun-14-set-2025-2030'), config()), legacy);
    assert.notEqual(api.getPollSlotKey(slot('lun-14-set-2030', '20:30 - 23:00'), config()), legacy);
    assert.equal(api.getPollSlotKey(slot('lun-31-feb-2030'), config()), '');
    assert.equal(api.getPollSlotKey(slot('lun-14-set-2030', '25:30 - 26:00'), config()), '');
    assert.equal(api.getPollSlotKey(slot('arbitrary-id'), config()), '');
    assert.equal(api.getPollSlotKey(slot('ven-01-gen-2030'), { createdAt: '2026-12-28T12:00:00Z' }), '2027-1-1|20:30|23:30');
    assert.notEqual(api.getPollSlotKey(slot('dom-14-set-2030'), { createdAt: '2025-09-01T12:00:00Z' }), legacy);
}

// Conflicting responses remain separate; account/Discord identities work across different characters.
{
    const { api } = createHarness();
    const sources = [
        { campaignId: 'a', campaignName: 'A', config: config('a'), votes: [ownVote()] },
        { campaignId: 'b', campaignName: 'B', config: config('b'), votes: [{ ...ownVote({ 'lun-14-set-2030': 'no' }), accountId: '', playerId: 'another-character' }] },
        { campaignId: 'c', campaignName: 'C', config: config('c'), votes: [{ ...ownVote(), accountId: 'bob', discordId: '200002' }] }
    ];
    const hints = api.buildCrossCampaignHints(config(), sources, identity);
    assert.deepEqual(copy(hints.get(slot().id).map((hint) => [hint.campaignId, hint.value])), [['a', 'yes'], ['b', 'no']]);
    assert.equal(api.buildCrossCampaignHints(config(), sources, { accountId: 'nobody' }).size, 0);
    assert.equal(api.buildCrossCampaignHints(config(), [{ ...sources[0], votes: [ownVote({})] }], identity).size, 0);
    const currentVotes = [{ ...ownVote({}), canEdit: true }];
    assert.equal(api.computeTotals(currentVotes, [slot()])[slot().id].yes, 0);
    const markup = api.buildPollMarkup(config(), [slot()], currentVotes, '', false, {});
    assert.match(markup, /data-total-kind="yes">0</);
    assert.doesNotMatch(markup, /is-yes is-active/);
    assert.equal(api.getNextVoteValue(''), 'yes', 'A ghost never changes the real vote cycle');
}

// Integration: only enabled member campaigns are queried; skip votes without matching slots; isolate errors.
{
    const campaigns = ['main', 'a', 'b', 'not-member', 'different-slot', 'broken', 'disabled'].map((id) => ({ id, name: id, enabled: id !== 'disabled' }));
    const data = { 'global/campaigns.json': { campaigns }, 'global/users.json': [{ id: 'alice', discordId: '100001' }] };
    for (const campaign of campaigns) {
        data[`${campaign.id}/next-session.json`] = { dmAccountId: campaign.id === 'b' ? 'alice' : 'dm' };
        data[`${campaign.id}/players.json`] = ['not-member', 'b'].includes(campaign.id) ? [] : [{ id: 'different-character', ...identity }];
    }
    const calls = [];
    const h = createHarness({ data, request: async (path, options) => {
        const id = options.query.campaign;
        calls.push(`${path}:${id}`);
        if (id === 'broken') throw new Error('offline');
        if (path === 'api/session/current') return config(id, id === 'different-slot' ? [slot('lun-14-set-1500', '15:00 - 18:30')] : [slot()]);
        return { votes: [ownVote()] };
    } });
    const hints = await h.api.loadCrossCampaignHints(config(), identity);
    assert.equal(hints.get(slot().id).length, 2);
    assert.deepEqual(calls.filter((call) => call.startsWith('api/session-votes')).sort(), ['api/session-votes:a', 'api/session-votes:b']);
    assert.ok(!calls.some((call) => /:(main|disabled|not-member)$/.test(call)));
    const coldCalls = calls.length;
    await h.api.loadCrossCampaignHints(config(), identity);
    assert.equal(calls.length, coldCalls, 'Repeated views reuse GETs, including failed reads');
}

console.log('Poll hints: cache, matching, membership, conflicts and write regression checks passed.');
