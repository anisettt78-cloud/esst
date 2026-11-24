/* ESST core: form building blocks (field wrapper, password with show/hide, segmented choice, 3-select birth date). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, V = E.validate, T = (k, v) => E.t(k, v);
  let seq = 0; const nid = (p) => p + "-" + ++seq;

  /* label + control + error line. control must be an element (or has .focusTarget) */
  function field(label, control, o) {
    o = o || {}; const id = nid("f"), err = el("div", { class: "field-error", id: id + "-e", role: "alert" });
    const target = control.querySelector ? (control.matches("input,select,textarea") ? control : control.querySelector("input,select,textarea")) : null;
    if (target && !target.id) target.id = id;
    const lab = el("label", { for: target ? target.id : null, text: label }); if (o.optional) lab.appendChild(el("span", { class: "faint", text: " " + T("profile.optional") }));
    const wrap = el("div", { class: "field" }, lab, control, o.hint ? el("div", { class: "tiny faint", text: o.hint }) : null, err);
    return { el: wrap, input: target, setError(msg) { err.textContent = msg || ""; if (target) { if (msg) { target.setAttribute("aria-invalid", "true"); target.setAttribute("aria-describedby", err.id); } else { target.removeAttribute("aria-invalid"); target.removeAttribute("aria-describedby"); } } return !msg; } };
  }
  const input = (o) => el("input", Object.assign({ class: "input" }, o));

  function password(o) {
    const inp = input(Object.assign({ type: "password", autocomplete: "current-password", minlength: "6", maxlength: "200" }, o));
    const btn = el("button", { type: "button", class: "icon-btn", "aria-label": T("auth.password.show"), style: { position: "absolute", insetInlineEnd: "2px", top: "0" }, on: { click: () => {
      const show = inp.type === "password"; inp.type = show ? "text" : "password"; btn.setAttribute("aria-label", T(show ? "auth.password.hide" : "auth.password.show")); btn.replaceChildren(icon(show ? "eye-off" : "eye")); inp.focus(); } } }, icon("eye"));
    inp.style.paddingInlineEnd = "48px";
    return el("div", { style: { position: "relative" } }, inp, btn);
  }

  /* one-of-many chips (radio group). items: [[value, label], ...] */
  function segmented(items, value, onChange, label, allowClear) {
    let cur = value || null; const btns = [];
    const wrap = el("div", { class: "row wrap", role: "radiogroup", "aria-label": label || null });
    const paint = () => btns.forEach(([v, b]) => { b.setAttribute("aria-checked", String(v === cur)); b.classList.toggle("on", v === cur); });
    items.forEach(([v, text]) => { const b = el("button", { type: "button", role: "radio", class: "chip", style: { minHeight: "44px", padding: "0 16px" }, on: { click: () => { cur = (cur === v && allowClear) ? null : v; paint(); if (onChange) onChange(cur); } } }, text); btns.push([v, b]); wrap.appendChild(b); });
    paint();
    return { el: wrap, get value() { return cur; }, set(v) { cur = v; paint(); } };
  }

  /* birth date: day / month / year selects (native pickers on phones). Same rules as the database: real date, not in the future, age 8-90. */
  function birthDate(initialISO) {
    const now = new Date(), thisYear = now.getFullYear();
    const monthName = (m) => new Intl.DateTimeFormat(E.i18n.locale, { month: "long" }).format(new Date(2000, m - 1, 1));
    const sel = (aria, ph) => { const s = el("select", { class: "select", "aria-label": aria, autocomplete: "bday-" + (aria === T("profile.day") ? "day" : aria === T("profile.month") ? "month" : "year") }); s.appendChild(el("option", { value: "", text: ph, disabled: true, selected: true })); return s; };
    const sd = sel(T("profile.day"), T("profile.day")), sm = sel(T("profile.month"), T("profile.month")), sy = sel(T("profile.year"), T("profile.year"));
    for (let d = 1; d <= 31; d++) sd.appendChild(el("option", { value: String(d), text: E.i18n.number(d) }));
    for (let m = 1; m <= 12; m++) sm.appendChild(el("option", { value: String(m), text: monthName(m) }));
    for (let y = thisYear - 8; y >= thisYear - 90; y--) sy.appendChild(el("option", { value: String(y), text: String(y) }));
    const age = el("div", { class: "tiny muted", "aria-live": "polite" }), err = el("div", { class: "field-error", role: "alert" });
    const fix = () => {                                    // hide days that do not exist (30 Feb) and keep the choice valid
      const y = +sy.value || 2000, m = +sm.value || 1, max = V.daysInMonth(y, m);
      Array.from(sd.options).forEach((o) => { if (o.value) o.hidden = o.disabled = +o.value > max; });
      if (+sd.value > max) sd.value = String(max);
    };
    const refresh = () => { fix(); const e = V.birthError(sy.value, sm.value, sd.value); age.textContent = !e && sy.value ? T("profile.age", { n: V.ageFrom(V.isoDate(+sy.value, +sm.value, +sd.value)) }) : ""; if (!e) setErr(null); };
    const setErr = (k) => { err.textContent = k ? T(k) : ""; [sd, sm, sy].forEach((s) => (k ? s.setAttribute("aria-invalid", "true") : s.removeAttribute("aria-invalid"))); };
    [sd, sm, sy].forEach((s) => s.addEventListener("change", refresh));
    const set = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); if (!m) return; sy.value = String(+m[1]); sm.value = String(+m[2]); sd.value = String(+m[3]); refresh(); };
    if (initialISO) set(initialISO);
    const grid = el("div", { class: "birth-row" }, sd, sm, sy);
    const lab = el("label", { class: "label", text: T("profile.birth") });
    return { el: el("div", { class: "field", role: "group", "aria-label": T("profile.birth") }, lab, grid, age, err),
      iso() { return sy.value && sm.value && sd.value ? V.isoDate(+sy.value, +sm.value, +sd.value) : null; },
      validate() { const e = V.birthError(sy.value, sm.value, sd.value); setErr(e); if (e) (!sd.value ? sd : !sm.value ? sm : sy).focus(); return !e; }, set };
  }
  E.forms = { field, input, password, segmented, birthDate };
})(window);
