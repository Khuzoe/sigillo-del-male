document.addEventListener("DOMContentLoaded", async () => {
  const input = document.getElementById("search-input");
  const list = document.getElementById("result-list");
  const meta = document.getElementById("search-meta");
  const typeMap = {
    npc: "NPC",
    player: "Giocatore",
    quest: "Missione",
    session: "Sessione",
    family: "Famiglia"
  };

  const params = new URLSearchParams(window.location.search);
  const qFromUrl = (params.get("q") || "").trim();
  if (qFromUrl) input.value = qFromUrl;

  let items = [];
  try {
    const resp = await fetch("../assets/data/search-index.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    items = Array.isArray(data.items)
      ? data.items.filter(item => {
        if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(item)) return false;
        return !(item.tags || []).includes("hidden");
      })
      : [];
  } catch (err) {
    meta.textContent = "Impossibile caricare l'indice di ricerca.";
    list.innerHTML = '<div class="empty">Errore nel caricamento dell\'indice.</div>';
    console.error(err);
    return;
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function score(item, term) {
    const nTerm = normalize(term);
    if (!nTerm) return 0;
    const title = normalize(item.title);
    const subtitle = normalize(item.subtitle);
    const tags = normalize((item.tags || []).join(" "));
    const content = normalize(item.content);

    let result = 0;
    if (title.startsWith(nTerm)) result += 80;
    if (title.includes(nTerm)) result += 40;
    if (subtitle.includes(nTerm)) result += 20;
    if (tags.includes(nTerm)) result += 20;
    if (content.includes(nTerm)) result += 10;
    return result;
  }

  function render(query) {
    const raw = query.trim();
    if (!raw) {
      meta.textContent = `Indice pronto: ${items.length} voci`;
      list.innerHTML = '<div class="empty">Inserisci un termine per cercare.</div>';
      return;
    }

    const ranked = items
      .map(item => ({ item, score: score(item, raw) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(r => r.item);

    meta.textContent = `${ranked.length} risultati per "${raw}"`;
    if (ranked.length === 0) {
      list.innerHTML = '<div class="empty">Nessun risultato.</div>';
      return;
    }

    list.innerHTML = ranked.map(item => `
      <a class="result-item" href="../${item.url}">
        <div class="result-top">
          <h3 class="result-title">${item.title || ""}</h3>
          <span class="result-type">${typeMap[item.type] || item.type || "Voce"}</span>
        </div>
        <div class="result-sub">${item.subtitle || ""}</div>
        <div class="result-content">${item.content || ""}</div>
      </a>
    `).join("");
  }

  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      render(input.value);
      const value = input.value.trim();
      const url = new URL(window.location.href);
      if (value) url.searchParams.set("q", value);
      else url.searchParams.delete("q");
      history.replaceState({}, "", url);
    }, 120);
  });

  render(input.value);
});
