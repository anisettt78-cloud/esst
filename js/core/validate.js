/* ESST core: pure validation helpers (no DOM, unit-tested). The same rules are enforced again by the database. */
(function (g) {
  "use strict";
  const E = (g.ESST = g.ESST || {});
  const pad = (n) => String(n).padStart(2, "0");
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();            // m = 1..12
  const isoDate = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
  const todayISO = (now) => { const n = now || new Date(); return isoDate(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
  /* complete years between an ISO date and today (null if not a valid date) */
  function ageFrom(iso, now) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], n = now || new Date();
    let a = n.getFullYear() - y; if (n.getMonth() + 1 < mo || (n.getMonth() + 1 === mo && n.getDate() < d)) a--;
    return a;
  }
  /* returns null when fine, otherwise an i18n key */
  function birthError(y, m, d, now) {
    if (!y || !m || !d) return "auth.err.birth_required";
    y = +y; m = +m; d = +d;
    if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return "auth.err.birth_invalid";
    const iso = isoDate(y, m, d);
    if (iso > todayISO(now)) return "auth.err.birth_future";
    const a = ageFrom(iso, now);
    return a < 8 || a > 90 ? "auth.err.birth_age" : null;
  }
  const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim()) && String(s).trim().length <= 254;
  const validPassword = (s) => typeof s === "string" && s.length >= 6 && s.length <= 200;
  /* optional number inside a range: "" -> ok (null) */
  function rangeError(v, lo, hi) { if (v === "" || v == null) return null; const n = Number(String(v).replace(",", ".")); return isFinite(n) && n >= lo && n <= hi ? null : "range"; }
  const toNumber = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  E.validate = { pad, daysInMonth, isoDate, ageFrom, birthError, validEmail, validPassword, rangeError, toNumber };
})(typeof window !== "undefined" ? window : globalThis);
