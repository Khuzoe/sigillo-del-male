const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGE_JS_WARN_BYTES = 560 * 1024;
const PAGE_CSS_WARN_BYTES = 360 * 1024;

function walk(dir, predicate, results = []) {
    if (!fs.existsSync(dir)) return results;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, predicate, results);
            return;
        }
        if (!predicate || predicate(fullPath)) results.push(fullPath);
    });
    return results;
}

function fileSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch (_) {
        return 0;
    }
}

function toPosix(value) {
    return value.replace(/\\/g, "/");
}

function resolveLocalAsset(htmlFile, assetPath) {
    const clean = String(assetPath || "").trim();
    if (!clean || /^(https?:)?\/\//i.test(clean) || /^(data:|blob:)/i.test(clean)) return null;
    const withoutQuery = clean.split(/[?#]/)[0];
    return path.resolve(path.dirname(htmlFile), withoutQuery);
}

function extractAttributes(html, tag, attr) {
    const regex = new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "gi");
    const values = [];
    let match = null;
    while ((match = regex.exec(html))) values.push(match[1]);
    return values;
}

function auditHtmlPage(filePath) {
    const html = fs.readFileSync(filePath, "utf8");
    const scripts = extractAttributes(html, "script", "src");
    const stylesheets = extractAttributes(html, "link", "href")
        .filter((href) => {
            const tagMatch = html.match(new RegExp(`<link\\b[^>]*href=["']${escapeRegExp(href)}["'][^>]*>`, "i"));
            return /rel=["'][^"']*stylesheet/i.test(tagMatch?.[0] || "");
        });

    const localScripts = scripts
        .map((src) => resolveLocalAsset(filePath, src))
        .filter(Boolean)
        .filter((asset) => asset.startsWith(ROOT));
    const localStyles = stylesheets
        .map((href) => resolveLocalAsset(filePath, href))
        .filter(Boolean)
        .filter((asset) => asset.startsWith(ROOT));

    return {
        page: toPosix(path.relative(ROOT, filePath)),
        hasCharset: /<meta\s+charset=/i.test(html),
        scriptBytes: localScripts.reduce((sum, asset) => sum + fileSize(asset), 0),
        styleBytes: localStyles.reduce((sum, asset) => sum + fileSize(asset), 0),
        scripts: localScripts.map((asset) => toPosix(path.relative(ROOT, asset))),
        styles: localStyles.map((asset) => toPosix(path.relative(ROOT, asset))),
        externalScripts: scripts.filter((src) => /^(https?:)?\/\//i.test(src)).length,
        externalStyles: stylesheets.filter((href) => /^(https?:)?\/\//i.test(href)).length
    };
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function scanStaticJsonFetches() {
    const jsFiles = walk(path.join(ROOT, "assets", "js"), (file) => file.endsWith(".js"));
    const matches = [];
    const pattern = /fetch\s*\([^)\n]*(?:\.json|dataUrl\(|DATA_URL|TRANSFORMATIONS_DATA_URL|SKILLS_DATA_URL|WIKI_ITEMS_DATA_URL)/g;
    jsFiles.forEach((file) => {
        const rel = toPosix(path.relative(ROOT, file));
        const text = fs.readFileSync(file, "utf8");
        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (pattern.test(line)) matches.push(`${rel}:${index + 1}`);
            pattern.lastIndex = 0;
        });
    });
    return matches;
}

function main() {
    const htmlFiles = [
        path.join(ROOT, "index.html"),
        ...walk(path.join(ROOT, "pages"), (file) => file.endsWith(".html")),
        ...walk(path.join(ROOT, "tools"), (file) => file.endsWith(".html"))
    ];

    const pageAudits = htmlFiles.map(auditHtmlPage);
    const missingCharset = pageAudits.filter((entry) => !entry.hasCharset).map((entry) => entry.page);
    const heavyScriptPages = pageAudits.filter((entry) => entry.scriptBytes > PAGE_JS_WARN_BYTES);
    const heavyStylePages = pageAudits.filter((entry) => entry.styleBytes > PAGE_CSS_WARN_BYTES);
    const staticJsonFetches = scanStaticJsonFetches();

    console.log("Performance audit");
    console.log(`- HTML pages: ${pageAudits.length}`);
    console.log(`- Largest local JS pages:`);
    pageAudits
        .slice()
        .sort((a, b) => b.scriptBytes - a.scriptBytes)
        .slice(0, 8)
        .forEach((entry) => {
            console.log(`  ${entry.page}: JS ${formatBytes(entry.scriptBytes)}, CSS ${formatBytes(entry.styleBytes)}`);
        });

    if (missingCharset.length) {
        console.log("\nWarnings: missing <meta charset>");
        missingCharset.forEach((page) => console.log(`- ${page}`));
    }

    if (heavyScriptPages.length) {
        console.log(`\nWarnings: local JS over ${formatBytes(PAGE_JS_WARN_BYTES)}`);
        heavyScriptPages.forEach((entry) => console.log(`- ${entry.page}: ${formatBytes(entry.scriptBytes)}`));
    }

    if (heavyStylePages.length) {
        console.log(`\nWarnings: local CSS over ${formatBytes(PAGE_CSS_WARN_BYTES)}`);
        heavyStylePages.forEach((entry) => console.log(`- ${entry.page}: ${formatBytes(entry.styleBytes)}`));
    }

    if (staticJsonFetches.length) {
        console.log("\nReview: static JSON fetches still present");
        staticJsonFetches.slice(0, 30).forEach((entry) => console.log(`- ${entry}`));
        if (staticJsonFetches.length > 30) console.log(`- ... ${staticJsonFetches.length - 30} more`);
    }
}

main();
