"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ctx = { globalThis: null }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/core/validate.js"), "utf8"), ctx);
const V = ctx.ESST.validate, NOW = new Date(2026, 10, 20);              // 20 Nov 2026

test("days in month incl. leap years", () => {
  assert.equal(V.daysInMonth(2024, 2), 29); assert.equal(V.daysInMonth(2025, 2), 28); assert.equal(V.daysInMonth(1900, 2), 28); assert.equal(V.daysInMonth(2000, 2), 29);
  assert.equal(V.daysInMonth(2026, 4), 30); assert.equal(V.daysInMonth(2026, 12), 31);
});
test("age is counted in complete years", () => {
  assert.equal(V.ageFrom("2000-11-20", NOW), 26); assert.equal(V.ageFrom("2000-11-21", NOW), 25); assert.equal(V.ageFrom("2000-12-01", NOW), 25); assert.equal(V.ageFrom("2000-01-01", NOW), 26);
  assert.equal(V.ageFrom("nope", NOW), null);
});
test("birth date validation", () => {
  assert.equal(V.birthError(2001, 5, 14, NOW), null);
  assert.equal(V.birthError("", 5, 14, NOW), "auth.err.birth_required"); assert.equal(V.birthError(2001, 0, 14, NOW), "auth.err.birth_required");
  assert.equal(V.birthError(2001, 2, 30, NOW), "auth.err.birth_invalid", "30 February"); assert.equal(V.birthError(2023, 2, 29, NOW), "auth.err.birth_invalid", "29 Feb in a non-leap year");
  assert.equal(V.birthError(2024, 2, 29, NOW), "auth.err.birth_age", "real date but a 2-year-old");
  assert.equal(V.birthError(2027, 1, 1, NOW), "auth.err.birth_future"); assert.equal(V.birthError(2026, 11, 21, NOW), "auth.err.birth_future", "tomorrow");
  assert.equal(V.birthError(2018, 11, 20, NOW), null, "exactly 8 today"); assert.equal(V.birthError(2018, 11, 21, NOW), "auth.err.birth_age", "one day short of 8");
  assert.equal(V.birthError(1936, 11, 20, NOW), null, "exactly 90"); assert.equal(V.birthError(1935, 11, 20, NOW), "auth.err.birth_age", "91 years old"); assert.equal(V.birthError(1935, 11, 21, NOW), null, "still 90 until tomorrow");
});
test("e-mail, password, ranges", () => {
  assert.ok(V.validEmail("a@b.co")); assert.ok(!V.validEmail("a@b")); assert.ok(!V.validEmail("a b@c.de")); assert.ok(!V.validEmail(""));
  assert.ok(V.validPassword("123456")); assert.ok(!V.validPassword("12345"));
  assert.equal(V.rangeError("", 100, 250), null); assert.equal(V.rangeError("180,5", 100, 250), null); assert.equal(V.rangeError("99", 100, 250), "range"); assert.equal(V.rangeError("abc", 100, 250), "range");
  assert.equal(V.toNumber("180,5"), 180.5); assert.equal(V.toNumber(""), null);
});
