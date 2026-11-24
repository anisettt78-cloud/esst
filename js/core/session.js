/* ESST core: who is logged in (profile + team). The UI only HIDES things based on this; the server enforces every permission. */
(function (g) {
  "use strict";
  const E = g.ESST;
  const S = E.session = {
    profile: null, membership: null, loaded: false,
    get user() { return E.api.auth.user(); },
    get loggedIn() { return E.api.auth.hasSession(); },
    get isSuper() { return !!(S.profile && S.profile.role === "super_admin"); },
    get teamId() { return S.membership ? S.membership.team_id : null; },
    isCaptainOf(teamId) { return !!(S.membership && S.membership.team_id === teamId && S.membership.role_in_team === "captain"); },
    async load() {
      S.profile = null; S.membership = null;
      const u = S.user;
      if (u) {
        try {
          S.profile = await E.api.from("profiles").select("*").eq("id", u.id).maybeSingle();
          S.membership = await E.api.from("team_memberships").select("team_id,role_in_team,jersey_number,teams(id,name,short_name,logo_url,color_primary)").eq("player_id", u.id).eq("status", "active").maybeSingle();
        } catch (e) { console.warn("[session] could not load profile:", e.message); }
      }
      S.loaded = true; E.bus.emit("profile", S.profile);
    },
  };
  E.bus.on("session", () => S.load());
})(window);
