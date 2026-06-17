(function () {
    const DEFAULT_CAMPAIGN_ID = "cripta-di-sangue";
    const DEFAULT_WORKER_ORIGIN = "https://sigillo-api.khuzoe.workers.dev";

    function getWorkerOrigin() {
        return window.CriptaApp?.config?.workerOrigin || DEFAULT_WORKER_ORIGIN;
    }

    function getCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || DEFAULT_CAMPAIGN_ID;
    }

    function getAuthToken() {
        const tokenKey = window.CriptaApp?.config?.tokenStorageKey || "sigillo_discord_token";
        try {
            return window.localStorage.getItem(tokenKey)
                || window.sessionStorage.getItem(tokenKey)
                || "";
        } catch (_) {
            return "";
        }
    }

    function withCampaign(url, options = {}) {
        const target = new URL(url, window.location.href);
        const campaignId = options.campaignId || getCampaignId();
        if (options.force === true || campaignId !== DEFAULT_CAMPAIGN_ID) {
            target.searchParams.set("campaign", campaignId);
        }
        if (options.cacheBust === true) target.searchParams.set("_", Date.now().toString());
        return target.toString();
    }

    function buildUploadUrl(folder, options = {}) {
        const base = window.CriptaApp?.urls?.api?.("media/upload")
            || `${getWorkerOrigin()}/media/upload`;
        const target = new URL(withCampaign(base, { ...options, force: true }));
        if (folder) target.searchParams.set("folder", folder);
        return target.toString();
    }

    function buildCampaignMediaPath(folder, fileName, options = {}) {
        const cleanFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
        const cleanFileName = String(fileName || "").replace(/^\/+/, "");
        return `media/campaigns/${options.campaignId || getCampaignId()}/${cleanFolder}/${cleanFileName}`;
    }

    function isWebpFile(fileOrName) {
        const name = typeof fileOrName === "string" ? fileOrName : fileOrName?.name;
        return /\.webp$/i.test(String(name || "").trim());
    }

    async function convertImageFileToWebpBlob(file, options = {}) {
        const quality = Number.isFinite(Number(options.quality)) ? Number(options.quality) : 0.92;
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        bitmap.close?.();

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Il browser non ha prodotto un file WebP."));
                    return;
                }
                resolve(blob);
            }, "image/webp", quality);
        });
    }

    async function imageFileToUploadBlob(file, options = {}) {
        if (isWebpFile(file)) return file;
        return convertImageFileToWebpBlob(file, options);
    }

    function validateUploadPayload(payload, blob, fileName = "media.webp") {
        const expectedSize = Number(blob?.size || 0);
        const storedSize = Number(payload?.storedSize || payload?.size || 0);
        if (expectedSize > 0 && storedSize > 0 && expectedSize !== storedSize) {
            throw new Error(`Upload R2 non coerente per ${fileName}: inviati ${expectedSize} byte, salvati ${storedSize} byte.`);
        }
        if (!payload?.key && !payload?.path) {
            throw new Error(`Upload R2 senza path/key per ${fileName}.`);
        }
    }

    async function uploadBlob(blob, options = {}) {
        const folder = String(options.folder || "").replace(/^\/+|\/+$/g, "");
        const fileName = String(options.fileName || options.filename || "media.webp").replace(/^\/+/, "");
        const token = options.token !== undefined ? options.token : getAuthToken();
        if (!token) throw new Error(options.authError || "Login richiesto per caricare immagini.");
        if (!folder) throw new Error("Cartella media mancante.");
        if (!fileName) throw new Error("Nome file media mancante.");

        const form = new FormData();
        form.set("folder", folder);
        form.set("filename", fileName);
        form.set("campaignId", options.campaignId || getCampaignId());
        form.set("file", new File([blob], fileName, { type: options.type || blob?.type || "image/webp" }));

        const response = await fetch(buildUploadUrl(folder, options), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false || !payload?.path) {
            throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        validateUploadPayload(payload, blob, fileName);
        return {
            ...payload,
            path: payload.path || payload.key || buildCampaignMediaPath(folder, fileName, options)
        };
    }

    async function uploadImageFile(file, options = {}) {
        const blob = await imageFileToUploadBlob(file, options);
        return uploadBlob(blob, {
            ...options,
            fileName: options.fileName || options.filename || file?.name || "media.webp",
            type: "image/webp"
        });
    }

    function appendVersion(path, version) {
        return window.CriptaApp?.utils?.appendAssetVersion
            ? window.CriptaApp.utils.appendAssetVersion(path, version)
            : path;
    }

    function resolveUrl(path, options = {}) {
        return window.CriptaApp?.utils?.resolveImageUrl
            ? window.CriptaApp.utils.resolveImageUrl(path, options)
            : String(path || "");
    }

    window.CriptaMedia = {
        appendVersion,
        buildCampaignMediaPath,
        buildUploadUrl,
        convertImageFileToWebpBlob,
        getAuthToken,
        getCampaignId,
        imageFileToUploadBlob,
        isWebpFile,
        resolveUrl,
        uploadBlob,
        uploadImageFile,
        validateUploadPayload,
        withCampaign
    };
})();
