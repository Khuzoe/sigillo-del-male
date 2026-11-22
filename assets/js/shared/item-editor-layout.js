// Keep one set of form controls mounted while the editor changes sections.
function mountCatalogEditorTabs(form, anchor, sections) {
    if (form.querySelector('[data-catalog-tabs]')) return;
    const list = document.createElement('div');
    list.className = 'catalog-editor-tabs';
    list.dataset.catalogTabs = '';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Sezioni della scheda oggetto');
    anchor.before(list);
    const prefix = 'item-editor-' + crypto.randomUUID();
    let previous = list;
    const entries = sections.map(([key, label, nodes]) => {
        const panel = document.createElement('div');
        panel.className = 'catalog-editor-panel';
        panel.dataset.catalogPanel = key;
        panel.id = prefix + '-' + key;
        panel.setAttribute('role', 'tabpanel');
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.dataset.catalogTab = key;
        tab.id = panel.id + '-tab';
        tab.textContent = label;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('aria-labelledby', tab.id);
        previous.after(panel);
        panel.append(...nodes.filter(Boolean));
        list.append(tab);
        previous = panel;
        return {tab, panel};
    });
    function activate(index) {
        entries.forEach(({tab, panel}, i) => {
            const active = i === index;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            panel.hidden = !active;
        });
    }
    entries.forEach(({tab}, i) => {
        tab.onclick = () => activate(i);
        tab.onkeydown = event => {
            const count = entries.length;
            const next = {ArrowRight: (i + 1) % count, ArrowLeft: (i + count - 1) % count, Home: 0, End: count - 1}[event.key];
            if (next === undefined) return;
            event.preventDefault();
            activate(next);
            entries[next].tab.focus();
        };
    });
    activate(0);
}
