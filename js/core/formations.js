/* ESST core: formations and lineup maths (pure functions, unit-tested).
   Slot numbering (stored in the database): slot 0 = goalkeeper, then defence -> attack, each row left -> right. */
(function (g) {
  "use strict";
  const E = (g.ESST = g.ESST || {});
  const FORMATIONS = { "4-4-2": [1, 4, 4, 2], "4-3-3": [1, 4, 3, 3], "4-2-3-1": [1, 4, 2, 3, 1], "3-5-2": [1, 3, 5, 2], "3-4-3": [1, 3, 4, 3], "5-3-2": [1, 5, 3, 2], "4-1-4-1": [1, 4, 1, 4, 1] };
  const ORDER = Object.keys(FORMATIONS), ROLES = ["goalkeeper", "defender", "midfielder", "forward"], roleIdx = (r) => Math.max(0, ROLES.indexOf(r));

  /* 11 slots with a position on the pitch in percent (x: 0 left .. 100 right, y: 0 = opponent goal .. 100 = own goal) and a role */
  function layout(formation) {
    const rows = FORMATIONS[formation]; if (!rows) throw new Error("unknown formation " + formation);
    const out = []; let slot = 0;
    rows.forEach((count, r) => {
      const y = rows.length === 1 ? 50 : 90 - r * (76 / (rows.length - 1)), role = r === 0 ? "goalkeeper" : r === 1 ? "defender" : r === rows.length - 1 ? "forward" : "midfielder";
      for (let i = 0; i < count; i++) out.push({ slot: slot++, x: Math.round(((i + 1) * 100 / (count + 1)) * 10) / 10, y: Math.round(y * 10) / 10, role, row: r });
    });
    return out;
  }
  /* put players (in the given order) on the slots whose role matches theirs; leftovers go to the nearest free role */
  function assignByRole(formation, players) {
    const L = layout(formation), res = new Array(11).fill(null), left = [];
    const byRole = {}; for (const p of players) (byRole[p.pos] = byRole[p.pos] || []).push(p);
    for (const role of ROLES) { const slots = L.filter((s) => s.role === role), list = byRole[role] || []; slots.forEach((s, i) => { if (list[i]) res[s.slot] = list[i].id; }); for (let i = slots.length; i < list.length; i++) left.push(list[i]); }
    for (const p of left) { let best = -1, d = 99; L.forEach((s) => { if (res[s.slot] == null) { const k = Math.abs(roleIdx(s.role) - roleIdx(p.pos)); if (k < d) { d = k; best = s.slot; } } }); if (best >= 0) res[best] = p.id; }
    return res;
  }
  /* best eleven for a formation: for each role the highest-rated players of that position, then players whose second position fits, then anybody */
  function autoFill(formation, roster) {
    const L = layout(formation), used = new Set(), res = new Array(11).fill(null), pool = roster.slice().sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
    const take = (slot, test) => { const p = pool.find((x) => !used.has(x.id) && test(x)); if (p) { used.add(p.id); res[slot.slot] = p.id; return true; } return false; };
    for (const role of ROLES) for (const s of L.filter((x) => x.role === role)) take(s, (p) => p.main_position === role);
    for (const s of L) if (res[s.slot] == null) take(s, (p) => p.secondary_position === s.role);
    for (const s of L) if (res[s.slot] == null) take(s, () => true);
    return res;
  }
  /* switching formation keeps the same players, each one in the row that matches the role of his old slot */
  function reassign(newFormation, oldFormation, slots) {
    const old = layout(oldFormation), players = [];
    slots.forEach((id, i) => { if (id) players.push({ id, pos: old[i].role }); });
    return assignByRole(newFormation, players);
  }
  /* tap / drag moves. They never lose or duplicate a player. */
  function place(slots, playerId, idx) {
    const s = slots.slice(), from = s.indexOf(playerId), prev = s[idx];
    if (from >= 0) s[from] = prev == null ? null : prev;       // already on the pitch: swap with whoever was there
    s[idx] = playerId; return s;
  }
  function swapSlots(slots, a, b) { const s = slots.slice(); [s[a], s[b]] = [s[b], s[a]]; return s; }
  function removeFromPitch(slots, playerId) { return slots.map((x) => (x === playerId ? null : x)); }
  const shortName = (p) => { if (!p) return ""; if (p.nickname) return p.nickname; const w = String(p.full_name || p.display_name || "").trim().split(/\s+/); return w.length > 1 ? w[w.length - 1] : w[0] || ""; };
  E.formations = { FORMATIONS, ORDER, ROLES, layout, assignByRole, autoFill, reassign, place, swapSlots, removeFromPitch, shortName };
})(typeof window !== "undefined" ? window : globalThis);
