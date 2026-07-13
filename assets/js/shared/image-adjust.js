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

    function normalizeFrameCircle(value) {
        const raw = value?.frameCircle || value;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const x = Number(raw.x);
        const y = Number(raw.y);
        const radius = Number(raw.radius);
        if (![x, y, radius].every(Number.isFinite)) return null;
        return {
            x: clampNumber(x, .5, 0, 1),
            y: clampNumber(y, .5, 0, 1),
            radius: clampNumber(radius, .42, .03, .5)
        };
    }

    function readFrameCircleDataset(image) {
        if (!image || image.dataset.frameCircle !== "1") return null;
        return normalizeFrameCircle({
            x: image.dataset.frameCircleX,
            y: image.dataset.frameCircleY,
            radius: image.dataset.frameCircleRadius
        });
    }

    function setFrameCircleDataset(image, value, options = {}) {
        if (!image) return null;
        const circle = normalizeFrameCircle(value);
        if (!circle) {
            delete image.dataset.frameCircle;
            delete image.dataset.frameCircleX;
            delete image.dataset.frameCircleY;
            delete image.dataset.frameCircleRadius;
            delete image.dataset.frameCircleTarget;
            delete image.dataset.frameCircleScale;
            return null;
        }
        image.dataset.frameCircle = "1";
        image.dataset.frameCircleX = String(circle.x);
        image.dataset.frameCircleY = String(circle.y);
        image.dataset.frameCircleRadius = String(circle.radius);
        if (options.target) image.dataset.frameCircleTarget = String(options.target);
        else delete image.dataset.frameCircleTarget;
        const requestedScale = Number(options.scale);
        if (Number.isFinite(requestedScale)) {
            image.dataset.frameCircleScale = String(clampNumber(requestedScale, 1, .1, 2));
        } else {
            delete image.dataset.frameCircleScale;
        }
        return circle;
    }

    function getFrameCircleGeometry(image) {
        const circle = readFrameCircleDataset(image);
        if (!circle || !image?.naturalWidth || !image?.naturalHeight) return null;
        const host = image.closest?.("[data-frame-circle-host]") || image.parentElement;
        const hostRect = host?.getBoundingClientRect?.();
        if (!hostRect?.width || !hostRect?.height) return null;
        let targetRect = hostRect;
        const targetSelector = String(image.dataset.frameCircleTarget || "").trim();
        if (targetSelector) {
            try {
                const target = host.querySelector(targetSelector);
                const candidate = target?.getBoundingClientRect?.();
                if (candidate?.width && candidate?.height) targetRect = candidate;
            } catch (_) {
                // Ignore invalid selectors from old data.
            }
        }
        const hostStyle = getComputedStyle(host);
        const hostOriginX = hostRect.left + (parseFloat(hostStyle.borderLeftWidth) || 0);
        const hostOriginY = hostRect.top + (parseFloat(hostStyle.borderTopWidth) || 0);
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;
        const naturalMin = Math.min(naturalWidth, naturalHeight);
        const requestedScale = Number(image.dataset.frameCircleScale);
        const frameScale = Number.isFinite(requestedScale) ? clampNumber(requestedScale, 1, .1, 2) : 1;
        const diameter = Math.min(targetRect.width, targetRect.height) * frameScale;
        const sourceRadius = circle.radius * naturalMin;
        if (!sourceRadius || !diameter) return null;
        const scale = diameter / (sourceRadius * 2);
        const centerX = targetRect.left - hostOriginX + targetRect.width / 2;
        const centerY = targetRect.top - hostOriginY + targetRect.height / 2;
        return {
            host,
            circle,
            width: naturalWidth * scale,
            height: naturalHeight * scale,
            left: centerX - circle.x * naturalWidth * scale,
            top: centerY - circle.y * naturalHeight * scale
        };
    }

    function applyFrameCircleLayout(image) {
        const geometry = getFrameCircleGeometry(image);
        if (!geometry) return;
        image.style.position = "absolute";
        image.style.inset = "auto";
        image.style.left = `${geometry.left}px`;
        image.style.top = `${geometry.top}px`;
        image.style.width = `${geometry.width}px`;
        image.style.height = `${geometry.height}px`;
        image.style.maxWidth = "none";
        image.style.maxHeight = "none";
        image.style.objectFit = "fill";
        image.style.objectPosition = "initial";
        image.style.transform = "none";
        image.style.transformOrigin = `${geometry.circle.x * 100}% ${geometry.circle.y * 100}%`;
    }

    function initFrameCircleImages(root = document) {
        const images = root.querySelectorAll?.('[data-frame-circle="1"]') || [];
        images.forEach((image) => {
            if (image.dataset.frameCircleBound !== "1") {
                image.dataset.frameCircleBound = "1";
                image.addEventListener("load", () => applyFrameCircleLayout(image));
            }
            applyFrameCircleLayout(image);
        });
        if (!resizeBindings.has("frame-circle-images")) {
            resizeBindings.add("frame-circle-images");
            window.addEventListener("resize", () => {
                document.querySelectorAll('[data-frame-circle="1"]').forEach(applyFrameCircleLayout);
            });
        }
    }

    window.CriptaImageAdjust = {
        applyContainedImageLayout,
        applyFrameCircleLayout,
        buildNpcImageStyle,
        buildPercentCssVars,
        initContainedImages,
        initFrameCircleImages,
        isDefaultPercentAdjust,
        normalizeFrameCircle,
        normalizePercentAdjust,
        normalizePixelAdjust,
        setDatasetAdjust,
        setFrameCircleDataset
    };
})();
