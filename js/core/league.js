/* ESST core: league data helpers (cached), tournament-time formatting, shared match card. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k, v) => E.t(k, v);
  let teamCache = null, setCache = null, setAt = 0;

  async function teams(force) {
    if (!teamCache || force) { const rows = await E.api.rpc("teams_overview"); teamCache = new Map(rows.map((t) => [t.team_id, t])); }
    return teamCache;
  }
  async function settings(force) {
    if (!setCache || force || Date.now() - setAt > 60e3) { setCache = await E.api.from("tournament_settings").select("*").eq("id", 1).single(); setAt = Date.now(); }
    return setCache;
  }
  const tzOf = () => (setCache && setCache.timezone) || "Africa/Algiers";
  E.bus.on("session", () => { teamCache = null; setCache = null; });

  /* every viewer sees times in the TOURNAMENT time zone, so "16:00" means the same for everybody */
  const fmt = (o) => (iso) => { const d = new Date(iso); return isNaN(d) ? "" : new Intl.DateTimeFormat(E.i18n.locale, Object.assign({ timeZone: tzOf() }, o)).format(d); };
  const F = { time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }), day: fmt({ weekday: "long", day: "numeric", month: "long" }), short: fmt({ weekday: "short", day: "numeric", month: "short" }),
    full: fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }), dateKey: (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: tzOf(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) };

  /* local date/time in the tournament zone <-> UTC (used by the schedule editor) */
  function parts(iso) {
    const p = {}; for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: tzOf(), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso))) p[x.type] = x.value;
    return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute };
  }
  function toUtcISO(dateStr, timeStr) {
    const [y, m, d] = dateStr.split("-").map(Number), [hh, mm] = timeStr.split(":").map(Number), guess = Date.UTC(y, m - 1, d, hh, mm);
    const off = (ms) => { const p = {}; for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tzOf(), hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms))) p[x.type] = x.value; return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000); };
    let t = guess - off(guess) * 60000; const o2 = off(t); if (o2 !== off(guess)) t = guess - o2 * 60000; return new Date(t).toISOString();
  }

  const teamName = (t) => (t ? t.short_name || t.name : "?");
  const logo = (t, size) => E.ui.avatar({ logo_url: t && t.logo_url, full_name: t && t.name }, size || "sm", { square: true });
  function statusChip(m) { return m.status === "scheduled" ? null : el("span", { class: "st " + m.status, text: T("match.status." + m.status) }); }

  /* one fixture row; links to the match page */
  function matchCard(m, tm) {
    const h = tm.get(m.home_team_id), a = tm.get(m.away_team_id), done = m.status === "finished";
    const mid = done ? el("div", { class: "score" }, E.i18n.number(m.home_score), " – ", E.i18n.number(m.away_score)) : el("div", { class: "kick", text: F.time(m.kickoff_at) });
    return el("a", { class: "match-card card-press", href: "#/match/" + m.id, "aria-label": (h ? h.name : "") + " – " + (a ? a.name : "") },
      el("div", { class: "side" }, logo(h), el("span", { class: "nm ellipsis", text: teamName(h) })), el("div", { class: "mid" }, mid),
      el("div", { class: "side away" }, logo(a), el("span", { class: "nm ellipsis", text: teamName(a) })),
      el("div", { class: "match-meta" }, m.matchday ? el("span", { text: T("match.matchday", { n: m.matchday }) }) : null, !done ? el("span", { text: F.short(m.kickoff_at) }) : el("span", { text: F.short(m.kickoff_at) }), m.venue ? el("span", {}, icon("map-pin", { size: 20, class: "inl" }), m.venue) : null, statusChip(m)));
  }
  const matches = () => E.api.from("matches").select("id,home_team_id,away_team_id,kickoff_at,venue,status,home_score,away_score,round_name,matchday,leg").order("matchday").order("kickoff_at");
  E.league = { teams, settings, tzOf, F, parts, toUtcISO, logo, teamName, matchCard, statusChip, matches };
})(window);
