// node test.mjs - checks summarize() and render() on fake API data, no network
import assert from 'node:assert/strict';
import { summarize, render } from './statcard.mjs';

const data = { user: {
  pullRequests: { totalCount: 7 },
  contributionsCollection: { contributionCalendar: { totalContributions: 1234 } },
  repositories: { totalCount: 2, nodes: [{ stargazerCount: 3 }, { stargazerCount: 2 }] },
} };

const s = summarize(data);
assert.equal(s.stars, 5);
assert.equal(s.mergedPRs, 7);
assert.equal(s.contributions, 1234);
assert.equal(s.publicRepos, 2);

const svg = render(s, 'a<b');
assert.ok(svg.startsWith('<svg'));
assert.ok(svg.includes('1,234'));
assert.ok(svg.includes('a&lt;b') && !svg.includes('a<b'));
console.log('ok');
