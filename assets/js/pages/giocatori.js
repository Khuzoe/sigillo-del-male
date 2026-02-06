document.addEventListener('DOMContentLoaded', function() {
    const container = document.getElementById('player-list-container');
    const base_path = '../assets/';

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

            visiblePlayers.sort((a, b) => a.name.localeCompare(b.name));

            visiblePlayers.forEach(player => {
                const playerCard = `
                    <a href="../pages/characters/character.html?id=${player.id}&type=player" class="npc-card">
                        <div class="npc-avatar-container">
                            <img src="${base_path}${player.images.avatar}" alt="${player.name}" class="npc-img-pop img-main" onerror="this.src='httpshttps://placehold.co/200x200/1a1a1a/gold?text=${player.name.charAt(0)}'">
                            <img src="${base_path}${player.images.hover}" alt="${player.name} Full" class="npc-img-pop img-hover" onerror="this.style.display='none'">
                        </div>
                        <div class="npc-info">
                            <div class="npc-header">
                                <h3 class="npc-name">${player.name}</h3>
                                <span class="npc-role">${player.role}</span>
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
