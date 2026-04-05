(function () {
  const DISCORD_WORKER_URL = "https://sigillo-api.khuzoe.workers.dev";
  const DISCORD_TOKEN_KEY = "discord_jwt";
  const DM_HIDDEN_ACCESS_KEY = "wiki_dm_hidden_access";

  function resolveBasePath() {
    try {
      const scriptTag = document.querySelector('script[src*="spoiler-policy.js"]');
      const src = scriptTag?.getAttribute("src") || "";
      return src.replace("assets/js/spoiler-policy.js", "");
    } catch (_) {
      return "";
    }
  }

  function allowSpoilers() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("spoiler") === "1") return true;
      if (window.localStorage.getItem(DM_HIDDEN_ACCESS_KEY) === "1") return true;
      return window.localStorage.getItem("wiki_show_spoilers") === "1";
    } catch (_) {
      return false;
    }
  }

  function isVisible(entry) {
    if (!entry || allowSpoilers()) return true;
    if (entry.hidden === true) return false;
    if (entry.status === "hidden") return false;
    return true;
  }

  function filterVisible(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((entry) => isVisible(entry));
  }

  function filterVisibleIds(ids, visibleIdSet) {
    if (!Array.isArray(ids)) return [];
    return ids.filter((id) => visibleIdSet.has(id));
  }

  async function initializeDmAccess() {
    try {
      if (allowSpoilers()) return true;

      const token = window.localStorage.getItem(DISCORD_TOKEN_KEY) || "";
      if (!token) return false;

      const basePath = resolveBasePath();
      const [sessionResponse, verifyResponse] = await Promise.all([
        fetch(`${basePath}assets/data/next-session.json`),
        fetch(`${DISCORD_WORKER_URL}/auth/discord/verify`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (!sessionResponse.ok || !verifyResponse.ok) {
        window.localStorage.removeItem(DM_HIDDEN_ACCESS_KEY);
        return false;
      }

      const sessionData = await sessionResponse.json();
      const verifyData = await verifyResponse.json();
      const currentDiscordId = String(verifyData?.user?.id || "").trim();
      const dmDiscordId = String(sessionData?.dmDiscordId || "").trim();
      const isDm = Boolean(currentDiscordId) && Boolean(dmDiscordId) && currentDiscordId === dmDiscordId;

      if (isDm) {
        window.localStorage.setItem(DM_HIDDEN_ACCESS_KEY, "1");
      } else {
        window.localStorage.removeItem(DM_HIDDEN_ACCESS_KEY);
      }

      return isDm;
    } catch (_) {
      return allowSpoilers();
    }
  }

  const ready = initializeDmAccess();

  window.WikiSpoiler = {
    allowSpoilers,
    isVisible,
    filterVisible,
    filterVisibleIds,
    ready,
  };
})();
