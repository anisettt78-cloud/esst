/* ESST core: pick an image, crop it (drag + zoom), shrink it in the browser, so only a small JPEG is ever uploaded to PostgreSQL. */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k) => E.t(k);
  const MAX_INPUT = 20e6;

  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = el("input", { type: "file", accept: accept || "image/*", style: { position: "fixed", left: "-9999px" }, "aria-hidden": "true", tabindex: "-1" });
      inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); });
      inp.addEventListener("cancel", () => { inp.remove(); resolve(null); });
      document.body.appendChild(inp); inp.click();
    });
  }
  async function decode(file) {
    if (!file || !/^image\//.test(file.type)) throw Object.assign(new Error("type"), { i18n: "crop.err.type" });
    if (file.size > MAX_INPUT) throw Object.assign(new Error("big"), { i18n: "crop.err.big" });
    try { if (g.createImageBitmap) return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) {}
    return new Promise((ok, no) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); ok(im); }; im.onerror = () => { URL.revokeObjectURL(u); no(Object.assign(new Error("load"), { i18n: "crop.err.load" })); }; im.src = u;
    });
  }
  const dims = (im) => [im.width || im.naturalWidth, im.height || im.naturalHeight];
  const toBlob = (c, q) => new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", q));
  async function jpeg(canvas, maxBytes) {
    let q = 0.86, b = await toBlob(canvas, q);
    while (b && b.size > maxBytes && q > 0.45) { q -= 0.1; b = await toBlob(canvas, q); }
    return b;
  }

  /* resize without cropping (chat pictures): longest side <= maxSide, JPEG, <= maxBytes */
  async function compress(file, o) {
    o = o || {}; const im = await decode(file), [w, h] = dims(im), k = Math.min(1, (o.maxSide || 1280) / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    if (im.close) im.close(); return jpeg(c, o.maxBytes || 400e3);
  }

  /* crop dialog: resolves with a JPEG Blob (size x size) or null if cancelled */
  async function crop(file, o) {
    o = o || {}; const SIZE = o.size || 512, im = await decode(file), [iw, ih] = dims(im);
    return new Promise((resolve) => {
      const V = Math.min(320, g.innerWidth - 72);                                  // visible square, CSS px
      const dpr = Math.min(2, g.devicePixelRatio || 1), cv = el("canvas", { width: Math.round(V * dpr), height: Math.round(V * dpr), style: { width: V + "px", height: V + "px", touchAction: "none", borderRadius: o.round === false ? "16px" : "50%", background: "#000", cursor: "grab", maxWidth: "100%" } });
      const ctx = cv.getContext("2d"); const min = Math.max(V / iw, V / ih);
      let s = min, x = (V - iw * s) / 2, y = (V - ih * s) / 2;
      const clampPos = () => { x = Math.min(0, Math.max(V - iw * s, x)); y = Math.min(0, Math.max(V - ih * s, y)); };
      const draw = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, V, V); ctx.drawImage(im, x, y, iw * s, ih * s); };
      function zoomTo(ns, cx, cy) { ns = Math.min(min * 4, Math.max(min, ns)); const k = ns / s; x = cx - (cx - x) * k; y = cy - (cy - y) * k; s = ns; clampPos(); draw(); slider.value = String(Math.round(((s - min) / (min * 3)) * 100)); }
      const slider = el("input", { type: "range", min: "0", max: "100", value: "0", "aria-label": T("crop.zoom"), style: { width: "100%", minHeight: "44px", accentColor: "var(--accent)" }, on: { input: () => zoomTo(min + (slider.value / 100) * min * 3, V / 2, V / 2) } });
      const pts = new Map(); let lastDist = 0;
      cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); cv.style.cursor = "grabbing"; });
      cv.addEventListener("pointermove", (e) => {
        if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 1) { x += e.clientX - prev[0]; y += e.clientY - prev[1]; clampPos(); draw(); }
        else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (lastDist) { const r = cv.getBoundingClientRect(); zoomTo(s * (d / lastDist), (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); } lastDist = d; }
      });
      const up = (e) => { pts.delete(e.pointerId); lastDist = 0; cv.style.cursor = "grab"; };
      cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
      cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomTo(s * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      let done = false; const finish = (v) => { if (done) return; done = true; if (im.close) im.close(); resolve(v); };
      const use = el("button", { type: "button", class: "btn btn-primary", on: { click: async () => {
        const out = document.createElement("canvas"); out.width = out.height = SIZE; const c = out.getContext("2d"), k = SIZE / V;
        c.fillStyle = "#fff"; c.fillRect(0, 0, SIZE, SIZE); c.drawImage(im, x * k, y * k, iw * s * k, ih * s * k);
        const blob = await jpeg(out, o.maxBytes || 300e3); finish(blob); m.close(); } } }, icon("check", { size: 20 }), T("crop.use"));
      const m = E.ui.modal([el("h2", { text: o.title || T("crop.title") }), el("div", { class: "stack", style: { alignItems: "center", marginTop: "12px" } }, cv, slider),
        el("div", { class: "sheet-actions" }, el("button", { type: "button", class: "btn", on: { click: () => m.close() } }, T("common.cancel")), use)], { label: T("crop.title"), onClose: () => finish(null) });
      draw();
    });
  }
  /* pick + crop in one call; shows a toast if the file is unusable */
  async function pickAndCrop(o) {
    const f = await pickFile("image/*"); if (!f) return null;
    try { return await crop(f, o); } catch (e) { E.ui.toast(e.i18n ? T(e.i18n) : T("crop.err.load"), "err"); return null; }
  }
  E.media = { pickFile, compress, crop, pickAndCrop };
})(window);
