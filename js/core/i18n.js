/* ESST core: language (FR / EN / AR with RTL), translations, date and number formatting. */
(function (g) {
  "use strict";
  const E = g.ESST, LANGS = ["fr", "en", "ar"], KEY = "esst.lang";
  const LOCALE = { fr: "fr-FR", en: "en-GB", ar: "ar-DZ-u-nu-latn" };      // Latin digits in Arabic too, so tables stay readable
  let lang = "en";
  function detect() {
    let s = null; try { s = localStorage.getItem(KEY); } catch (_) {}
    if (LANGS.includes(s)) return s;
    const n = String((navigator.languages && navigator.languages[0]) || navigator.language || "en").slice(0, 2).toLowerCase();
    return LANGS.includes(n) ? n : "en";
  }
  function t(key, vars) {
    let s = E.dict[lang][key]; if (s == null) s = E.dict.en[key]; if (s == null) return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
  }
  function apply(root) {                                     // static markup: data-i18n, data-i18n-aria, data-i18n-placeholder
    (root || document).querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.getAttribute("data-i18n")); });
    (root || document).querySelectorAll("[data-i18n-aria]").forEach((n) => { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    (root || document).querySelectorAll("[data-i18n-placeholder]").forEach((n) => { n.setAttribute("placeholder", t(n.getAttribute("data-i18n-placeholder"))); });
  }
  function set(l, silent) {
    if (!LANGS.includes(l)) l = "en";
    lang = l; try { localStorage.setItem(KEY, l); } catch (_) {}
    const h = document.documentElement; h.lang = l; h.dir = l === "ar" ? "rtl" : "ltr";
    document.title = t("app.name");
    apply(document);
    if (!silent) E.bus.emit("lang", l);
  }
  const fmt = (o) => (d) => { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? "" : new Intl.DateTimeFormat(LOCALE[lang], o).format(x); };
  E.i18n = {
    LANGS, t, apply, set, init() { set(detect(), true); },
    get lang() { return lang; }, get dir() { return lang === "ar" ? "rtl" : "ltr"; }, get locale() { return LOCALE[lang]; },
    date: fmt({ weekday: "short", day: "numeric", month: "short" }), dateLong: fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    dateOnly: fmt({ day: "numeric", month: "short", year: "numeric" }), time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }),
    dateTime: fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
    number: (n) => new Intl.NumberFormat(LOCALE[lang]).format(n),
  };
  E.t = t;
})(window);
