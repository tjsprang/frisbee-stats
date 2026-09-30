// Frisbee Stats: standings, playoffs, notifications, and the offline copy of league data.
// Loaded after stats.js and before the main script in index.html; these are plain globals it calls.

// ---------- Standings ----------
// Regular-season finished games only. Ranked by win % (a tie counts as half a win), then head-to-head,
// then point differential, then points scored.
function standings(teams, games) {
  const rows = Object.fromEntries(teams.map(t => [t.id, { team: t, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, form: [] }]));
  const h2h = {};   // "a|b" → a's point differential against b
  const done = games.filter(g => g.status === 'final' && (g.stage || 'regular') === 'regular' && rows[g.homeId] && rows[g.awayId])
    .sort((a, b) => a.created - b.created);
  for (const g of done) {
    const sides = [[g.homeId, g.awayId], [g.awayId, g.homeId]];
    for (const [us, them] of sides) {
      const r = rows[us], a = score(g, us), b = score(g, them);
      r.gp++; r.pf += a; r.pa += b;
      const res = a > b ? 'W' : a < b ? 'L' : 'T';
      r[res === 'W' ? 'w' : res === 'L' ? 'l' : 't']++;
      r.form.push({ res, g });
      h2h[`${us}|${them}`] = (h2h[`${us}|${them}`] || 0) + a - b;
    }
  }
  const list = Object.values(rows).map(r => {
    r.pct = r.gp ? (r.w + r.t / 2) / r.gp : 0;
    r.diff = r.pf - r.pa;
    let n = 0; const last = r.form.at(-1)?.res;
    for (let i = r.form.length - 1; i >= 0 && r.form[i].res === last; i--) n++;
    r.streak = last ? `${last}${n}` : '—';
    return r;
  });
  return list.sort((a, b) => (b.pct - a.pct) || ((h2h[`${b.team.id}|${a.team.id}`] || 0) - (h2h[`${a.team.id}|${b.team.id}`] || 0))
    || (b.diff - a.diff) || (b.pf - a.pf) || a.team.name.localeCompare(b.team.name));
}

function renderStandings() {
  const s = viewSeason(), table = standings(seasonTeams(), seasonGames());
  const pctText = p => p.toFixed(3).replace(/^0/, '');
  const hasPlayoffs = !!s?.playoffs;
  app.innerHTML = `
    <div class="row"><h1>Standings</h1>
      ${db.playoffsReady && (hasPlayoffs || canEdit()) ? `<a class="btn small" href="#/playoffs">🏆 Playoffs</a>` : ''}
      <button class="small" onclick="exportStandings()" title="Download as a spreadsheet">⬇ CSV</button></div>
    ${seasonPicker('pickSeason')}
    <p class="muted">Regular-season games. Ranked by win % (ties count as half a win), then head-to-head, point differential and points scored.</p>
    ${table.length ? `<div class="card"><div class="table-wrap"><table class="standings">
      <thead><tr><th>#</th><th class="l">Team</th><th title="Games played">GP</th><th>W</th><th>L</th><th>T</th>
        <th title="Win percentage">Pct</th><th title="Points for">PF</th><th title="Points against">PA</th><th title="Point differential">+/-</th>
        <th class="l">Last 5</th><th title="Current streak">Strk</th></tr></thead>
      <tbody>${table.map((r, i) => `<tr class="${r.team.players.some(p => p.userId === me()) ? 'me' : ''}">
        <td>${i + 1}</td>
        <td class="l"><a href="#/team/${r.team.id}" style="color:inherit"><span class="dot" style="background:${esc(r.team.color)}"></span>${esc(r.team.name)}</a></td>
        <td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td><b>${pctText(r.pct)}</b></td>
        <td>${r.pf}</td><td>${r.pa}</td><td>${r.diff > 0 ? '+' : ''}${r.diff}</td>
        <td class="l"><span class="form">${r.form.slice(-5).map(f => `<a href="#/box/${f.g.id}" class="form-${f.res}" title="${f.res === 'W' ? 'Win' : f.res === 'L' ? 'Loss' : 'Tie'}">${f.res}</a>`).join('')}</span></td>
        <td>${r.streak}</td></tr>`).join('')}</tbody>
    </table></div></div>` : '<p class="muted">No teams yet.</p>'}`;
}

// ---------- Playoffs ----------
// A single-elimination bracket stored on the season as { size, seeds: [teamId, …] } (seed 1 first).
// Round 1 pairs seeds the standard way (1 v 8, 4 v 5, 2 v 7, 3 v 6 …). Missing seeds are byes: the higher seed
// goes straight through. Each later-round game is created once both of its teams are known.
function seedOrder(size) {
  let o = [1, 2];
  while (o.length < size) { const n = o.length * 2 + 1; o = o.flatMap(s => [s, n - s]); }
  return o;
}
const roundName = (r, rounds) => (r === rounds ? 'Final' : r === rounds - 1 ? 'Semifinals' : r === rounds - 2 ? 'Quarterfinals' : `Round ${r}`);

function bracketOf(season) {
  const def = season?.playoffs;
  if (!def) return null;
  const rounds = Math.log2(def.size), order = seedOrder(def.size);
  const games = db.games.filter(g => g.seasonId === season.id && g.stage === 'playoff');
  const matches = {};
  const winnerOf = m => {
    if (!m) return null;
    const [a, b] = m.teams;
    if (m.round === 1 && (a == null) !== (b == null)) return a ?? b;   // bye
    if (!m.game || m.game.status !== 'final') return null;
    const sa = score(m.game, m.game.homeId), sb = score(m.game, m.game.awayId);
    return sa === sb ? null : sa > sb ? m.game.homeId : m.game.awayId;
  };
  const list = [];
  for (let r = 1; r <= rounds; r++) {
    const count = def.size / 2 ** r;
    for (let m = 1; m <= count; m++) {
      const slot = `R${r}M${m}`;
      const teams = r === 1
        ? [def.seeds[order[2 * m - 2] - 1] ?? null, def.seeds[order[2 * m - 1] - 1] ?? null]
        : [winnerOf(matches[`R${r - 1}M${2 * m - 1}`]), winnerOf(matches[`R${r - 1}M${2 * m}`])];
      const match = { slot, round: r, m, teams, game: games.find(g => g.bracketSlot === slot) || null,
        seeds: r === 1 ? [order[2 * m - 2], order[2 * m - 1]] : null };
      match.bye = r === 1 && (teams[0] == null || teams[1] == null);
      match.winner = winnerOf(match);
      matches[slot] = match; list.push(match);
    }
  }
  const final = matches[`R${rounds}M1`];
  return { def, rounds, matches: list, champion: final?.winner || null };
}

// Create any playoff games whose two teams are now known. Safe to call any time (admins only).
function advanceBracket(season = activeSeason()) {
  const b = bracketOf(season);
  if (!b || !canEdit()) return;
  for (const m of b.matches) {
    if (m.bye || m.game || !m.teams[0] || !m.teams[1]) continue;
    const g = { id: uid(), homeId: m.teams[0], awayId: m.teams[1], created: Date.now(), status: 'scheduled', events: [],
      seasonId: season.id, stage: 'playoff', bracketSlot: m.slot, when: localDateTime(new Date()), field: 1, round: m.round };
    db.games.push(g); saveGame(g);
  }
}

let playoffSize = null;
function renderPlayoffs() {
  const s = viewSeason();
  if (!db.playoffsReady) { app.innerHTML = '<h1>Playoffs</h1><p class="msg error">Playoffs need a database update (supabase/008_playoffs.sql).</p>'; return; }
  const b = bracketOf(s);
  if (!b) {
    const table = standings(seasonTeams(), seasonGames());
    if (!canEdit()) { app.innerHTML = `<div class="row"><h1>Playoffs</h1><a class="btn small" href="#/standings">← Standings</a></div>${seasonPicker('pickSeason')}<p class="muted">No playoffs have been set up for ${esc(s?.name || 'this season')}.</p>`; return; }
    const n = Math.min(16, table.length);
    playoffSize = Math.min(Math.max(2, playoffSize || Math.min(8, n)), n);
    app.innerHTML = `
      <div class="row"><h1>Set up playoffs</h1><a class="btn small" href="#/standings">← Standings</a></div>
      ${n < 2 ? '<p class="muted">You need at least two teams.</p>' : `
      <div class="card">
        <label class="field">How many teams make the playoffs?
          <select onchange="playoffSize = +this.value; renderPlayoffs()">${Array.from({ length: n - 1 }, (_, i) => i + 2).map(k =>
            `<option value="${k}" ${k === playoffSize ? 'selected' : ''}>${k} teams</option>`).join('')}</select></label>
        <p class="muted">Seeded from the current standings. ${playoffSize & (playoffSize - 1) ? 'Top seeds get a first-round bye.' : ''}</p>
        <ol class="seed-list">${table.slice(0, playoffSize).map(r => `<li><span class="dot" style="background:${esc(r.team.color)}"></span>${esc(r.team.name)}
          <span class="muted">${r.w}–${r.l}${r.t ? `–${r.t}` : ''}</span></li>`).join('')}</ol>
        <button class="primary" style="width:100%" onclick="createPlayoffs()">Create bracket</button>
      </div>`}`;
    return;
  }
  const byRound = r => b.matches.filter(m => m.round === r);
  const teamLine = (m, i) => {
    const tid = m.teams[i], t = tid && team(tid), g = m.game;
    const sc = g && g.status !== 'scheduled' && tid ? score(g, tid) : '';
    const seed = m.seeds ? `<span class="seed">${m.seeds[i] <= b.def.seeds.length ? m.seeds[i] : ''}</span>` : '';
    return `<div class="bteam ${m.winner && m.winner === tid ? 'won' : ''}">${seed}${t ? `<span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}`
      : `<span class="muted">${m.bye && m.round === 1 ? 'Bye' : 'TBD'}</span>`}<b>${sc}</b></div>`;
  };
  const card = m => {
    if (m.bye) return `<div class="bmatch bye">${teamLine(m, 0)}${teamLine(m, 1)}</div>`;
    const g = m.game, href = g ? (g.status === 'live' && canEdit() ? `#/game/${g.id}` : `#/box/${g.id}`) : null;
    const status = !g ? '' : g.status === 'live' ? '<span class="badge live">LIVE</span>' : g.status === 'final' ? (m.winner ? '' : '<span class="badge live">TIED</span>') : '';
    return `<div class="bmatch">${href ? `<a href="${href}">` : '<div>'}${teamLine(m, 0)}${teamLine(m, 1)}${href ? '</a>' : '</div>'}
      <div class="bfoot">${status}${g && g.status === 'scheduled' && canEdit() ? `<button class="small primary" onclick="startScheduled('${g.id}')">Start</button>` : ''}</div></div>`;
  };
  const ties = b.matches.some(m => m.game?.status === 'final' && !m.winner);
  app.innerHTML = `
    <div class="row"><h1>Playoffs</h1><a class="btn small" href="#/standings">← Standings</a></div>
    ${seasonPicker('pickSeason')}
    ${b.champion ? `<div class="card champion">🏆 <b>${esc(team(b.champion).name)}</b> won ${esc(s.name)}!</div>` : ''}
    ${ties ? '<p class="msg error">A playoff game ended in a tie, so no one can advance. Reopen it and record the deciding point.</p>' : ''}
    <div class="bracket">${Array.from({ length: b.rounds }, (_, i) => i + 1).map(r => `
      <div class="bround"><div class="bround-name">${roundName(r, b.rounds)}</div>${byRound(r).map(card).join('')}</div>`).join('')}
    </div>
    ${canEdit() ? '<button class="small" style="margin-top:12px" onclick="resetPlayoffs()">Reset playoffs</button>' : ''}`;
}

async function createPlayoffs() {
  const s = activeSeason(), table = standings(seasonTeams(), seasonGames());
  const seeds = table.slice(0, playoffSize).map(r => r.team.id);
  let size = 2; while (size < seeds.length) size *= 2;
  const def = { size, seeds };
  const { data, error } = await sb.rpc('set_season_playoffs', { p_season_id: s.id, p_playoffs: def });
  if (error) return toast(dbErrorText(error));
  s.playoffs = data.playoffs;
  advanceBracket(s);
  toast('Bracket created! First-round games are on the Games page, ready to start.');
  renderPlayoffs();
}

async function resetPlayoffs() {
  const s = activeSeason(), games = db.games.filter(g => g.seasonId === s.id && g.stage === 'playoff');
  const played = games.filter(g => g.status !== 'scheduled').length;
  if (!confirm(`Remove the bracket and its ${games.length} playoff game${games.length === 1 ? '' : 's'}${played ? ` (${played} already played, with their stats)` : ''}?`)) return;
  const { error } = await sb.rpc('set_season_playoffs', { p_season_id: s.id, p_playoffs: null });
  if (error) return toast(dbErrorText(error));
  s.playoffs = null;
  const ids = games.map(g => g.id);
  db.games = db.games.filter(g => !ids.includes(g.id));
  persist(ids.length && { del: 'games', vals: ids });
  renderPlayoffs();
}

// ---------- Notifications (in the app) ----------
// Kept on this device per account. While the app is open (or installed and in the background), they can
// also show as phone notifications once allowed.
const notesKey = () => `frisbee-notes:${session?.user.id}`;
function loadNotes() { try { return JSON.parse(localStorage.getItem(notesKey())) || []; } catch { return []; } }
function saveNotes(n) { try { localStorage.setItem(notesKey(), JSON.stringify(n.slice(0, 50))); } catch {} }

function notify(text, link = '') {
  const notes = loadNotes();
  notes.unshift({ id: uid(), at: Date.now(), text, link, league: league?.name || '', read: false });
  saveNotes(notes);
  updateBell();
  toast(text);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const opts = { body: league?.name || '', icon: 'icon-192.png', tag: text, data: { link } };
    navigator.serviceWorker?.getRegistration().then(r => (r ? r.showNotification(text, opts) : new Notification(text, opts))).catch(() => {});
  }
}

function updateBell() {
  const el = document.getElementById('bell-count');
  if (!el) return;
  const n = session ? loadNotes().filter(x => !x.read).length : 0;
  el.textContent = n > 9 ? '9+' : n || '';
  el.style.display = n ? '' : 'none';
}

function openNotes() {
  const notes = loadNotes();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  openSheet(`
    <h3>🔔 Notifications</h3>
    ${perm === 'default' ? '<button class="small" style="margin-bottom:10px" onclick="askNotifyPermission()">Turn on phone alerts</button>' : ''}
    ${perm === 'denied' ? '<p class="muted" style="font-size:13px">Phone alerts are blocked for this site in your browser settings.</p>' : ''}
    ${notes.length ? `<div class="notes">${notes.map(n => `
      <a class="note ${n.read ? '' : 'unread'}" href="${n.link || '#/'}" onclick="closeSheet()">
        <span>${esc(n.text)}</span><span class="muted">${esc(n.league)} · ${timeAgo(n.at)}</span></a>`).join('')}</div>`
      : '<p class="muted">Nothing yet. You’ll see claim requests, games going live, final scores and more here.</p>'}
    <div class="actions" style="margin-top:12px">
      ${notes.length ? '<button onclick="clearNotes()">Clear all</button>' : ''}
      <button class="${notes.length ? '' : 'full'}" onclick="closeSheet()">Close</button>
    </div>`);
  saveNotes(notes.map(n => ({ ...n, read: true })));
  updateBell();
}
function clearNotes() { saveNotes([]); updateBell(); closeSheet(); }
async function askNotifyPermission() {
  const p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Phone alerts are on for this device.' : 'Phone alerts stay off.');
  openNotes();
}
function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
}

// ---------- Offline copy of league data ----------
// The last loaded league is kept in IndexedDB, so the app can open (read-only until back online, with any
// new plays queued) without signal.
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('frisbee-stats', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('leagues');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function saveSnapshot(id, data) {
  try {
    const d = await idb();
    d.transaction('leagues', 'readwrite').objectStore('leagues').put({ data, at: Date.now(), user: session?.user.id }, id);
  } catch {}
}
async function loadSnapshot(id) {
  try {
    const d = await idb();
    return await new Promise(res => {
      const r = d.transaction('leagues').objectStore('leagues').get(id);
      r.onsuccess = () => res(r.result?.user === session?.user.id ? r.result : null); r.onerror = () => res(null);
    });
  } catch { return null; }
}
