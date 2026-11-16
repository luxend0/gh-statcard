// node test.mjs - checks summarize() and render() on fake API data, no network
import assert from 'node:assert/strict';
import { summarize, render, query, wrap, renderRepo } from './statcard.mjs';

const lang = (name, size) => ({ size, node: { name } });

const data = { user: {
  pullRequests: { totalCount: 7 },
  contributionsCollection: { contributionCalendar: { totalContributions: 1234,
    weeks: Array.from({ length: 53 }, (_, i) => ({ contributionDays: [{ contributionCount: i % 3 }, { contributionCount: 1 }] })) } },
  repositories: { totalCount: 2, nodes: [
    { stargazerCount: 3, languages: { edges: [lang('Go', 600), lang('HTML', 5000)] } },
    { stargazerCount: 2, languages: { edges: [lang('QML', 200), lang('C++', 50), lang('Shell', 30)] } }] },
},
  o0: { repositories: { nodes: [{ languages: { edges: [lang('Rust', 100), lang('<x&y>', 40)] } }] } },
};

const s = summarize(data, ['html']);
assert.equal(s.stars, 5);
assert.equal(s.mergedPRs, 7);
assert.equal(s.contributions, 1234);
assert.equal(s.publicRepos, 2);
assert.equal(s.weeks.length, 53);
assert.equal(s.weeks[2], 3);
assert.equal(s.langs[0].name, 'Go', 'HTML excluded, Go leads');
assert.equal(s.langs.at(-1).name, 'Other');
assert.ok(Math.abs(s.langs.reduce((a, l) => a + l.pct, 0) - 1) < 1e-9);
assert.throws(() => query(['ok', 'bad"org']), /bad org/);
assert.ok(query(['InstantNodeEU']).includes('o0:organization(login:"InstantNodeEU")'));

const svg = render(s, 'a<b');
assert.ok(svg.startsWith('<svg'));
assert.ok(svg.includes('1,234'));
assert.ok(svg.includes('a&lt;b') && !svg.includes('a<b'));
assert.ok(svg.includes('&lt;x&amp;y&gt;') && !svg.includes('<x&y>'), 'language names escaped');
assert.ok(svg.includes('prefers-color-scheme:dark'), 'dark palette present');
assert.equal((svg.match(/class="[bz]"/g) || []).length, 52, 'one bar per week, last 52 weeks');

// repo cards
assert.deepEqual(wrap('one two three', 7, 2), ['one two', 'three']);
assert.deepEqual(wrap('aaaa bbbb cccc dddd eeee', 9, 2), ['aaaa bbbb', 'cccc d...']);
assert.deepEqual(wrap('', 10, 2), []);
const card = renderRepo({ name: 'x<y', description: 'Does <things> & more', stargazerCount: 1200, forkCount: 3,
  primaryLanguage: { name: 'Go' }, licenseInfo: { spdxId: 'MIT' } });
assert.ok(card.includes('x&lt;y') && card.includes('&lt;things&gt; &amp; more') && !card.includes('<things>'));
assert.ok(card.includes('1,200') && card.includes('>Go<') && card.includes('>MIT<'));
assert.ok(!renderRepo({ name: 'n', description: null, stargazerCount: 0, forkCount: 0, primaryLanguage: null,
  licenseInfo: { spdxId: 'NOASSERTION' } }).includes('NOASSERTION'));
console.log('ok');
