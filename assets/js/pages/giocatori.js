document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('player-list-container');
    const base_path = '../assets/';

    function normalizeImageAdjust(adjust) {
        const x = Number(adjust?.x);
        const y = Number(adjust?.y);
        const size = Number(adjust?.size);
        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            size: Number.isFinite(size) && size > 0 ? size : null
        };
    }

    function buildImageStyle(kind, adjust, counterpartAdjust) {
        const normalized = normalizeImageAdjust(adjust);
        const counterpart = normalizeImageAdjust(counterpartAdjust);
        const isHover = kind === 'hover';
        const restScale = isHover
            ? (counterpart.size || 1)
            : (normalized.size || 1);
        const hoverScale = isHover
            ? (normalized.size || 1.20)
            : (counterpart.size || (normalized.size ? normalized.size * 1.20 : 1.20));

        return `--img-x:${normalized.x}px; --img-y:${normalized.y}px; --img-scale-rest:${restScale}; --img-scale-hover:${hoverScale};`;
    }

    fetch(base_path + 'data/players.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(players => {
            const visiblePlayers = window.WikiSpoiler
                ? window.WikiSpoiler.filterVisible(players)
                : players;

            if (visiblePlayers.length === 0) {
                container.innerHTML = '<p>Nessun giocatore trovato.</p>';
                return;
            }

            visiblePlayers.sort((a, b) => {
                const aInactive = a.isActive === false ? 1 : 0;
                const bInactive = b.isActive === false ? 1 : 0;
                if (aInactive !== bInactive) {
                    return aInactive - bInactive;
                }
                return a.name.localeCompare(b.name);
            });

            visiblePlayers.forEach(player => {
                const isInactive = player.isActive === false;
                const cardClasses = `npc-card player-card ${isInactive ? 'player-card--inactive' : ''}`.trim();
                const statusBadge = isInactive
                    ? `<span class="player-status-badge">${player.statusLabel || 'Fuori dal gruppo'}</span>`
                    : '';

                const playerCard = `
                    <a href="../pages/characters/character.html?id=${player.id}&type=player" class="${cardClasses}">
                        <div class="npc-avatar-container">
                            <img src="${base_path}${player.images.avatar}" alt="${player.name}" class="npc-img-pop img-main" style="${buildImageStyle('avatar', player.images.avatarAdjust, player.images.hoverAdjust)}" onerror="this.src='httpshttps://placehold.co/200x200/1a1a1a/gold?text=${player.name.charAt(0)}'">
                            <img src="${base_path}${player.images.hover}" alt="${player.name} Full" class="npc-img-pop img-hover" style="${buildImageStyle('hover', player.images.hoverAdjust, player.images.avatarAdjust)}" onerror="this.style.display='none'">
                        </div>
                        <div class="npc-info">
                            <div class="npc-header">
                                <h3 class="npc-name">${player.name}</h3>
                                <div class="player-card-meta">
                                    <span class="npc-role">${player.role}</span>
                                    ${statusBadge}
                                </div>
                            </div>
                            <p class="npc-desc">
                                ${player.description}
                            </p>
                        </div>
                        <i class="fas fa-chevron-right arrow-icon"></i>
                    </a>
                `;
                container.insertAdjacentHTML('beforeend', playerCard);
            });
        })
        .catch(error => {
            console.error('Errore nel caricamento dei dati dei giocatori:', error);
            container.innerHTML = '<p style="color: var(--status-dead);">Impossibile caricare i dati dei giocatori. Controlla la console per maggiori dettagli.</p>';
        });
});
