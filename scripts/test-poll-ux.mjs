import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/shared/next-session.js', import.meta.url), 'utf8');
const window = { location: { pathname: '/pages/sondaggio.html' }, CriptaApp: { utils: {
    escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
} } };
vm.runInNewContext(source.replace('window.CriptaNextSession = {', `window.testPollUx = {
    groupPollDays, getVoteProgress, formatVoteProgress, getPollCandidates, buildPollSummary, buildPersonalPollMarkup, buildPollMarkup, authService
}; window.CriptaNextSession = {`), {
    window, document: { body: { classList: { contains: () => true } } }, URL, console
});
const api = window.testPollUx;
const copy = (value) => JSON.parse(JSON.stringify(value));
const slot = (id, time = '20:30 - 23:30') => ({ id, time, label: id });
const config = { campaignId: 'cripta-di-sangue', createdAt: '2026-09-15T12:00:00Z', number: 36 };

// A logged-out viewer must not match a device-code account with no Discord ID.
assert.equal(api.authService.getAccountId(null, [{ id: 'dm', discordId: '' }]), '');
assert.equal(api.authService.getAccountId({ user: { accountId: 'player' } }, [{ id: 'dm' }]), 'player');

// Two time ranges on the same date share a heading; Monday starts a new week.
const options = [slot('dom-20-set-1500', '15:00 - 18:30'), slot('dom-20-set-2030'), slot('lun-21-set-2030'), slot('lun-28-set-2030')];
const groups = api.groupPollDays(options, config);
assert.deepEqual(copy(groups.map((group) => group.options.length)), [2, 1, 1]);
assert.deepEqual(copy(groups.map((group) => group.startsWeek)), [false, true, true]);
assert.deepEqual(copy(groups.flatMap((group) => group.options)), options, 'Grouping must preserve the existing option order and IDs');
const newYear = api.groupPollDays([slot('dom-03-gen-2027-2030'), slot('lun-04-gen-2027-2030')], config);
assert.deepEqual(copy(newYear.map((group) => group.week)), ['2026-12-28', '2027-01-04']);
assert.equal(newYear[1].startsWeek, true);
const unknown = api.groupPollDays([{ id: 'custom-a', label: 'Evento', time: '' }, { id: 'custom-b', label: 'Evento', time: '' }], config);
assert.equal(unknown.length, 2, 'Unknown imported dates must not be merged just because their labels match');
assert.equal(api.groupPollDays([], config).length, 0);

// Progress counts actual valid answers only, and ignores removed options and ghost hints.
const progressVote = { selections: { [options[0].id]: 'no', [options[1].id]: 'maybe', removed: 'yes', [options[2].id]: 'invalid' } };
assert.deepEqual(copy(api.getVoteProgress(progressVote, options)), { answered: 2, total: 4, complete: false });
assert.equal(api.formatVoteProgress({ selections: {} }, options), 'Da compilare');
assert.equal(api.getVoteProgress({ selections: {} }, []).complete, false);
const fullVote = { selections: Object.fromEntries(options.map((option) => [option.id, 'no'])) };
assert.equal(api.formatVoteProgress(fullVote, options), 'Completo', 'A complete poll may legitimately contain only No votes');

// Rankings exclude DM-unavailable slots; no unanswered slot is called unanimous.
const rankingOptions = ['unanimous', 'missing', 'maybe', 'blocked', 'empty', 'dm-maybe'].map((id) => slot(id));
const votes = [
    { playerId: 'dm', name: 'DM', selections: { unanimous: 'yes', missing: 'yes', maybe: 'yes', blocked: 'no', 'dm-maybe': 'maybe' } },
    { playerId: 'a', name: 'A', selections: { unanimous: 'yes', missing: 'yes', maybe: 'yes', blocked: 'yes', 'dm-maybe': 'yes' } },
    { playerId: 'b', name: 'B', selections: { unanimous: 'yes', maybe: 'maybe', blocked: 'yes', 'dm-maybe': 'yes' } }
];
const candidates = api.getPollCandidates(votes, rankingOptions);
assert.equal(candidates[0].option.id, 'unanimous');
assert.ok(!candidates.some((candidate) => ['blocked', 'empty'].includes(candidate.option.id)));
assert.equal(candidates.length, 3);
assert.equal(api.getPollCandidates(votes, [rankingOptions[1]])[0].missing, 1);
assert.doesNotMatch(api.buildPollSummary([rankingOptions[1]], votes), /Tutti disponibili/);
assert.match(api.buildPollSummary([rankingOptions[1]], votes), /1 senza risposta/);
assert.match(api.buildPollSummary([rankingOptions[2]], votes), /1 forse/);
assert.match(api.buildPollSummary([rankingOptions[5]], votes), /DM: forse/);
assert.match(api.buildPollSummary([slot('blocked')], votes), /DM non è disponibile/);
const unknownDm = votes.map((vote) => vote.playerId === 'dm' ? { ...vote, selections: {} } : vote);
assert.match(api.buildPollSummary([rankingOptions[0]], unknownDm), /DM: da confermare/);
assert.doesNotMatch(api.buildPollSummary([rankingOptions[0]], unknownDm), /Tutti disponibili/);
assert.equal(api.getPollCandidates([{ playerId: 'dm', selections: {} }], rankingOptions).length, 0);
assert.equal(api.getPollCandidates([], rankingOptions).length, 0);

// Personal voting exposes only the user's rows, preserves the three explicit choices,
// and escapes campaign-supplied names, labels and IDs.
const unsafeOptions = [{ id: 'x" onclick="bad', label: '<script>bad</script>', time: '20:30 - 23:30' }];
const personalVotes = [{ playerId: 'a', name: '<b>A</b>', selections: {}, canEdit: true }, { playerId: 'b', name: 'Private row', selections: {}, canEdit: false }];
const personal = api.buildPersonalPollMarkup(unsafeOptions, personalVotes);
assert.doesNotMatch(personal, /Private row|<script>|<b>A<\/b>/);
assert.match(personal, /&lt;b&gt;A&lt;\/b&gt;/);
for (const value of ['yes', 'maybe', 'no']) assert.match(personal, new RegExp(`data-value="${value}"`));
assert.equal(api.buildPersonalPollMarkup(options, [{ ...personalVotes[0], canEdit: false }]), '');
const markup = api.buildPollMarkup(config, options, personalVotes, '', false, {});
assert.match(markup, /scope="colgroup" colspan="2"/);
assert.match(markup, /rowspan="2" scope="col"/);
assert.match(markup, /data-poll-layout="personal"/);
assert.doesNotMatch(api.buildPollMarkup(config, options, personalVotes.map((vote) => ({ ...vote, canEdit: false })), '', false, {}), /data-poll-layout="personal"/);

console.log('Poll UX: grouped dates, year boundaries, rankings, missing responses, DM availability, progress and personal-view permissions passed.');
