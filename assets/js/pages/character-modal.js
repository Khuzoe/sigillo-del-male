function initializeImageModal() {
            const modal = document.getElementById('image-modal');
            const modalImg = document.getElementById('modal-image-content');
            const closeBtn = document.getElementById('image-modal-close');

            if (!modal || !modalImg || !closeBtn) {
                console.error('Modal elements not found!');
                return;
            }

            const images = document.querySelectorAll('.doc-image-popup');

            images.forEach(image => {
                image.addEventListener('click', () => {
                    modal.classList.add('visible');
                    modalImg.src = image.src;
                });
            });

            const closeModal = () => {
                modal.classList.remove('visible');
                modalImg.src = ""; // Clear src to stop loading if in progress
            };

            closeBtn.addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => {
                if (!modalImg.contains(e.target) && !closeBtn.contains(e.target)) {
                    closeModal();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('visible')) {
                    closeModal();
                }
            });
        }
