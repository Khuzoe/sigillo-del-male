(function () {
    "use strict";

    function escapeHtml(value) {
        return window.CriptaApp?.utils?.escapeHtml?.(value)
            || String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
    }

    function normalizeMarkdown(value) {
        return String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    }

    function isSecretElement(node) {
        return node?.nodeType === Node.ELEMENT_NODE && node.classList?.contains("inline-secret");
    }

    function inlineNodeToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        const tag = node.tagName.toLowerCase();
        const inner = Array.from(node.childNodes).map(inlineNodeToMarkdown).join("");
        if (tag === "br") return "\n";
        if (tag === "strong" || tag === "b") return `**${inner}**`;
        if (tag === "em" || tag === "i") return `*${inner}*`;
        if (tag === "code") return `\`${inner}\``;
        if (isSecretElement(node)) return `%%${node.textContent || ""}%%`;
        if (tag === "mark" || node.classList?.contains("managed-rich-highlight")) return `==${inner}==`;
        if (tag === "a" && node.dataset?.wikiTarget) {
            const target = String(node.dataset.wikiTarget || "").trim();
            const label = String(node.textContent || "").trim();
            return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`;
        }
        return inner;
    }

    function blockNodeToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return inlineNodeToMarkdown(node).trim();
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        const tag = node.tagName.toLowerCase();
        if (tag === "ul" || tag === "ol") {
            return Array.from(node.children)
                .filter((child) => child.tagName?.toLowerCase() === "li")
                .map((child, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${inlineNodeToMarkdown(child).trim()}`)
                .join("\n");
        }
        if (tag === "blockquote" || node.classList?.contains("document-quote")) {
            const content = inlineNodeToMarkdown(node.querySelector?.("span") || node);
            return content.split("\n").map((line) => `> ${line.trim()}`).join("\n");
        }
        if (/^h[1-6]$/.test(tag)) {
            const level = Math.max(1, Math.min(3, Number(tag.slice(1)) - 1 || 1));
            return `${"#".repeat(level)} ${inlineNodeToMarkdown(node).trim()}`;
        }
        return inlineNodeToMarkdown(node).trim();
    }

    function editorToMarkdown(editor) {
        return normalizeMarkdown(Array.from(editor?.childNodes || [])
            .map(blockNodeToMarkdown)
            .filter((value) => value !== "")
            .join("\n\n"));
    }

    function markdownToHtml(markdown, options = {}) {
        return window.CriptaMarkdown?.render?.(markdown, { ...options, preserveLineBreaks: true })
            || `<p>${escapeHtml(markdown).replace(/\n/g, "<br>")}</p>`;
    }

    function toolbarHtml() {
        const button = (command, icon, label) => `<button type="button" data-rich-text-command="${command}" title="${label}" aria-label="${label}"><i class="fas ${icon}" aria-hidden="true"></i></button>`;
        return `<div class="managed-rich-text-toolbar" role="toolbar" aria-label="Formattazione testo">
            <div>${button("undo", "fa-rotate-left", "Annulla")}${button("redo", "fa-rotate-right", "Ripeti")}</div>
            <span aria-hidden="true"></span>
            <div>${button("bold", "fa-bold", "Grassetto")}${button("italic", "fa-italic", "Corsivo")}${button("highlight", "fa-highlighter", "Evidenzia")}</div>
            <span aria-hidden="true"></span>
            <div>${button("insertUnorderedList", "fa-list-ul", "Elenco puntato")}${button("insertOrderedList", "fa-list-ol", "Elenco numerato")}${button("quote", "fa-quote-left", "Citazione")}</div>
            <span aria-hidden="true"></span>
            <div>${button("secret", "fa-eye-slash", "Testo solo DM")}${button("removeFormat", "fa-eraser", "Rimuovi formato")}</div>
        </div>`;
    }

    function getSelectionRange(editor) {
        const selection = window.getSelection?.();
        if (!selection) return null;
        if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) return selection.getRangeAt(0);
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return range;
    }

    function insertHtml(editor, html) {
        editor.focus();
        const range = getSelectionRange(editor);
        if (!range) return;
        if (document.execCommand("insertHTML", false, html)) return;
        const template = document.createElement("template");
        template.innerHTML = html;
        range.deleteContents();
        range.insertNode(template.content);
    }

    function wrapSelection(editor, className, fallback) {
        editor.focus();
        const range = getSelectionRange(editor);
        if (!range) return;
        const text = range.toString() || fallback;
        const element = document.createElement("span");
        element.className = className;
        element.textContent = text;
        range.deleteContents();
        range.insertNode(element);
        const selection = window.getSelection?.();
        selection?.removeAllRanges();
        const selected = document.createRange();
        selected.selectNodeContents(element);
        selection?.addRange(selected);
    }

    function runCommand(editor, command) {
        editor.focus();
        getSelectionRange(editor);
        if (command === "quote") document.execCommand("formatBlock", false, "blockquote");
        else if (command === "highlight") wrapSelection(editor, "managed-rich-highlight", "testo importante");
        else if (command === "secret") wrapSelection(editor, "inline-secret inline-secret--dm", "testo riservato");
        else document.execCommand(command, false, null);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function insertPlainText(editor, text) {
        const normalized = String(text || "").replace(/\r\n?/g, "\n");
        insertHtml(editor, escapeHtml(normalized).replace(/\n/g, "<br>"));
        editor.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function mount(shell, options = {}) {
        const editor = shell?.querySelector?.("[data-rich-text-editor]");
        const source = shell?.querySelector?.("[data-rich-text-source]");
        if (!editor || !source || editor.dataset.richTextMounted === "true") return null;
        editor.dataset.richTextMounted = "true";
        const sync = () => {
            source.value = editorToMarkdown(editor);
            options.onChange?.(source.value, editor, source);
        };
        shell.querySelectorAll("[data-rich-text-command]").forEach((button) => {
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => runCommand(editor, button.dataset.richTextCommand || ""));
        });
        editor.addEventListener("input", sync);
        editor.addEventListener("paste", (event) => {
            event.preventDefault();
            insertPlainText(editor, event.clipboardData?.getData("text/plain") || "");
        });
        editor.addEventListener("keydown", (event) => {
            if (event.key === "Tab") {
                event.preventDefault();
                insertPlainText(editor, "    ");
            }
        });
        source.value = normalizeMarkdown(source.value);
        return { editor, source, sync };
    }

    window.CriptaRichTextEditor = Object.freeze({
        editorToMarkdown,
        markdownToHtml,
        mount,
        normalizeMarkdown,
        toolbarHtml
    });
})();
