// Frisbee Stats: the stats engine and the charts.
// Loaded before the main script in index.html; everything here is a plain global the page calls.
// Formulas follow UltiAnalytics' published calculations (ultianalytics.com/calcs.html).

// ---------- Stats engine ----------
const ZERO = () => ({
  g: 0, a: 0, ha: 0, d: 0, c: 0, ta: 0, st: 0, dr: 0,   // goals, assists, hockey assists, Ds, callahans, throwaways, stalls, drops
  th: 0, ca: 0, tou: 0, taT: 0, stT: 0, drT: 0,          // throws, catches, touches (+ turnovers in pass-tracked games)
  pu: 0, pob: 0,                                         // pulls, out-of-bounds pulls
  pp: 0, op: 0, dp: 0, min: 0, oeN: 0, deN: 0, gp: 0     // points played (O / D), minutes, O/D efficiency sums, games played
});
const TEAM_ZERO = () => ({ oPts: 0, dPts: 0, holds: 0, breaks: 0, broken: 0, scored: 0, allowed: 0, turnovers: 0, oppTurnovers: 0, convPts: 0, convGoals: 0 });

// Games recorded pass by pass have pickups and passes; older games only have goals, Ds and turnovers.
const isPassTracked = g => g.events.some(e => e.type === 'pickup' || e.type === 'pass');

// Everything that happened in one game, point by point.
function analyzeGame(g) {
  const other = t => (t === g.homeId ? g.awayId : g.homeId);
  const players = {}, P = id => players[id] || (players[id] = ZERO());
  const teams = { [g.homeId]: TEAM_ZERO(), [g.awayId]: TEAM_ZERO() };
  const tracked = isPassTracked(g);
  const points = [], possessions = [], flows = [], passes = [];
  const score = { [g.homeId]: 0, [g.awayId]: 0 };
  let point = null, poss = null;
  let lastPassFrom = null; // who threw to the current holder (for hockey assists)
  const endPoss = result => { if (poss && tracked) possessions.push({ ...poss, result }); poss = null; lastPassFrom = null; };
  const turnover = (e, tid) => { teams[tid].turnovers++; teams[other(tid)].oppTurnovers++; point.turns++; endPoss('turn'); };

  for (const e of g.events) {
    if (e.type === 'half') { point = null; poss = null; lastPassFrom = null; continue; }
    if (!point) point = { n: points.length + 1, pulling: null, receiving: null, start: e.t, throws: 0, turns: 0 };
    switch (e.type) {
      case 'pull':
        point.pulling = e.teamId; point.receiving = other(e.teamId); point.start = e.t;
        if (e.playerId) { P(e.playerId).pu++; if (e.detail?.ob) P(e.playerId).pob++; }
        break;
      case 'pickup':
        P(e.playerId).tou++;
        poss = { team: e.teamId, throws: 0 }; lastPassFrom = null;
        break;
      case 'pass':
        P(e.playerId).th++; P(e.targetId).ca++; P(e.targetId).tou++;
        passes.push([e.playerId, e.targetId]);
        point.throws++; if (poss) poss.throws++;
        lastPassFrom = e.playerId;
        break;
      case 'throwaway':
        P(e.playerId).ta++;
        if (tracked) { P(e.playerId).th++; P(e.playerId).taT++; point.throws++; if (poss) poss.throws++; }
        turnover(e, e.teamId);
        break;
      case 'drop':
        P(e.playerId).dr++;
        if (tracked) {
          P(e.playerId).drT++;
          if (e.assistId) { P(e.assistId).th++; point.throws++; if (poss) poss.throws++; }
        }
        turnover(e, e.teamId);
        break;
      case 'stall':
        P(e.playerId).st++; if (tracked) P(e.playerId).stT++;
        turnover(e, e.teamId);
        break;
      case 'd':
        P(e.playerId).d++;
        break;
      case 'goal':
      case 'callahan': {
        const s = P(e.playerId);
        s.g++;
        if (e.type === 'callahan') { s.d++; s.c++; s.tou++; }
        else {
          if (tracked) { s.ca++; s.tou++; }
          if (e.assistId) {
            P(e.assistId).a++;
            let hockey = null;
            if (tracked) {
              P(e.assistId).th++; passes.push([e.assistId, e.playerId]);
              point.throws++; if (poss) poss.throws++;
              hockey = lastPassFrom && lastPassFrom !== e.playerId ? lastPassFrom : null;
              if (hockey) P(hockey).ha++;
            }
            flows.push({ h: hockey, a: e.assistId, g: e.playerId });
          }
          endPoss('score');
        }
        // The point is over.
        const scorer = e.teamId, loser = other(scorer);
        score[scorer]++;
        teams[scorer].scored++; teams[loser].allowed++;
        if (point.pulling) {
          const O = point.receiving, D = point.pulling;
          teams[O].oPts++; teams[D].dPts++;
          if (scorer === O) teams[O].holds++; else { teams[D].breaks++; teams[O].broken++; }
        }
        // Minutes: a point that seems to last over an hour was probably paused, so credit 5 (as UltiAnalytics does).
        const dur = point.pulling ? (e.t - point.start) / 60000 : 0;
        const mins = dur > 60 || dur < 0 ? 5 : dur;
        for (const [tid, ids] of Object.entries(e.played || {})) {
          for (const id of ids) {
            const p = P(id); p.pp++;
            if (!point.pulling) continue;
            const delta = tid === scorer ? 1 : -1;
            if (tid === point.receiving) { p.op++; p.oeN += delta; } else { p.dp++; p.deN += delta; }
            p.min += mins;
          }
        }
        points.push({ ...point, end: e.t, scorer, type: e.type, scorerId: e.playerId, assistId: e.assistId || null,
          score: [score[g.homeId], score[g.awayId]], played: e.played || null });
        point = null; poss = null; lastPassFrom = null;
        break;
      }
    }
  }
  // Conversion rate only counts games where pulls were recorded (so O points are known).
  if (points.some(p => p.pulling)) for (const tid of [g.homeId, g.awayId]) {
    teams[tid].convPts = teams[tid].oPts + teams[tid].oppTurnovers;
    teams[tid].convGoals = teams[tid].scored;
  }
  return { g, players, teams, points, possessions, flows, passes, tracked, score };
}

// Add up many games. Scheduled games are skipped.
function analyze(games) {
  const out = { players: {}, teams: {}, possessions: [], flows: [], passes: [], games: [] };
  for (const g of games) {
    if (g.status === 'scheduled') continue;
    const r = analyzeGame(g);
    out.games.push(r);
    for (const [id, s] of Object.entries(r.players)) {
      const t = out.players[id] || (out.players[id] = ZERO());
      for (const k in s) t[k] += s[k];
    }
    for (const [tid, s] of Object.entries(r.teams)) {
      const t = out.teams[tid] || (out.teams[tid] = { ...TEAM_ZERO(), w: 0, l: 0, t: 0, gp: 0 });
      for (const k in s) t[k] += s[k];
      t.gp++;
      if (g.status === 'final') {
        const us = r.score[tid], them = r.score[tid === g.homeId ? g.awayId : g.homeId];
        if (us > them) t.w++; else if (us < them) t.l++; else t.t++;
      }
    }
    // Games played: everyone on both rosters.
    for (const tid of [g.homeId, g.awayId]) for (const p of team(tid)?.players || []) {
      (out.players[p.id] || (out.players[p.id] = ZERO())).gp++;
    }
    out.possessions.push(...r.possessions);
    out.flows.push(...r.flows);
    out.passes.push(...r.passes);
  }
  for (const s of Object.values(out.players)) finishPlayer(s);
  for (const t of Object.values(out.teams)) {
    t.offProd = t.oPts ? t.holds / t.oPts : null;
    t.conv = t.convPts ? t.convGoals / t.convPts : null;
  }
  return out;
}

// Derived numbers (null = can't be calculated, shown as *).
function finishPlayer(s) {
  s.to = s.ta + s.st + s.dr;
  s.pm = s.g + s.a + s.d - s.dr - s.ta - s.st;
  s.comp = s.th - s.taT;
  s.thp = s.th ? (s.th - s.taT - s.stT) / s.th : null;
  s.cp = s.ca + s.drT ? s.ca / (s.ca + s.drT) : null;
  s.oe = s.op ? s.oeN / s.op : null;
  s.de = s.dp ? s.deN / s.dp : null;
  const per = v => (s.pp ? v / s.pp : null);
  s.pmPP = per(s.pm); s.touPP = per(s.tou); s.gPP = per(s.g); s.aPP = per(s.a); s.dPP = per(s.d); s.toPP = per(s.to);
  return s;
}
const statsOf = (a, id) => a.players[id] || finishPlayer(ZERO());

// ---------- Stat columns, grouped like UltiAnalytics ----------
const fmtPct = v => (v == null ? '*' : `${Math.round(v * 100)}%`);
const fmtDec = v => (v == null ? '*' : v.toFixed(2));
const fmtInt = v => (v == null ? '*' : Math.round(v));
const STAT_CATS = {
  summary: { label: 'Summary', cols: [
    ['pp', 'PP', 'Points played'], ['pm', '+/-', 'Plus/minus'], ['oe', 'O eff', 'O efficiency', fmtDec],
    ['de', 'D eff', 'D efficiency', fmtDec], ['thp', 'Thr %', 'Throw percentage', fmtPct],
    ['g', 'G', 'Goals'], ['a', 'A', 'Assists'], ['d', 'D', 'Ds']] },
  passing: { label: 'Passing', cols: [
    ['th', 'Throws', 'Throws'], ['comp', 'Comp', 'Completions'], ['thp', 'Thr %', 'Throw percentage', fmtPct],
    ['a', 'Ast', 'Assists'], ['ha', 'Hky', 'Hockey assists'], ['taT', 'TA', 'Throwaways'], ['stT', 'Stall', 'Stalls']] },
  receiving: { label: 'Receiving', cols: [
    ['ca', 'Catch', 'Catches'], ['drT', 'Drop', 'Drops'], ['cp', 'Catch %', 'Catch percentage', fmtPct],
    ['g', 'Goals', 'Goals'], ['tou', 'Touch', 'Touches']] },
  time: { label: 'Playing time', cols: [
    ['gp', 'GP', 'Games played'], ['pp', 'PP', 'Points played'], ['op', 'O pts', 'O-line points'],
    ['dp', 'D pts', 'D-line points'], ['min', 'Min', 'Minutes played', fmtInt]] },
  defense: { label: 'Defense', cols: [
    ['d', 'Ds', 'Ds'], ['c', 'Cal', 'Callahans'], ['pu', 'Pulls', 'Pulls'], ['pob', 'OB', 'Out-of-bounds pulls']] },
  perPoint: { label: 'Per point', cols: [
    ['pmPP', '+/-', 'Plus/minus per point', fmtDec], ['touPP', 'Touch', 'Touches per point', fmtDec],
    ['gPP', 'G', 'Goals per point', fmtDec], ['aPP', 'A', 'Assists per point', fmtDec],
    ['dPP', 'D', 'Ds per point', fmtDec], ['toPP', 'TO', 'Turnovers per point', fmtDec]] }
};
let statCat = 'summary';

function statCatTabs(onchange) {
  return `<div class="cat-tabs" role="tablist">${Object.entries(STAT_CATS).map(([k, c]) =>
    `<button role="tab" aria-selected="${k === statCat}" class="${k === statCat ? 'on' : ''}"
      onclick="statCat = '${k}'; ${onchange}">${c.label}</button>`).join('')}</div>`;
}

// Columns for statTable(): the name column plus the current category's stats.
function statCols(nameCol) {
  return [nameCol, ...STAT_CATS[statCat].cols.map(([k, h, title, f]) => ({ k, h, title, f: f ? r => f(r[k]) : null }))];
}

// ---------- Charts ----------
// Hand-drawn SVG, sized to the screen so text stays readable. Colours come from the --series-* tokens.
// The page's content width minus its own padding (2 × 16px) and the card's padding and border (2 × 15px).
const chartWidth = () => Math.max(240, Math.min(660, (document.getElementById('app')?.clientWidth || 360) - 62));
const niceStep = max => (max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : 20);
const niceMax = v => { const s = niceStep(Math.max(v, 1)); return Math.max(s, Math.ceil(Math.max(v, 1) / s) * s); };
const attr = s => esc(s).replace(/\n/g, '&#10;');

// A column with a 4px rounded top and a square base.
function colPath(x, y, w, h) {
  const r = Math.min(4, h, w / 2);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function legend(items) {
  return `<div class="legend">${items.map(([cls, text]) =>
    `<span><i class="swatch ${cls}"></i>${esc(text)}</span>`).join('')}</div>`;
}

function tableTwin(head, rows) {
  return `<details class="table-twin"><summary>Show as table</summary><div class="table-wrap"><table>
    <thead><tr>${head.map((h, i) => `<th class="${i ? '' : 'l'}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${i ? '' : 'l'}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

// Score over the game: one line per team, point by point.
function scoreChart(r) {
  const g = r.g, pts = r.points;
  if (!pts.length) return '';
  const h = team(g.homeId), a = team(g.awayId);
  const W = chartWidth(), H = 210, pad = { l: 30, r: 34, t: 14, b: 30 };
  const n = pts.length, maxY = niceMax(Math.max(...pts.map(p => Math.max(...p.score))));
  const x = i => pad.l + (W - pad.l - pad.r) * (i / n);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / maxY);
  const step = niceStep(maxY);
  const halfAt = (() => { let goals = 0; for (const e of g.events) { if (e.type === 'half') return goals; if (e.type === 'goal' || e.type === 'callahan') goals++; } return null; })();
  const series = [[h, 0, 'series-1'], [a, 1, 'series-2']];
  const lineOf = idx => [[0, 0], ...pts.map((p, i) => [i + 1, p.score[idx]])].map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const endY = series.map(([, idx]) => y(pts[n - 1].score[idx]));
  const labelEnds = Math.abs(endY[0] - endY[1]) >= 14;
  const xTicks = [...new Set([1, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n])].filter(i => i >= 1);
  const tip = (p, i) => {
    const t = team(p.scorer), how = p.type === 'callahan' ? 'Callahan' : p.pulling ? (p.scorer === p.receiving ? 'hold' : 'break') : 'goal';
    return `Point ${i + 1}: ${t.name} scored (${how})\n${h.name} ${p.score[0]} – ${p.score[1]} ${a.name}`;
  };
  return `<div class="card chart">
    <div class="chart-title">Score by point</div>
    ${legend([['series-1', `${h.name} ${pts[n - 1].score[0]}`], ['series-2', `${a.name} ${pts[n - 1].score[1]}`]])}
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score by point: ${attr(h.name)} ${pts[n - 1].score[0]}, ${attr(a.name)} ${pts[n - 1].score[1]}">
      ${Array.from({ length: maxY / step + 1 }, (_, i) => i * step).map(v => `
        <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${xTicks.map(i => `<text class="tick" x="${x(i)}" y="${H - pad.b + 16}" text-anchor="middle">${i}</text>`).join('')}
      <text class="tick" x="${pad.l}" y="${H - 2}">Point</text>
      ${halfAt ? `<line class="axis" x1="${x(halfAt)}" x2="${x(halfAt)}" y1="${pad.t}" y2="${H - pad.b}"/>
        <text class="tick" x="${x(halfAt) + 4}" y="${pad.t + 10}">Half</text>` : ''}
      <line class="guide" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" style="display:none"/>
      ${series.map(([, idx, cls]) => `<polyline class="line ${cls}" points="${lineOf(idx)}"/>`).join('')}
      ${series.map(([, idx, cls], k) => `<circle class="dot ${cls}" cx="${x(n)}" cy="${endY[k]}" r="4"/>
        ${labelEnds ? `<text class="end-label" x="${x(n) + 8}" y="${endY[k] + 4}">${pts[n - 1].score[idx]}</text>` : ''}`).join('')}
      ${pts.map((p, i) => `<rect class="hit" tabindex="0" x="${x(i + 0.5)}" y="${pad.t}" width="${Math.max(1, x(1) - x(0))}" height="${H - pad.t - pad.b}"
        data-gx="${x(i + 1)}" data-tip="${attr(tip(p, i))}"/>`).join('')}
    </svg>
    ${tableTwin(['Point', h.name, a.name, 'Scored by'], pts.map((p, i) => [i + 1, p.score[0], p.score[1], team(p.scorer).name]))}
  </div>`;
}

// How many throws a possession took, split by whether it ended in a goal or a turnover.
const POSS_BUCKETS = [['0–1', 0, 1], ['2–4', 2, 4], ['5–8', 5, 8], ['9–12', 9, 12], ['13+', 13, Infinity]];
function possessionChart(possessions) {
  if (!possessions.length) return '';
  const count = (res, lo, hi) => possessions.filter(p => p.result === res && p.throws >= lo && p.throws <= hi).length;
  const rows = POSS_BUCKETS.map(([label, lo, hi]) => ({ label, score: count('score', lo, hi), turn: count('turn', lo, hi) }));
  const totals = { score: rows.reduce((s, r) => s + r.score, 0), turn: rows.reduce((s, r) => s + r.turn, 0) };
  const W = chartWidth(), H = 200, pad = { l: 30, r: 10, t: 12, b: 42 };
  const maxY = niceMax(Math.max(...rows.map(r => Math.max(r.score, r.turn)))), step = niceStep(maxY);
  const band = (W - pad.l - pad.r) / rows.length, bw = Math.min(24, band * 0.32);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / maxY);
  const base = y(0);
  const pct = (v, t) => (t ? ` (${Math.round((v / t) * 100)}% of ${t})` : '');
  return `<div class="card chart">
    <div class="chart-title">Passes per possession</div>
    ${legend([['series-1', 'Ended in a goal'], ['series-2', 'Ended in a turnover']])}
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Passes per possession">
      ${Array.from({ length: maxY / step + 1 }, (_, i) => i * step).map(v => `
        <line class="${v ? 'grid' : 'axis'}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${rows.map((r, i) => {
        const cx = pad.l + band * i + band / 2;
        const bars = [[r.score, 'series-1', cx - bw - 1, `${r.label} passes: ${r.score} ended in a goal${pct(r.score, totals.score)}`],
                      [r.turn, 'series-2', cx + 1, `${r.label} passes: ${r.turn} ended in a turnover${pct(r.turn, totals.turn)}`]];
        return bars.map(([v, cls, bx, t]) => `
          <path class="bar ${cls}" d="${colPath(bx, y(v), bw, base - y(v))}"/>
          <rect class="hit" tabindex="0" x="${bx - 2}" y="${pad.t}" width="${bw + 4}" height="${base - pad.t}" data-tip="${attr(t)}"/>`).join('')
          + `<text class="tick" x="${cx}" y="${base + 16}" text-anchor="middle">${r.label}</text>`;
      }).join('')}
      <text class="tick" x="${pad.l + (W - pad.l - pad.r) / 2}" y="${H - 6}" text-anchor="middle">Throws in the possession</text>
    </svg>
    ${tableTwin(['Throws', 'Ended in a goal', 'Ended in a turnover'], rows.map(r => [r.label, r.score, r.turn]))}
  </div>`;
}

// Where each side's goals came from: scored on offense (a hold) or on defense (a break).
function pointsPerLineChart(t, teamName) {
  if (!t.oPts && !t.dPts) return '';
  const us = [t.holds, t.breaks], them = [t.dPts - t.breaks, t.broken];
  const W = chartWidth(), rowH = 22, gapY = 34, pad = { l: 0, t: 6 };
  const H = pad.t + gapY * 2;
  const bars = [[teamName, us], ['Opponents', them]];
  const seg = (label, [o, d], row) => {
    const total = o + d, yy = pad.t + row * gapY + 14;
    if (!total) return `<text class="tick" x="0" y="${yy - 4}">${esc(label)}</text><text class="tick" x="0" y="${yy + 14}">No goals yet</text>`;
    // Two segments with a 2px gap between them (no gap when one side is empty).
    const gapX = o && d ? 2 : 0;
    const wO = (W - gapX) * (o / total), xD = wO + gapX, wD = W - xD;
    const parts = [[o, 0, wO, 'series-1', 'on offense (holds)'], [d, xD, wD, 'series-2', 'on defense (breaks)']];
    return `<text class="tick" x="0" y="${yy - 4}">${esc(label)} · ${total} goals</text>` + parts.filter(([v]) => v).map(([v, sx, sw, cls, what]) => `
      <rect class="bar ${cls}" x="${sx}" y="${yy}" width="${sw}" height="${rowH - 2}" rx="4"/>
      ${sw >= 30 ? `<text class="in-label" x="${sx + sw / 2}" y="${yy + 15}" text-anchor="middle">${v}</text>` : ''}
      <rect class="hit" tabindex="0" x="${sx}" y="${yy - 2}" width="${sw}" height="${rowH + 2}"
        data-tip="${attr(`${label}: ${v} of ${total} goals scored ${what}`)}"/>`).join('');
  };
  return `<div class="card chart">
    <div class="chart-title">Points per line</div>
    ${legend([['series-1', 'Scored on offense (hold)'], ['series-2', 'Scored on defense (break)']])}
    <svg width="${W}" height="${H + rowH}" viewBox="0 0 ${W} ${H + rowH}" role="img" aria-label="Points per line">
      ${bars.map(([label, v], i) => seg(label, v, i)).join('')}
    </svg>
    ${tableTwin(['', 'On offense (holds)', 'On defense (breaks)'], bars.map(([label, [o, d]]) => [label, o, d]))}
  </div>`;
}

// Hockey assist → assist → goal, as a three-column flow.
function flowChart(flows) {
  const withAssist = flows.filter(f => f.a);
  if (!withAssist.length) return '';
  const TOP = 8; // keep each column readable; the rest fold into "Others"
  const cols = ['h', 'a', 'g'].map(k => {
    const counts = {};
    for (const f of withAssist) if (f[k]) counts[f[k]] = (counts[f[k]] || 0) + 1;
    const sorted = Object.entries(counts).sort((x, y) => y[1] - x[1]);
    const keep = new Set(sorted.slice(0, TOP).map(([id]) => id));
    return { counts, keep, others: sorted.slice(TOP).reduce((s, [, c]) => s + c, 0) };
  });
  const key = (ci, id) => (id && cols[ci].keep.has(id) ? id : '__others');
  const nodes = cols.map((c, ci) => {
    const list = [...c.keep].map(id => ({ id, v: c.counts[id], name: player(id).name }));
    if (c.others) list.push({ id: '__others', v: c.others, name: 'Others' });
    return list;
  });
  const W = chartWidth(), colW = 10, gap = 6, pad = { t: 22, b: 6 };
  const maxTotal = Math.max(...nodes.map(col => col.reduce((s, n) => s + n.v, 0)));
  const maxNodes = Math.max(...nodes.map(col => col.length));
  const H = Math.max(180, maxNodes * 24 + pad.t + pad.b);
  const unit = (H - pad.t - pad.b - gap * (maxNodes - 1)) / maxTotal;
  const xs = [4, W / 2 - colW / 2, W - colW - 4];
  nodes.forEach((col, ci) => {
    let yy = pad.t;
    for (const n of col) { n.y = yy; n.h = Math.max(3, n.v * unit); n.outY = n.y; n.inY = n.y; yy += n.h + gap; }
  });
  const find = (ci, id) => nodes[ci].find(n => n.id === id);
  const links = {};
  for (const f of withAssist) {
    if (f.h) { const k = `0|${key(0, f.h)}|${key(1, f.a)}`; links[k] = (links[k] || 0) + 1; }
    const k2 = `1|${key(1, f.a)}|${key(2, f.g)}`; links[k2] = (links[k2] || 0) + 1;
  }
  const paths = Object.entries(links).sort((x, y) => y[1] - x[1]).map(([k, v]) => {
    const [ci, from, to] = k.split('|'); const c = +ci;
    const s = find(c, from), t = find(c + 1, to), th = Math.max(1.5, v * unit);
    const x0 = xs[c] + colW, x1 = xs[c + 1], y0 = s.outY + th / 2, y1 = t.inY + th / 2, mx = (x0 + x1) / 2;
    s.outY += th; t.inY += th;
    const verb = c === 0 ? 'hockey assists to' : 'assists to';
    return `<path class="flow" data-from="${c}:${from}" data-to="${c + 1}:${to}" d="M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}"
      stroke-width="${th}" tabindex="0" data-tip="${attr(`${s.name} ${verb} ${t.name}: ${v}`)}"/>`;
  }).join('');
  const nodeSvg = nodes.map((col, ci) => col.map(n => {
    const lx = ci === 2 ? xs[ci] - 6 : xs[ci] + colW + 6, anchor = ci === 2 ? 'end' : 'start';
    const what = ['hockey assists', 'assists', 'goals'][ci];
    return `<rect class="node" tabindex="0" data-node="${ci}:${n.id}" x="${xs[ci]}" y="${n.y}" width="${colW}" height="${n.h}" rx="2"
        data-tip="${attr(`${n.name}: ${n.v} ${what}`)}"/>
      ${n.h >= 11 || col.length <= 6 ? `<text class="node-label" x="${lx}" y="${n.y + Math.min(n.h, 18) / 2 + 4}" text-anchor="${anchor}">${esc(n.name)}</text>` : ''}`;
  }).join('')).join('');
  return `<div class="card chart">
    <div class="chart-title">Assists to goals</div>
    <div class="muted" style="font-size:13px">Who threw the hockey assist, the assist, and who caught the goal. Hover or tap a name to follow their connections.</div>
    <svg class="flow-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Assists to goals flow">
      <text class="tick" x="${xs[0]}" y="12">Hockey assist</text>
      <text class="tick" x="${xs[1] + colW / 2}" y="12" text-anchor="middle">Assist</text>
      <text class="tick" x="${xs[2] + colW}" y="12" text-anchor="end">Goal</text>
      ${paths}${nodeSvg}
    </svg>
    ${tableTwin(['Hockey assist', 'Assist', 'Goal'], withAssist.map(f => [f.h ? player(f.h).name : '—', player(f.a).name, player(f.g).name]))}
  </div>`;
}

// Stat tiles: a label and a big number.
function tiles(items) {
  return `<div class="tiles">${items.map(([label, value, note]) => `
    <div class="tile"><span class="tile-label">${esc(label)}</span><b>${esc(value)}</b>${note ? `<span class="tile-note">${esc(note)}</span>` : ''}</div>`).join('')}</div>`;
}

// ---------- Hover / tap details for chart marks ----------
(function chartTooltips() {
  const tip = document.createElement('div');
  tip.id = 'chart-tip'; tip.setAttribute('role', 'tooltip');
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tip));
  let lit = [];
  const hide = () => {
    tip.classList.remove('show');
    lit.forEach(el => el.classList.remove('lit')); lit = [];
    document.querySelectorAll('svg .guide').forEach(gl => { gl.style.display = 'none'; });
  };
  let shownAt = 0;
  const show = (el, px, py) => {
    shownAt = Date.now();
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, px - r.width / 2));
    const top = py - r.height - 14 < 8 ? py + 18 : py - r.height - 14;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
    // Score chart: a vertical guide at the hovered point.
    const svg = el.closest('svg'), guide = svg?.querySelector('.guide');
    if (guide && el.dataset.gx) { guide.setAttribute('x1', el.dataset.gx); guide.setAttribute('x2', el.dataset.gx); guide.style.display = ''; }
    // Flow chart: light up everything connected to the hovered name or link.
    lit.forEach(x => x.classList.remove('lit')); lit = [];
    if (svg?.classList.contains('flow-chart')) {
      const ids = el.dataset.node ? [el.dataset.node] : [el.dataset.from, el.dataset.to];
      lit = [...svg.querySelectorAll('.flow')].filter(p => el.dataset.node ? ids.includes(p.dataset.from) || ids.includes(p.dataset.to) : p === el);
      lit.forEach(x => x.classList.add('lit'));
    }
  };
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && el.closest('.chart')) show(el, e.clientX, e.clientY); else if (tip.classList.contains('show')) hide();
  });
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && el.closest('.chart')) show(el, e.clientX, e.clientY); else hide();
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el && el.closest('.chart')) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', hide);
  // Scrolling moves the marks away from the tip, so hide it (but not for the scroll a keyboard focus itself causes).
  window.addEventListener('scroll', () => { if (Date.now() - shownAt > 300) hide(); }, { passive: true });
})();
