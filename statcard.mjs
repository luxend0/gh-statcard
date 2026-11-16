#!/usr/bin/env node
// gh-statcard: renders a GitHub stats card as one static SVG.
// Usage: GH_TOKEN=... node statcard.mjs --user <login> [--out stats.svg]
// A token without any scopes is enough; only public data is read.
import { writeFileSync, renameSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const LANGS = 'languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}';

export function query(orgs = []) {
  for (const o of orgs) if (!/^[A-Za-z0-9-]{1,39}$/.test(o)) throw new Error(`bad org login: ${o}`);
  return `query($login:String!){
  user(login:$login){
    pullRequests(states:MERGED){totalCount}
    contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount}}}}
    repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100){totalCount nodes{stargazerCount ${LANGS}}}
  }
  ${orgs.map((o, i) => `o${i}:organization(login:"${o}"){repositories(privacy:PUBLIC,isFork:false,first:100){nodes{${LANGS}}}}`).join('\n  ')}
}`;
}

async function gql(q, variables, token) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'User-Agent': 'gh-statcard' },
    body: JSON.stringify({ query: q, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
  return j.data;
}

export async function fetchData(login, token, orgs = []) {
  const d = await gql(query(orgs), { login }, token);
  if (!d.user) throw new Error(`no such user: ${login}`);
  return d;
}

export const REPO_QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
  name description stargazerCount forkCount primaryLanguage{name} licenseInfo{spdxId}}}`;

export async function fetchRepo(full, token) {
  const [owner, name] = full.split('/');
  if (!owner || !name) throw new Error(`expected owner/name, got: ${full}`);
  const d = await gql(REPO_QUERY, { owner, name }, token);
  if (!d.repository) throw new Error(`no such repo: ${full}`);
  return d.repository;
}

// Language share by bytes over the user's public repos plus the given orgs' public repos.
// Top 5, the rest as "Other". `exclude` drops names like HTML or CSS before counting.
export function summarize(d, exclude = []) {
  const u = d.user, repos = u.repositories.nodes, cal = u.contributionsCollection.contributionCalendar;
  const skip = new Set(exclude.map(x => x.toLowerCase())), langs = {};
  const orgRepos = Object.keys(d).filter(k => /^o\d+$/.test(k)).flatMap(k => d[k]?.repositories.nodes || []);
  for (const r of [...repos, ...orgRepos]) for (const e of r.languages.edges)
    if (!skip.has(e.node.name.toLowerCase())) langs[e.node.name] = (langs[e.node.name] || 0) + e.size;
  const total = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5).map(([name, size]) => ({ name, pct: size / total }));
  const rest = 1 - top.reduce((a, l) => a + l.pct, 0);
  if (sorted.length > 5 && rest > 0.005) top.push({ name: 'Other', pct: rest });
  return {
    langs: top,
    contributions: cal.totalContributions,
    weeks: cal.weeks.map(w => w.contributionDays.reduce((a, x) => a + x.contributionCount, 0)),
    mergedPRs: u.pullRequests.totalCount,
    stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
    publicRepos: u.repositories.totalCount,
  };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = n => n.toLocaleString('en-US');

export function render(s, login) {
  const W = 495, P = 24, IW = W - 2 * P;
  const cols = [[s.contributions, 'contributions'], [s.mergedPRs, 'merged PRs'], [s.stars, 'stars'], [s.publicRepos, 'public repos']];
  const stat = cols.map(([n, k], i) => {
    const x = P + i * (IW / 4);
    return `<text x="${x}" y="74" class="n">${fmt(n)}</text><text x="${x}" y="92" class="m">${k}</text>`;
  }).join('');
  // weekly activity: one bar per week, last 52 weeks, empty weeks as a thin line
  const wk = s.weeks.slice(-52), max = Math.max(1, ...wk), step = IW / wk.length, bh = 34, by = 146;
  const bars = wk.map((v, i) => {
    const h = v ? Math.max(2, Math.round((v / max) * bh)) : 1;
    return `<rect x="${(P + i * step).toFixed(1)}" y="${by - h}" width="${(step - 2).toFixed(1)}" height="${h}" class="${v ? 'b' : 'z'}"/>`;
  }).join('');
  // languages: one stacked bar, the top language in the accent colour, the rest in greys
  const cls = i => (i ? `g${i}` : 'a');
  let x = P, lx = P, ly = 188;
  const seg = s.langs.map((l, i) => {
    const w = l.pct * IW, r = `<rect x="${x.toFixed(1)}" y="166" width="${Math.max(0, w - 2).toFixed(1)}" height="8" class="${cls(i)}"/>`;
    x += w; return r;
  }).join('');
  const legend = s.langs.map((l, i) => { // wraps to a new row when it would overflow
    const t = `${l.name} ${(l.pct * 100).toFixed(0)}%`, w = 12 + t.length * 6.6;
    if (lx + w > W - P) { lx = P; ly += 18; }
    const r = `<rect x="${lx}" y="${ly}" width="8" height="8" class="${cls(i)}"/><text x="${lx + 12}" y="${ly + 8}" class="m">${esc(t)}</text>`;
    lx += w + 14; return r;
  }).join('');
  const H = s.langs.length ? ly + 28 : 162;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats for ${esc(login)}">
<style>
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#171717}
.t{font-size:15px;font-weight:700}.n{font-size:20px;font-weight:700}.m{font-size:11px;fill:#737373}
.bg{fill:#fff;stroke:#e5e5e5}.b{fill:#525252}.z{fill:#e5e5e5}.a{fill:#3b82f6}
.g1{fill:#404040}.g2{fill:#737373}.g3{fill:#a3a3a3}.g4{fill:#d4d4d4}.g5{fill:#e5e5e5}
@media (prefers-color-scheme:dark){text{fill:#e5e5e5}.m{fill:#8b8b8b}.bg{fill:#0d1117;stroke:#30363d}.b{fill:#a3a3a3}.z{fill:#262626}
.g1{fill:#d4d4d4}.g2{fill:#a3a3a3}.g3{fill:#737373}.g4{fill:#525252}.g5{fill:#404040}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" class="bg"/>
<text x="${P}" y="36" class="t">${esc(login)}</text><text x="${W - P}" y="36" class="m" text-anchor="end">last 12 months</text>
${stat}
${bars}
${seg}
${legend}
</svg>
`;
}

// Greedy word wrap to `max` characters, at most `lines` lines; the last line ends in "..." if cut.
export function wrap(text, max, lines) {
  const out = [];
  let cur = '';
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    out.length = lines;
    const last = out[lines - 1];
    out[lines - 1] = (last.length > max - 3 ? last.slice(0, max - 3) : last) + '...';
  }
  return out.map(l => (l.length > max ? l.slice(0, max - 3) + '...' : l));
}

// A pinned-repo style card: name, description, language, stars, forks, license.
export function renderRepo(r) {
  const W = 410, H = 120, P = 24;
  const desc = wrap(r.description || 'No description', 50, 2)
    .map((l, i) => `<text x="${P}" y="${62 + i * 18}" class="d">${esc(l)}</text>`).join('');
  const meta = [];
  let x = P;
  if (r.primaryLanguage) {
    meta.push(`<rect x="${x}" y="96" width="8" height="8" class="a"/><text x="${x + 13}" y="104" class="m">${esc(r.primaryLanguage.name)}</text>`);
    x += 13 + r.primaryLanguage.name.length * 6.6 + 18;
  }
  // star and fork glyphs drawn as paths, so they never depend on a font
  meta.push(`<path transform="translate(${x} 94) scale(.5)" class="g" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z"/><text x="${x + 16}" y="104" class="m">${fmt(r.stargazerCount)}</text>`);
  x += 16 + fmt(r.stargazerCount).length * 6.6 + 18;
  meta.push(`<path transform="translate(${x} 94) scale(.5)" class="g" d="M6 3a3 3 0 0 0-1 5.8v6.4a3 3 0 1 0 2 0V13h7a3 3 0 0 0 3-3V8.8a3 3 0 1 0-2 0V10a1 1 0 0 1-1 1H7V8.8A3 3 0 0 0 6 3z"/><text x="${x + 16}" y="104" class="m">${fmt(r.forkCount)}</text>`);
  x += 16 + fmt(r.forkCount).length * 6.6 + 18;
  const lic = r.licenseInfo?.spdxId;
  if (lic && lic !== 'NOASSERTION') meta.push(`<text x="${x}" y="104" class="m">${esc(lic)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(r.name)}: ${esc(r.description || '')}">
<style>
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#171717}
.t{font-size:15px;font-weight:700}.d{font-size:12px;fill:#525252}.m{font-size:11px;fill:#737373}
.bg{fill:#fff;stroke:#e5e5e5}.a{fill:#3b82f6}.g{fill:#737373}
@media (prefers-color-scheme:dark){text{fill:#e5e5e5}.d{fill:#a3a3a3}.m{fill:#8b8b8b}.bg{fill:#0d1117;stroke:#30363d}.g{fill:#8b8b8b}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" class="bg"/>
<text x="${P}" y="36" class="t">${esc(r.name)}</text>
${desc}
${meta.join('')}
</svg>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: {
    user: { type: 'string' }, out: { type: 'string', default: 'stats.svg' },
    orgs: { type: 'string', default: '' }, exclude: { type: 'string', default: '' },
    repo: { type: 'string' },
  } });
  const list = v => v.split(',').map(x => x.trim()).filter(Boolean);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!(o.user || o.repo) || !token) {
    console.error('usage: GH_TOKEN=... node statcard.mjs --user <login> [--out stats.svg] [--orgs a,b] [--exclude HTML,CSS]\n' +
      '       GH_TOKEN=... node statcard.mjs --repo <owner/name> [--out repo.svg]');
    process.exit(2);
  }
  const svg = o.repo
    ? renderRepo(await fetchRepo(o.repo, token))
    : render(summarize(await fetchData(o.user, token, list(o.orgs)), list(o.exclude)), o.user);
  writeFileSync(o.out + '.tmp', svg);
  renameSync(o.out + '.tmp', o.out); // atomic swap: a web server never serves half a file
  console.log('wrote', o.out);
}
