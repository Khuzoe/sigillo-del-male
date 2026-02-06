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
                // Close if clicking on the background, not the image itself
                if (e.target === modal) {
                    closeModal();
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('visible')) {
                    closeModal();
                }
            });
        }
