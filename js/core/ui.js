/* ESST core: UI building blocks - toast, modal / bottom sheet (with scroll lock + focus trap), confirm dialog, avatar, empty state, skeletons. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon, $ } = E.u, T = (...a) => E.t(...a);

  /* ---- scroll lock (counted, keeps scroll position, no layout jump, nothing scrolls behind a modal) ---- */
  let locks = 0, savedY = 0;
  function lockScroll() {
    if (locks++ > 0) return;
    savedY = g.scrollY; const sw = g.innerWidth - document.documentElement.clientWidth;
    document.body.style.top = -savedY + "px"; if (sw > 0) document.body.style.paddingInlineEnd = sw + "px";
    document.body.classList.add("scroll-locked");
  }
  function unlockScroll() {
    if (--locks > 0) return; locks = 0;
    document.body.classList.remove("scroll-locked"); document.body.style.top = ""; document.body.style.paddingInlineEnd = "";
    g.scrollTo(0, savedY);
  }

  /* ---- toast ---- */
  function toast(message, type) {
    let box = $(".toasts"); if (!box) { box = el("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.appendChild(box); }
    const n = el("div", { class: "toast " + (type || "") }, icon(type === "err" ? "alert-triangle" : type === "ok" ? "check" : "info", { size: 20 }), el("span", { class: "grow", style: { flex: 1 } }, message));
    box.appendChild(n); setTimeout(() => { n.style.transition = "opacity .25s"; n.style.opacity = "0"; setTimeout(() => n.remove(), 260); }, type === "err" ? 5000 : 2800);
  }
  const toastError = (e) => toast(E.api.errorText(e), "err");

  /* ---- modal / bottom sheet. content: Node or array. Returns { close(), el } ---- */
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function modal(content, o) {
    o = o || {};
    const opener = document.activeElement;
    const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": o.label || null, tabindex: "-1" }, content);
    const overlay = el("div", { class: "overlay" }, sheet);
    let closed = false;
    function close(result) {
      if (closed) return; closed = true;
      document.removeEventListener("keydown", onKey, true); overlay.remove(); unlockScroll();
      if (opener && opener.focus) try { opener.focus({ preventScroll: true }); } catch (_) {}
      if (o.onClose) o.onClose(result);
    }
    function onKey(e) {
      if (e.key === "Escape" && o.dismissable !== false) { e.stopPropagation(); close(); }
      else if (e.key === "Tab") {
        const f = Array.from(sheet.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && o.dismissable !== false) close(); });
    document.addEventListener("keydown", onKey, true);
    lockScroll(); document.body.appendChild(overlay);
    const first = sheet.querySelector("[autofocus]") || sheet.querySelector(FOCUSABLE); (first || sheet).focus({ preventScroll: true });
    return { close, el: sheet };
  }

  /* confirm dialog. { title, text, confirmLabel, danger, typeToConfirm: "REBUILD" } -> Promise<boolean> */
  function confirm(o) {
    return new Promise((resolve) => {
      let m, input;
      const ok = el("button", { type: "button", class: "btn " + (o.danger ? "btn-danger" : "btn-primary"), on: { click: () => m.close(true) } }, o.confirmLabel || T("common.confirm"));
      if (o.typeToConfirm) {
        ok.disabled = true;
        input = el("input", { class: "input", dir: "ltr", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": o.typeToConfirm, on: { input: () => { ok.disabled = input.value.trim() !== o.typeToConfirm; } } });
      }
      m = modal([el("h2", { text: o.title }), o.text ? el("p", { class: "muted", text: o.text }) : null, o.body || null,
        input ? el("div", { class: "field", style: { marginTop: "12px" } }, el("label", { text: o.typeLabel || "" }), input) : null,
        el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close(false) } }, o.cancelLabel || T("common.cancel")), ok)],
        { label: o.title, onClose: (r) => resolve(r === true) });
    });
  }

  /* ---- avatar: picture if there is one, initials otherwise. size: sm | md | lg ---- */
  function avatar(p, size, o) {
    const name = E.u.nameOf(p) || (o && o.name) || "", url = p && (p.photo_url || p.logo_url);
    const a = el("span", { class: "avatar" + (size ? " " + size : "") + (o && o.square ? " sq" : ""), role: "img", "aria-label": name || null });
    if (url) { const im = el("img", { src: E.api.mediaUrl(url), alt: "", loading: "lazy", decoding: "async", on: { error: () => { im.remove(); a.textContent = E.u.initials(name); } } }); a.appendChild(im); }
    else a.textContent = E.u.initials(name);
    return a;
  }

  /* ---- empty state, skeletons, spinner ---- */
  function empty(iconName, title, text, action) {
    return el("div", { class: "empty" }, el("div", { class: "icon-wrap" }, icon(iconName, { size: 24 })), el("h3", { text: title }), text ? el("p", { class: "small", text: text }) : null, action || null);
  }
  function skeletonRows(n, h) { const w = el("div", { class: "stack", "aria-hidden": "true" }); for (let i = 0; i < (n || 3); i++) w.appendChild(el("div", { class: "skeleton", style: { height: (h || 64) + "px", borderRadius: "16px" } })); return w; }
  const spinner = () => el("div", { class: "spinner-page", role: "status", "aria-label": T("common.loading") }, el("div", { class: "spin" }));
  function errorState(e, retry) {
    return empty("alert-triangle", T("err.page"), E.api.errorText(e), retry ? el("button", { type: "button", class: "btn", on: { click: retry } }, icon("refresh-cw", { size: 20 }), T("common.retry")) : null);
  }

  /* button busy state around an async action */
  async function busy(btn, fn) {
    const html = btn.innerHTML; btn.setAttribute("aria-busy", "true"); btn.replaceChildren(el("span", { class: "spin" }));
    try { return await fn(); } finally { btn.removeAttribute("aria-busy"); btn.innerHTML = html; }
  }

  /* animated number (skips animation for reduced motion) */
  function countTo(node, to, ms) {
    const reduce = g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !isFinite(to)) { node.textContent = E.i18n.number(to); return; }
    const t0 = performance.now(), d = ms || 600;
    (function step(t) { const k = Math.min(1, (t - t0) / d), v = Math.round(to * (1 - Math.pow(1 - k, 3))); node.textContent = E.i18n.number(v); if (k < 1) requestAnimationFrame(step); })(t0);
  }

  E.ui = { toast, toastError, modal, confirm, avatar, empty, skeletonRows, spinner, errorState, busy, countTo, lockScroll, unlockScroll };
})(window);
