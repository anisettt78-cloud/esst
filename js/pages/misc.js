/* Not-found page (the chat pages live in pages/chat.js). */
(function (g) {
  "use strict";
  const E = g.ESST, { el, icon } = E.u, T = (k) => E.t(k);
  E.router.add("*", (ctx) => {
    ctx.page.appendChild(E.ui.empty("search", T("notfound.title"), T("notfound.text"), el("a", { class: "btn btn-primary", href: "#/" }, icon("home", { size: 20 }), T("notfound.home"))));
  });
})(window);
