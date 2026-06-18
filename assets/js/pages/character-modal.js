function initializeImageModal() {
            const modal = document.getElementById('image-modal');
            const modalImg = document.getElementById('modal-image-content');
            const closeBtn = document.getElementById('image-modal-close');

            if (!modal || !modalImg || !closeBtn) {
                console.error('Modal elements not found!');
                return;
            }

            const closeModal = () => {
                modal.classList.remove('visible');
                modalImg.removeAttribute('src'); // Clear src to stop loading if in progress
            };

            const openModal = (image) => {
                const src = image?.currentSrc || image?.src || image?.dataset?.imageSrc || '';
                if (!src) return;
                modal.classList.add('visible');
                modalImg.src = src;
            };

            if (modal.dataset.imageModalInitialized === 'true') return;
            modal.dataset.imageModalInitialized = 'true';

            document.addEventListener('click', (e) => {
                const image = e.target?.closest?.('.doc-image-popup');
                if (!image) return;
                e.preventDefault();
                openModal(image);
            });

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
