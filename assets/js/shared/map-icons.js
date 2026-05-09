(function () {
    const icons = [
        { key: 'city', label: 'Città', icon: 'fa-city', aliases: ['../assets/img/maps/mark_city.webp'] },
        { key: 'village', label: 'Villaggio', icon: 'fa-house-chimney' },
        { key: 'area', label: 'Area', icon: 'fa-map' },
        { key: 'place', label: 'Luogo', icon: 'fa-location-dot' },
        { key: 'dungeon', label: 'Dungeon', icon: 'fa-dungeon' },
        { key: 'ruins', label: 'Rovina', icon: 'fa-archway' },
        { key: 'temple', label: 'Tempio', icon: 'fa-place-of-worship' },
        { key: 'forest', label: 'Foresta', icon: 'fa-tree' },
        { key: 'mountain', label: 'Montagna', icon: 'fa-mountain' },
        { key: 'water', label: 'Acqua', icon: 'fa-water' },
        { key: 'teleport', label: 'Teleport', icon: 'fa-door-open', aliases: ['../assets/img/maps/mark_teleport.webp'] },
        { key: 'market', label: 'Mercato', icon: 'fa-coins' },
        { key: 'tavern', label: 'Taverna', icon: 'fa-beer-mug-empty' },
        { key: 'faction', label: 'Fazione', icon: 'fa-flag' },
        { key: 'quest', label: 'Quest', icon: 'fa-scroll' },
        { key: 'danger', label: 'Pericolo', icon: 'fa-triangle-exclamation' },
        { key: 'boss', label: 'Minaccia', icon: 'fa-crown' },
        { key: 'resource', label: 'Risorsa', icon: 'fa-gem' },
        { key: 'secret', label: 'Segreto', icon: 'fa-lock' },
        { key: 'port', label: 'Porto', icon: 'fa-anchor' },
        { key: 'camp', label: 'Accampamento', icon: 'fa-campground' },
        { key: 'environment', label: 'Ambiente', icon: 'fa-leaf', aliases: ['../assets/img/maps/mark_environment.webp'] }
    ];

    const byKey = new Map(icons.map(icon => [icon.key, icon]));
    const aliasToKey = new Map();

    icons.forEach((icon) => {
        (icon.aliases || []).forEach((alias) => {
            aliasToKey.set(alias, icon.key);
        });
    });

    function normalize(value) {
        const raw = String(value || '').trim();
        return aliasToKey.get(raw) || raw;
    }

    function get(value) {
        return byKey.get(normalize(value)) || null;
    }

    function isCatalogIcon(value) {
        return Boolean(get(value));
    }

    window.CriptaMapIcons = {
        list: icons,
        get,
        normalize,
        isCatalogIcon
    };
}());
