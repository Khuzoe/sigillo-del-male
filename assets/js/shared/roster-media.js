(function () {
    "use strict";

    function normalizeImageIdentity(path) {
        return String(path || "")
            .trim()
            .replace(/[?#].*$/, "")
            .replace(/^https?:\/\/[^/]+\/?/i, "")
            .replace(/^\/+/, "")
            .toLowerCase();
    }

    function revealDecodedImage(card, image, readyClass, unavailableClass) {
        if (!image?.naturalWidth) return;
        const reveal = () => {
            if (!image.naturalWidth) return;
            card.classList.remove(unavailableClass);
            card.classList.add(readyClass);
        };
        if (typeof image.decode !== "function") {
            reveal();
            return;
        }
        image.decode().then(reveal).catch(reveal);
    }

    function watchImage(card, image, role) {
        if (!image) return;
        const readyClass = role === "main" ? "npc-card--main-ready" : "npc-card--hover-ready";
        const unavailableClass = role === "main" ? "npc-card--main-unavailable" : "npc-card--hover-unavailable";

        const handleLoad = () => revealDecodedImage(card, image, readyClass, unavailableClass);
        const handleError = () => {
            card.classList.remove(readyClass);
            const originalSource = String(image.dataset.originalSrc || "").trim();
            const isDedicated = image.dataset.mediaDedicated === "true";
            if (isDedicated && originalSource && image.dataset.mediaRetry !== "true") {
                image.dataset.mediaRetry = "true";
                const retryUrl = new URL(originalSource, window.location.href);
                retryUrl.searchParams.set("_retry", "1");
                window.setTimeout(() => { image.src = retryUrl.href; }, 160);
                return;
            }

            const fallbackSource = String(image.dataset.fallbackSrc || "").trim();
            if (fallbackSource
                && image.dataset.mediaFallbackUsed !== "true"
                && normalizeImageIdentity(fallbackSource) !== normalizeImageIdentity(image.currentSrc || image.src)) {
                image.dataset.mediaFallbackUsed = "true";
                image.src = fallbackSource;
                return;
            }
            card.classList.add(unavailableClass);
        };

        image.addEventListener("load", handleLoad);
        image.addEventListener("error", handleError);
        if (image.complete) {
            if (image.naturalWidth) handleLoad();
            else handleError();
        }
    }

    function warmHoverImage(card) {
        const image = card?.querySelector?.(".img-hover");
        if (!image || image.dataset.mediaWarmed === "true") return;
        image.dataset.mediaWarmed = "true";
        image.loading = "eager";
        image.fetchPriority = "low";
        if (image.complete && image.naturalWidth && typeof image.decode === "function") {
            image.decode().catch(() => {});
        }
    }

    function init(container) {
        if (!container) return;
        const cards = Array.from(container.querySelectorAll("[data-roster-card]"));
        const hoverObserver = "IntersectionObserver" in window
            ? new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    warmHoverImage(entry.target);
                    observer.unobserve(entry.target);
                });
            }, { rootMargin: "700px 0px" })
            : null;

        cards.forEach((card) => {
            if (card.dataset.mediaLoadingReady === "true") return;
            card.dataset.mediaLoadingReady = "true";
            watchImage(card, card.querySelector(".img-main"), "main");
            watchImage(card, card.querySelector(".img-hover"), "hover");

            if (!card.classList.contains("npc-card--no-avatar-swap")) {
                card.addEventListener("pointerenter", () => warmHoverImage(card), { passive: true });
                card.addEventListener("focusin", () => warmHoverImage(card));
                if (hoverObserver) hoverObserver.observe(card);
                else warmHoverImage(card);
            }
        });
    }

    window.CriptaRosterMedia = Object.freeze({ init });
})();
