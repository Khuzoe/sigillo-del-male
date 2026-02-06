(function () {
  function allowSpoilers() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("spoiler") === "1") return true;
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

  window.WikiSpoiler = {
    allowSpoilers,
    isVisible,
    filterVisible,
    filterVisibleIds,
  };
})();
