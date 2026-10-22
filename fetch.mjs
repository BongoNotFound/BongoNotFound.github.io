import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const IN = process.argv[2] || 'prev';
const OUT = process.argv[3] || 'out';
const MOCK = process.env.MOCK_BASE || '';
const HOOK = (process.env.DISCORD_WEBHOOK || '').trim();
const FORCE = String(process.env.FORCE_POST || '') === 'true';
const OWNER = (process.env.GITHUB_REPOSITORY_OWNER || 'BongoNotFound').toLowerCase();
const SITE = process.env.SITE_URL || `https://${OWNER}.github.io/`;
const NOW = Number(process.env.FAKE_NOW) || Date.now();
const H = 3600e3, D = 24 * H;
const NEW_DAYS = 45;
const MAX_GAMES = 700;

const url = (host, p) => MOCK ? `${MOCK}/${host}${p}` : `https://${host}${p}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function get(host, p, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url(host, p), { headers: { accept: 'application/json', 'user-agent': 'TrendRadar/1.0' } });
      if (r.status === 429 || r.status >= 500) { last = new Error(`${r.status} ${host}${p}`); await sleep(2500 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`${r.status} ${host}${p}`);
      return await r.json();
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

async function readJSON(f, fb) {
  try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return fb; }
}

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function clean(name) {
  let s = String(name || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|\{[^}]*\}/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/\b(UPD(ATE)?\s*\d*|NEW|BETA|ALPHA|RELEASE|TESTING|EARLY TESTING|SOON)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|:\-–!.]+|[\s|:\-–]+$/g, '')
    .trim();
  return s || String(name || '').trim();
}

const FORMATS = [
  ['+1 ___', /^\+\s?\d+\s+\S/i],
  ['Steal a ___', /\bsteal\b/i],
  ['Build a ___', /\bbuild\b/i],
  ['Grow a ___', /\bgrow\b/i],
  ['___ Simulator', /\bsim(ulator)?\b/i],
  ['___ Tycoon', /\btycoon\b/i],
  ['___ RNG', /\brng\b/i],
  ['Obby', /\bobby\b/i],
  ['Tower Defense', /tower defen[cs]e|\btd\b/i],
  ['Clean all the ___', /\bclean\b/i],
  ['Break / Smash ___', /\b(break|crack|peel|smash|melt|destroy|cut|drill|kick)\b/i],
  ['Ride / Drive ___', /\b(ride|drive|driving)\b/i],
  ['Guess the ___', /\bguess\b/i],
  ['Escape', /\bescape\b/i],
  ['Survive ___', /\bsurviv(e|al)\b/i],
  ['Battlegrounds', /battlegrounds?|\barena\b/i],
  ['Duels / 1v1', /\bduels?\b|\b1v1\b|\bvs\b/i],
  ['Anime', /\banime\b/i],
  ['Brainrot', /brainrot/i],
  ['Eggs', /\beggs?\b/i],
  ['Pets', /\bpets?\b/i],
  ['Fishing', /\bfish/i],
  ['Horror', /horror|nightmare|scary|creepy/i],
  ['X Days / Nights', /\b\d+\s+(days?|nights?)\b/i],
  ['Roleplay', /\brp\b|roleplay/i],
  ['Sandbox', /sandbox/i],
  ['Farm / Garden', /\b(farm|garden)\b/i],
  ['Mine / Dig', /\b(mine|mining|dig)\b/i],
  ['Sports', /\b(soccer|football|basketball|volleyball|nba|nfl)\b/i],
  ['Shooter / Sniper', /\b(sniper|fps|gun|shoot)\b/i],
  ['Empire / Army', /\b(empire|army|kingdom|conquer)\b/i]
];

const STOP = new Set('a an the and or of to in on for with your my me you is it be by at as all get got vs x 1 2 3 4 5 new upd update beta alpha release sim game games roblox obby'.split(' '));

function localParts(ms) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const fmt = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const hist = await readJSON(path.join(IN, 'history.json'), { snaps: [] });
  const state = await readJSON(path.join(IN, 'state.json'), {});
  hist.snaps = (hist.snaps || []).filter(s => NOW - s.t < 8 * D);

  const session = crypto.randomUUID();
  const sorts = [];
  let token = '';
  for (let page = 0; page < 8; page++) {
    const q = `/explore-api/v1/get-sorts?sessionId=${session}&device=computer&country=all` + (token ? `&sortsPageToken=${encodeURIComponent(token)}` : '');
    let j;
    try { j = await get('apis.roblox.com', q); } catch (e) { if (page === 0) throw e; log('sort page fail', e.message); break; }
    for (const s of j.sorts || []) {
      if (s.contentType === 'Games' && Array.isArray(s.games) && s.games.length) sorts.push(s);
    }
    token = j.nextSortsPageToken;
    if (!token) break;
  }
  if (!sorts.length) throw new Error('No sorts from Roblox');
  log('sorts', sorts.length);

  const explore = new Map();
  const sortOut = [];
  const seenSort = new Set();
  for (const s of sorts) {
    const key = s.sortId || s.id;
    if (seenSort.has(key)) continue;
    seenSort.add(key);
    const ids = [];
    for (const g of s.games) {
      if (g.isSponsored || !g.universeId) continue;
      const id = String(g.universeId);
      ids.push(id);
      if (!explore.has(id)) explore.set(id, g);
    }
    sortOut.push({ id: key, name: s.sortDisplayName || key, info: s.topicLayoutData?.infoText || '', ids });
  }

  const recent = new Set();
  for (const s of hist.snaps) if (NOW - s.t < 2 * D) for (const id of Object.keys(s.p || {})) recent.add(id);
  let ids = [...explore.keys()];
  for (const id of recent) if (!explore.has(id)) ids.push(id);
  ids = ids.slice(0, MAX_GAMES);
  log('games', ids.length);

  const details = new Map();
  for (const c of chunk(ids, 50)) {
    try {
      const j = await get('games.roblox.com', `/v1/games?universeIds=${c.join(',')}`);
      for (const g of j.data || []) details.set(String(g.id), g);
    } catch (e) { log('details fail', e.message); }
    await sleep(250);
  }

  const votes = new Map();
  for (const c of chunk(ids, 50)) {
    try {
      const j = await get('games.roblox.com', `/v1/games/votes?universeIds=${c.join(',')}`);
      for (const v of j.data || []) votes.set(String(v.id), v);
    } catch (e) { log('votes fail', e.message); }
    await sleep(250);
  }

  const icons = new Map();
  for (const c of chunk(ids, 100)) {
    try {
      const j = await get('thumbnails.roblox.com', `/v1/games/icons?universeIds=${c.join(',')}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`);
      for (const t of j.data || []) if (t.imageUrl) icons.set(String(t.targetId), t.imageUrl);
    } catch (e) { log('icons fail', e.message); }
    await sleep(250);
  }

  const snap = { t: NOW, p: {}, v: {} };
  const games = {};
  for (const id of ids) {
    const d = details.get(id), e = explore.get(id), v = votes.get(id);
    if (!d && !e) continue;
    const playing = d?.playing ?? e?.playerCount ?? 0;
    const visits = d?.visits ?? 0;
    snap.p[id] = playing;
    if (visits) snap.v[id] = visits;
    const up = v?.upVotes ?? e?.totalUpVotes ?? 0;
    const down = v?.downVotes ?? e?.totalDownVotes ?? 0;
    const created = d?.created ? Date.parse(d.created) : null;
    const ageDays = created ? Math.max(0, (NOW - created) / D) : null;
    games[id] = {
      id,
      place: String(d?.rootPlaceId ?? e?.rootPlaceId ?? ''),
      name: d?.name ?? e?.name ?? '',
      clean: clean(d?.name ?? e?.name),
      creator: d?.creator?.name || '',
      verified: !!d?.creator?.hasVerifiedBadge,
      playing,
      visits,
      fav: d?.favoritedCount ?? 0,
      up, down,
      like: up + down > 0 ? Math.round(up / (up + down) * 1000) / 10 : null,
      created: d?.created || null,
      updated: d?.updated || null,
      ageDays: ageDays == null ? null : Math.round(ageDays * 10) / 10,
      genre: d?.genre_l1 || e?.genreL1 || d?.genre || '',
      sub: d?.genre_l2 || '',
      maxPlayers: d?.maxPlayers ?? null,
      icon: icons.get(id) || '',
      desc: String(d?.description || '').slice(0, 400),
      sorts: []
    };
  }
  for (const s of sortOut) s.ids = s.ids.filter(id => games[id]);
  for (const s of sortOut) s.ids.forEach((id, i) => games[id].sorts.push([s.id, i + 1]));

  hist.snaps.push(snap);
  hist.snaps.sort((a, b) => a.t - b.t);

  const near = target => {
    let best = null, bd = Infinity;
    for (const s of hist.snaps) { const dd = Math.abs(s.t - target); if (dd < bd) { bd = dd; best = s; } }
    return bd <= 4 * H ? best : null;
  };
  const ago24 = near(NOW - D);
  const ago6 = near(NOW - 6 * H);
  const sparkSnaps = hist.snaps.filter(s => NOW - s.t <= 48 * H + 30 * 60e3);

  for (const g of Object.values(games)) {
    const p24 = ago24?.p?.[g.id];
    const v24 = ago24?.v?.[g.id];
    const p6 = ago6?.p?.[g.id];
    g.dPlay24 = p24 > 0 ? Math.round((g.playing - p24) / p24 * 1000) / 10 : null;
    g.dPlay6 = p6 > 0 ? Math.round((g.playing - p6) / p6 * 1000) / 10 : null;
    g.visits24 = v24 && g.visits ? Math.max(0, g.visits - v24) : null;
    g.vpd = g.ageDays && g.ageDays > 0.5 && g.visits ? Math.round(g.visits / g.ageDays) : null;
    g.spark = sparkSnaps.map(s => s.p?.[g.id] ?? null);
    const growth = g.dPlay24 != null ? Math.max(-50, Math.min(300, g.dPlay24)) : 0;
    const fresh = g.ageDays != null ? Math.max(0, 1 - g.ageDays / 90) : 0;
    g.score = Math.round(Math.log10(1 + g.playing) * 100 * (1 + growth / 200) * (1 + fresh));
  }

  const all = Object.values(games);
  const totalPlayers = all.reduce((a, g) => a + g.playing, 0);

  const gmap = new Map();
  for (const g of all) {
    const k = g.genre || 'Other';
    if (!gmap.has(k)) gmap.set(k, { name: k, players: 0, games: 0, newPlayers: 0, newGames: 0, p24: 0, p24base: 0, subs: {}, top: [] });
    const o = gmap.get(k);
    o.players += g.playing; o.games++;
    if (g.ageDays != null && g.ageDays <= NEW_DAYS) { o.newPlayers += g.playing; o.newGames++; }
    const prev = ago24?.p?.[g.id];
    if (prev != null) { o.p24 += g.playing; o.p24base += prev; }
    if (g.sub) o.subs[g.sub] = (o.subs[g.sub] || 0) + g.playing;
    o.top.push(g);
  }
  const genres = [...gmap.values()].map(o => ({
    name: o.name, players: o.players, games: o.games, newPlayers: o.newPlayers, newGames: o.newGames,
    share: totalPlayers ? Math.round(o.players / totalPlayers * 1000) / 10 : 0,
    change24: o.p24base > 0 ? Math.round((o.p24 - o.p24base) / o.p24base * 1000) / 10 : null,
    subs: Object.entries(o.subs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, players]) => ({ name, players })),
    top: o.top.sort((a, b) => b.playing - a.playing).slice(0, 5).map(g => g.id)
  })).sort((a, b) => b.players - a.players);

  const formats = FORMATS.map(([name, re]) => {
    const hit = all.filter(g => re.test(g.clean) || re.test(g.name));
    const fresh = hit.filter(g => g.ageDays != null && g.ageDays <= NEW_DAYS);
    return {
      name,
      games: hit.length,
      players: hit.reduce((a, g) => a + g.playing, 0),
      newGames: fresh.length,
      newPlayers: fresh.reduce((a, g) => a + g.playing, 0),
      examples: hit.sort((a, b) => b.playing - a.playing).slice(0, 4).map(g => g.id)
    };
  }).filter(f => f.games > 0).sort((a, b) => (b.newPlayers * 3 + b.players) - (a.newPlayers * 3 + a.players));

  const kw = new Map();
  for (const g of all) {
    if (g.ageDays == null || g.ageDays > NEW_DAYS) continue;
    const words = new Set(g.clean.toLowerCase().replace(/[^a-z0-9+' ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)));
    for (const w of words) {
      const o = kw.get(w) || { word: w, games: 0, players: 0 };
      o.games++; o.players += g.playing; kw.set(w, o);
    }
  }
  const keywords = [...kw.values()].filter(k => k.games >= 2).sort((a, b) => b.players - a.players).slice(0, 40);

  const latest = {
    updated: new Date(NOW).toISOString(),
    hasHistory: !!ago24,
    hours: sparkSnaps.map(s => s.t),
    totals: { players: totalPlayers, games: all.length, newGames: all.filter(g => g.ageDays != null && g.ageDays <= NEW_DAYS).length },
    sorts: sortOut,
    genres,
    formats,
    keywords,
    games
  };

  await fs.writeFile(path.join(OUT, 'latest.json'), JSON.stringify(latest));
  await fs.writeFile(path.join(OUT, 'history.json'), JSON.stringify(hist));

  const lp = localParts(NOW);
  if (HOOK && (FORCE || (lp.hour >= 17 && state.lastPost !== lp.date))) {
    try {
      await postDiscord(latest);
      state.lastPost = lp.date;
      log('discord ok');
    } catch (e) { log('discord fail', e.message); }
  }
  state.lastRun = latest.updated;
  await fs.writeFile(path.join(OUT, 'state.json'), JSON.stringify(state));
  await fs.writeFile(path.join(OUT, 'README.md'), `Trend Radar data. Updated ${latest.updated}\n`);
  log('ok', all.length, 'games,', fmt(totalPlayers), 'players');
}

async function postDiscord(L) {
  const G = L.games;
  const trendSort = L.sorts.find(s => s.id === 'top-trending') || L.sorts[0];
  const trending = (trendSort?.ids || []).slice(0, 5).map(id => G[id]);
  const rockets = Object.values(G).filter(g => g.ageDays != null && g.ageDays <= NEW_DAYS).sort((a, b) => b.playing - a.playing).slice(0, 5);
  const line = (g, i) => `**${i + 1}.** [${g.clean.slice(0, 40)}](https://www.roblox.com/games/${g.place}) · 👥 ${fmt(g.playing)}${g.dPlay24 != null ? ` · ${g.dPlay24 >= 0 ? '📈 +' : '📉 '}${Math.abs(g.dPlay24) >= 10 ? Math.round(g.dPlay24) : g.dPlay24}%` : ''}`;
  const rline = (g, i) => `**${i + 1}.** [${g.clean.slice(0, 40)}](https://www.roblox.com/games/${g.place}) · 👥 ${fmt(g.playing)} · ${Math.round(g.ageDays)} days old`;
  const fmts = L.formats.slice(0, 3).map(f => `\`${f.name}\` · ${fmt(f.newPlayers)} players in new games`).join('\n');
  const genre = [...L.genres].filter(g => g.change24 != null && g.players > 5000).sort((a, b) => b.change24 - a.change24)[0];
  const embeds = [{
    title: '🔥 Roblox Trending Today',
    url: SITE,
    color: 0xff5a8a,
    thumbnail: trending[0]?.icon ? { url: trending[0].icon } : undefined,
    fields: [
      { name: '🔥 Top Trending', value: trending.map(line).join('\n') || '-' },
      { name: '🚀 Rockets (new games)', value: rockets.map(rline).join('\n') || '-' },
      { name: '💡 Hottest formats', value: fmts || '-' },
      ...(genre ? [{ name: '📊 Fastest growing genre', value: `**${genre.name}** ${genre.change24 >= 0 ? '+' : ''}${genre.change24}% in the last 24 hours` }] : []),
      { name: '​', value: `👉 **[See everything on Trend Radar](${SITE})**` }
    ],
    footer: { text: `${fmt(L.totals.players)} players tracked · ${L.totals.games} games` },
    timestamp: L.updated
  }];
  const r = await fetch(HOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Trend Radar', embeds }) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
