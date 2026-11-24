"use strict";
/* Translation guard: FR / EN / AR must have exactly the same keys, and every key used in the code must exist. */
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const ctx = { ESST: { dict: { en: {}, fr: {}, ar: {} } } }; vm.createContext(ctx);
for (const l of ["en", "fr", "ar"]) vm.runInContext(fs.readFileSync(path.join(root, "js/i18n", l + ".js"), "utf8"), ctx);
const D = ctx.ESST.dict;

test("FR, EN and AR have the same keys", () => {
  const en = Object.keys(D.en).sort();
  for (const l of ["fr", "ar"]) {
    const k = Object.keys(D[l]).sort();
    assert.deepEqual(en.filter((x) => !k.includes(x)), [], l + " is missing keys");
    assert.deepEqual(k.filter((x) => !en.includes(x)), [], l + " has extra keys");
  }
});
test("no empty translations; placeholders {x} match across languages", () => {
  for (const k of Object.keys(D.en)) for (const l of ["en", "fr", "ar"]) {
    assert.ok(String(D[l][k]).trim().length > 0, l + " empty: " + k);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
    assert.equal(ph(D[l][k]), ph(D.en[k]), "placeholders differ for " + k + " in " + l);
  }
});
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : [])); }
test("every translation key used in the code exists", () => {
  const used = new Set(), re = /["']((?:app|nav|common|err|setup|home|settings|theme|lang|notfound|soon|forbidden|auth|profile|team|match|league|chat|search|formation|admin)\.[a-z0-9_.]+)["']/g;
  for (const f of walk(path.join(root, "js")).filter((x) => !x.includes("/i18n/")))
    for (const m of fs.readFileSync(f, "utf8").matchAll(re)) used.add(m[1]);
  // keys built at run time ("match.status." + status): the prefix must exist and every language must define keys under it
  const prefixes = [...used].filter((k) => k.endsWith("."));
  for (const p of prefixes) for (const l of ["en", "fr", "ar"]) assert.ok(Object.keys(D[l]).some((k) => k.startsWith(p)), "no keys under " + p + " in " + l);
  const missing = [...used].filter((k) => !k.endsWith(".") && !(k in D.en));
  assert.deepEqual(missing, []);
});
