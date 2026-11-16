#!/usr/bin/env node
// gh-statcard: renders a GitHub stats card as one static SVG.
// Usage: GH_TOKEN=... node statcard.mjs --user <login> [--out stats.svg]
// A token without any scopes is enough; only public data is read.
import { writeFileSync, renameSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export function query() {
  return `query($login:String!){
  user(login:$login){
    pullRequests(states:MERGED){totalCount}
    contributionsCollection{contributionCalendar{totalContributions}}
    repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100){totalCount nodes{stargazerCount}}
  }
}`;
}

export async function fetchData(login, token) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'User-Agent': 'gh-statcard' },
    body: JSON.stringify({ query: query(), variables: { login } }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
  if (!j.data.user) throw new Error(`no such user: ${login}`);
  return j.data;
}

export function summarize(d) {
  const u = d.user, repos = u.repositories.nodes;
  return {
    contributions: u.contributionsCollection.contributionCalendar.totalContributions,
    mergedPRs: u.pullRequests.totalCount,
    stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
    publicRepos: u.repositories.totalCount,
  };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = n => n.toLocaleString('en-US');

export function render(s, login) {
  const W = 495, P = 24, IW = W - 2 * P, H = 116;
  const cols = [[s.contributions, 'contributions'], [s.mergedPRs, 'merged PRs'], [s.stars, 'stars'], [s.publicRepos, 'public repos']];
  const stat = cols.map(([n, k], i) => {
    const x = P + i * (IW / 4);
    return `<text x="${x}" y="74" class="n">${fmt(n)}</text><text x="${x}" y="92" class="m">${k}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats for ${esc(login)}">
<style>
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#171717}
.t{font-size:15px;font-weight:700}.n{font-size:20px;font-weight:700}.m{font-size:11px;fill:#737373}
.bg{fill:#fff;stroke:#e5e5e5}
@media (prefers-color-scheme:dark){text{fill:#e5e5e5}.m{fill:#8b8b8b}.bg{fill:#0d1117;stroke:#30363d}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" class="bg"/>
<text x="${P}" y="36" class="t">${esc(login)}</text><text x="${W - P}" y="36" class="m" text-anchor="end">last 12 months</text>
${stat}
</svg>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: { user: { type: 'string' }, out: { type: 'string', default: 'stats.svg' } } });
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!o.user || !token) {
    console.error('usage: GH_TOKEN=... node statcard.mjs --user <login> [--out stats.svg]');
    process.exit(2);
  }
  const svg = render(summarize(await fetchData(o.user, token)), o.user);
  writeFileSync(o.out + '.tmp', svg);
  renameSync(o.out + '.tmp', o.out); // atomic swap: a web server never serves half a file
  console.log('wrote', o.out);
}
