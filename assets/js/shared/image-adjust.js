(function () {
    const resizeBindings = new Set();

    function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, number));
    }

    function normalizePercentAdjust(adjust, options = {}) {
        return {
            x: clampNumber(adjust?.x, options.fallbackX ?? 50, 0, 100),
            y: clampNumber(adjust?.y, options.fallbackY ?? 50, 0, 100),
            size: clampNumber(adjust?.size, options.fallbackSize ?? 1, options.minSize ?? 0.75, options.maxSize ?? Infinity)
        };
    }

    function normalizePixelAdjust(adjust) {
        const x = Number(adjust?.x);
        const y = Number(adjust?.y);
        const size = Number(adjust?.size);
        return {
            x: Number.isFinite(x) ? x : 0,
            y: Number.isFinite(y) ? y : 0,
            size: Number.isFinite(size) && size > 0 ? size : null
        };
    }

    function buildPercentCssVars(adjust, vars) {
        const normalized = normalizePercentAdjust(adjust);
        return [
            `${vars.x}:${normalized.x}%`,
            `${vars.y}:${normalized.y}%`,
            `${vars.size}:${normalized.size}`
        ].join("; ") + ";";
    }

    function buildNpcImageStyle(kind, adjust, counterpartAdjust) {
        const normalized = normalizePixelAdjust(adjust);
        const counterpart = normalizePixelAdjust(counterpartAdjust);
        const isHover = kind === "hover";
        const restScale = isHover
            ? (counterpart.size || 1)
            : (normalized.size || 1);
        const hoverScale = isHover
            ? (normalized.size || 1.20)
            : (counterpart.size || (normalized.size ? normalized.size * 1.20 : 1.20));

        return `--img-x:${normalized.x}px; --img-y:${normalized.y}px; --img-scale-rest:${restScale}; --img-scale-hover:${hoverScale};`;
    }

    function isDefaultPercentAdjust(adjust) {
        const normalized = normalizePercentAdjust(adjust);
        return normalized.x === 50 && normalized.y === 50 && normalized.size === 1;
    }

    function readDatasetAdjust(image, keys) {
        return normalizePercentAdjust({
            x: image?.dataset?.[keys.x],
            y: image?.dataset?.[keys.y],
            size: image?.dataset?.[keys.size]
        });
    }

    function setDatasetAdjust(image, adjust, keys, vars) {
        if (!image) return;
        const normalized = normalizePercentAdjust(adjust);
        image.dataset[keys.x] = String(normalized.x);
        image.dataset[keys.y] = String(normalized.y);
        image.dataset[keys.size] = String(normalized.size);
        if (vars) image.setAttribute("style", buildPercentCssVars(normalized, vars));
    }

    function findFrame(image, selectors = []) {
        for (const selector of selectors) {
            const frame = image?.closest?.(selector);
            if (frame) return frame;
        }
        return image?.parentElement || null;
    }

    function applyContainedImageLayout(image, options) {
        if (!image || !image.naturalWidth || !image.naturalHeight) return;
        const frame = findFrame(image, options.frameSelectors || []);
        const rect = frame?.getBoundingClientRect?.();
        if (!rect?.width || !rect?.height) return;

        const adjust = options.adjust || readDatasetAdjust(image, options.datasetKeys);
        const imageRatio = image.naturalWidth / image.naturalHeight;
        const frameRatio = rect.width / rect.height;
        let drawWidth;
        let drawHeight;
        if (imageRatio >= frameRatio) {
            drawHeight = rect.height;
            drawWidth = rect.height * imageRatio;
        } else {
            drawWidth = rect.width;
            drawHeight = rect.width / imageRatio;
        }
        drawWidth *= adjust.size;
        drawHeight *= adjust.size;

        const overflowX = Math.max(0, drawWidth - rect.width);
        const overflowY = Math.max(0, drawHeight - rect.height);
        const offsetX = ((50 - adjust.x) / 100) * overflowX;
        const offsetY = ((50 - adjust.y) / 100) * overflowY;

        image.style.position = "absolute";
        image.style.left = "50%";
        image.style.top = "50%";
        image.style.width = `${drawWidth}px`;
        image.style.height = `${drawHeight}px`;
        image.style.maxWidth = "none";
        image.style.objectFit = "fill";
        image.style.transformOrigin = "50% 50%";
        image.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
    }

    function initContainedImages(root = document, options) {
        const selector = options.selector;
        if (!selector) return;
        const bindingKey = options.bindingKey || selector;
        if (!resizeBindings.has(bindingKey)) {
            resizeBindings.add(bindingKey);
            window.addEventListener("resize", () => {
                document.querySelectorAll(selector).forEach((image) => applyContainedImageLayout(image, options));
            });
        }
        root.querySelectorAll?.(selector).forEach((image) => {
            const boundKey = options.boundDatasetKey || "imageAdjustBound";
            if (image.dataset[boundKey] !== "1") {
                image.dataset[boundKey] = "1";
                image.addEventListener("load", () => applyContainedImageLayout(image, options));
            }
            applyContainedImageLayout(image, options);
        });
    }

    window.CriptaImageAdjust = {
        applyContainedImageLayout,
        buildNpcImageStyle,
        buildPercentCssVars,
        initContainedImages,
        isDefaultPercentAdjust,
        normalizePercentAdjust,
        normalizePixelAdjust,
        setDatasetAdjust
    };
})();
