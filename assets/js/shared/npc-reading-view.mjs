export const normalizeNpcReadingSearch = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/\s+/g, " ").trim();
export function matchesNpcReadingEntry(entry, state) {
    return (!state.kind || state.kind === "all" || entry.kind === state.kind)
        && (!state.group || entry.group === state.group)
        && (!state.preparedOnly || entry.kind !== "spells" || Boolean(entry.preparation && entry.preparation !== "unprepared"))
        && (!normalizeNpcReadingSearch(state.query) || entry.search.includes(normalizeNpcReadingSearch(state.query)));
}
export const npcReadingAnchor = key => `managed-npc-ability-${encodeURIComponent(String(key))}`;

// This view uses only the cards already authorized and rendered by the page.
// It never fetches native snapshots, edits an Actor or calls a generation API.
export function mountNpcReadingView(root) {
    const pane = root.querySelector("#managed-npc-actions");
    if (!pane || !root.classList.contains("is-viewing")) return null;
    const collections = [...pane.querySelectorAll('[data-managed-collection="capabilities"], [data-managed-collection="spells"]')];
    const records = collections.flatMap(collection => [...collection.querySelectorAll(".npc-reader-card")].map((card,index) => ({
        card, key: card.dataset.managedReadKey || `${collection.id}-${index}`,
        title: card.querySelector(".managed-entry-title h3")?.textContent?.trim() || "Capacità",
        kind: collection.dataset.managedCollection,
        group: `${collection.dataset.managedCollection}:${card.dataset.managedEntryGroupKey || "other"}`,
        groupLabel: card.closest("[data-managed-entry-group]")?.querySelector("header > span")?.textContent?.trim() || (collection.dataset.managedCollection === "spells" ? "Incantesimi" : "Capacità"),
        preparation: card.dataset.managedSpellPreparation || "",
        icon: card.querySelector(".managed-npc-capability-heading > img"),
        search: normalizeNpcReadingSearch(card.dataset.managedEntrySearchValue + " " + card.textContent)
    })));
    if (!records.length) return null;
    const identity = root.dataset.npcIdentity || "";
    const state = root._managedNpcReadingState?.identity === identity ? root._managedNpcReadingState
        : {identity,query:"",kind:"all",group:"",preparedOnly:false,selected:records[0].key};
    root._managedNpcReadingState = state;
    const make = (tag,cls,text) => {const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const button = (text,action,cls="") => {const node=make("button",`npc-read-button ${cls}`,text);node.type="button";node.addEventListener("click",action);return node;};
    const shell=make("section","npc-reader"),heading=make("header","npc-reader-heading"),headingText=make("div");
    headingText.append(make("span","npc-reader-eyebrow","Scheda delle capacità"),make("h2","","Capacità e incantesimi"));
    const count=make("span","npc-reader-count");count.setAttribute("role","status");count.setAttribute("aria-live","polite");heading.append(headingText,count);shell.append(heading);
    const legendary=collections[0]?.querySelector(".managed-legendary-summary");
    if(legendary)shell.append(legendary);
    const workspace=make("div","npc-reader-workspace"),library=make("details","npc-reader-library");library.open=true;
    const summary=make("summary"),caption=make("span","","Scegli una capacità"),currentName=make("strong");summary.append(caption,currentName);library.append(summary);
    const tools=make("div","npc-reader-tools"),searchLabel=make("label","npc-reader-search");searchLabel.append(make("span","npc-reader-sr-only","Cerca nelle capacità"));
    const search=make("input");search.type="search";search.placeholder="Cerca nome, danno, effetto…";search.value=state.query;searchLabel.append(search);tools.append(searchLabel);
    const filters=make("div","npc-reader-filters");filters.setAttribute("role","group");filters.setAttribute("aria-label","Tipo di capacità");
    const kindButtons=[];
    for(const [key,label] of [["all","Tutte"],["capabilities","Capacità"],["spells","Incantesimi"]]) {
        const total=records.filter(record=>key==="all"||record.kind===key).length;if(!total&&key!=="all")continue;
        const node=button(label,()=>{state.kind=key;state.group="";updateGroups();apply();},"is-filter");node.dataset.kind=key;node.append(make("small","",String(total)));kindButtons.push(node);filters.append(node);
    }
    tools.append(filters);
    const groupLabel=make("label","npc-reader-group-filter");groupLabel.append(make("span","npc-reader-sr-only","Filtra per azione o livello"));
    const group=make("select");groupLabel.append(group);tools.append(groupLabel);
    let prepared;
    if(records.some(record=>record.preparation === "unprepared")) {
        const label=make("label","npc-reader-prepared"),check=make("input");check.type="checkbox";check.checked=state.preparedOnly;label.append(check,make("span","","Solo incantesimi disponibili"));tools.append(label);prepared=check;
        check.addEventListener("change",()=>{state.preparedOnly=check.checked;apply();});
    }
    library.append(tools);
    const list=make("div","npc-reader-list");list.setAttribute("role","tablist");list.setAttribute("aria-label","Capacità disponibili");list.setAttribute("aria-orientation","vertical");library.append(list);
    const detail=make("div","npc-reader-document"),empty=make("div","npc-reader-empty");empty.append(make("h3","","Nessuna capacità trovata"),make("p","","Prova un altro nome oppure rimuovi i filtri."));
    empty.append(button("Mostra tutte",()=>{state.query="";state.kind="all";state.group="";state.preparedOnly=false;search.value="";if(prepared)prepared.checked=false;updateGroups();apply();}));empty.hidden=true;detail.append(empty);
    const navigation=make("nav","npc-reader-pagination");navigation.setAttribute("aria-label","Scorri le capacità");
    const previous=button("← Precedente",()=>step(-1),"is-quiet"),position=make("span"),next=button("Successiva →",()=>step(1),"is-quiet");navigation.append(previous,position,next);
    workspace.append(library,detail);shell.append(workspace,navigation);
    let compact,visible=records;
    function updateGroups() {
        group.replaceChildren();const all=make("option","","Tutti i tipi e livelli");all.value="";group.append(all);
        const groups=new Map();for(const record of records)if(state.kind==="all"||state.kind===record.kind)groups.set(record.group,record.groupLabel);
        for(const [key,label] of groups){const option=make("option","",label);option.value=key;group.append(option);}
        if(state.group&&!groups.has(state.group))state.group="";group.value=state.group;groupLabel.hidden=groups.size<2;
    }
    function select(record,{interact=false,focus=false}={}) {
        if(!record)return;state.selected=record.key;
        for(const candidate of records) {
            const selected=candidate===record;candidate.card.hidden=!selected;candidate.button.setAttribute("aria-selected",String(selected));candidate.button.tabIndex=selected?0:-1;
        }
        empty.hidden=true;currentName.textContent=record.title;
        const index=visible.indexOf(record);previous.disabled=index<=0;next.disabled=index<0||index>=visible.length-1;position.textContent=`${index+1} di ${visible.length}`;
        if(interact) {
            window.history.replaceState(null,"",`#${encodeURIComponent(record.card.id)}`);
            if(compact)library.open=false;
            const top=record.card.getBoundingClientRect().top,bar=root.querySelector(".managed-command-bar")?.getBoundingClientRect().bottom || 0;
            if(compact||focus||top<bar)record.card.scrollIntoView({block:"start",behavior:"auto"});
            if(compact||focus)record.card.focus({preventScroll:true});
        }
    }
    function step(delta) {const index=visible.findIndex(record=>record.key===state.selected);select(visible[Math.max(0,Math.min(visible.length-1,index+delta))],{interact:true,focus:true});}
    function apply() {
        visible=records.filter(record=>matchesNpcReadingEntry(record,state));
        for(const node of kindButtons)node.setAttribute("aria-pressed",String(node.dataset.kind===state.kind));
        for(const record of records)record.button.hidden=!visible.includes(record);
        for(const section of list.children)section.hidden=![...section.querySelectorAll('[role="tab"]')].some(node=>!node.hidden);
        count.textContent=`${visible.length} di ${records.length}`;
        const selected=visible.find(record=>record.key===state.selected)||visible[0];
        navigation.hidden=visible.length<2;empty.hidden=Boolean(selected);
        if(selected)select(selected);else{for(const record of records)record.card.hidden=true;currentName.textContent="Nessun risultato";}
    }
    const groups=new Map();
    for(const [index,record] of records.entries()) {
        let section=groups.get(record.group);
        if(!section){section=make("div","npc-reader-list-group");section.setAttribute("role","presentation");section.append(make("h3","",record.groupLabel));list.append(section);groups.set(record.group,section);}
        const node=button("",()=>select(record,{interact:true}),"npc-reader-entry");node.setAttribute("role","tab");node.id=`npc-read-tab-${index}`;
        record.card.id=npcReadingAnchor(record.key);record.card.setAttribute("role","tabpanel");record.card.setAttribute("aria-labelledby",node.id);record.card.tabIndex=-1;node.setAttribute("aria-controls",record.card.id);
        if (record.icon) {
            const icon = record.icon.cloneNode(false);
            icon.alt = "";
            icon.loading = "lazy";
            node.append(icon);
        } else {
            const icon = make("i", `npc-reader-entry-icon fas ${record.kind === "spells" ? "fa-wand-sparkles" : "fa-burst"}`);
            icon.setAttribute("aria-hidden", "true");
            node.append(icon);
        }
        const copy=make("span","npc-reader-entry-copy");copy.append(make("strong","",record.title));const meta=record.card.querySelector(".managed-entry-title > span")?.textContent;if(meta)copy.append(make("small","",meta));node.append(copy);record.button=node;section.append(node);
        node.addEventListener("keydown",event=>{
            const current=visible.indexOf(record),index=event.key==="Home"?0:event.key==="End"?visible.length-1:event.key==="ArrowDown"?(current+1)%visible.length:event.key==="ArrowUp"?(current-1+visible.length)%visible.length:-1;
            if(index<0)return;event.preventDefault();select(visible[index]);window.history.replaceState(null,"",`#${encodeURIComponent(visible[index].card.id)}`);visible[index].button.focus();
        });
        detail.append(record.card);
    }
    for(const collection of collections){collection.hidden=true;collection.dataset.managedReadHandled="true";}
    pane.prepend(shell);root.classList.add("has-npc-reader");updateGroups();apply();
    search.addEventListener("input",()=>{state.query=search.value;apply();});
    search.addEventListener("keydown",event=>{if(event.key==="Escape"){search.value="";state.query="";apply();}});
    group.addEventListener("change",()=>{state.group=group.value;apply();});
    const observer=new ResizeObserver(()=>{if(!shell.clientWidth)return;const value=shell.clientWidth<760;if(compact!==value){compact=value;shell.classList.toggle("is-compact",value);library.open=!value;}});observer.observe(shell);
    return {
        reveal(control) {
            const record=records.find(candidate=>candidate.card===control||candidate.card.contains(control));
            const collection=collections.find(candidate=>candidate===control);
            if(!record&&!collection)return;
            state.query="";state.kind=collection?.dataset.managedCollection||"all";state.group="";state.preparedOnly=false;search.value="";if(prepared)prepared.checked=false;updateGroups();
            if(record)state.selected=record.key;apply();
            window.requestAnimationFrame(()=>{if(root.isConnected){(record?.card||shell).scrollIntoView({block:"start",behavior:"auto"});record?.card.focus({preventScroll:true});}});
        },
        destroy(){observer.disconnect();root.classList.remove("has-npc-reader");}
    };
}
