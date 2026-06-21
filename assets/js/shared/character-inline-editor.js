(function () {
    let runtime = {};
    let isInlineEditing = false;
    let inlineEditDirty = false;
    let inlineCharacterSaveInFlight = false;
    let inlineEditBlocks = [];
    let inlineAdjustKind = '';
    let inlineAdjustDrag = null;
    const inlineImageVersions = new Map();

    const INLINE_IMAGE_ADJUST_DRAG_SENSITIVITY = 0.35;
    const INLINE_IMAGE_ADJUST_WHEEL_STEP = 0.05;
    const INLINE_IMAGE_ADJUST_WHEEL_FINE_STEP = 0.01;
    const INLINE_IMAGE_ADJUST_MIN_ZOOM = 0.25;
    const INLINE_IMAGE_ADJUST_MAX_ZOOM = 2.75;

    function applyRuntime(context = {}) {
        runtime = context || {};
        return runtime;
    }

    function renderPage() {
        runtime.renderCharacterPage?.(
            runtime.currentCharacter,
            runtime.currentAllCharacters,
            runtime.currentNpcQuests,
            runtime.currentPlayerSkillTrees
        );
    }

    function setCurrentCharacter(character) {
        runtime.currentCharacter = character;
        runtime.setCurrentCharacter?.(character);
    }

    function setCurrentAllCharacters(characters) {
        runtime.currentAllCharacters = Array.isArray(characters) ? characters : [];
        runtime.setCurrentAllCharacters?.(runtime.currentAllCharacters);
    }

    function escapeHtml(value) {
        if (typeof runtime.escapeHtml === 'function') return runtime.escapeHtml(value);
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function slugify(value) {
        if (typeof runtime.slugify === 'function') return runtime.slugify(value);
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function looksLikeHtml(value) {
        return typeof runtime.looksLikeHtml === 'function'
            ? runtime.looksLikeHtml(value)
            : /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
    }

    function renderMarkdown(markdown, options = {}) {
        if (typeof runtime.renderMarkdown === 'function') return runtime.renderMarkdown(markdown, options);
        return window.CriptaMarkdown?.render?.(markdown, options) || escapeHtml(markdown);
    }

    function normalizeImageAdjust(adjust) {
        if (typeof runtime.normalizeImageAdjust === 'function') return runtime.normalizeImageAdjust(adjust);
        return window.CriptaCharacterNormalize?.normalizeImageAdjust?.(adjust) || { x: 0, y: 0, size: 1 };
    }

    function serializeImageAdjust(adjust) {
        return typeof runtime.serializeImageAdjust === 'function'
            ? runtime.serializeImageAdjust(adjust)
            : null;
    }

    function compactObject(object) {
        return typeof runtime.compactObject === 'function'
            ? runtime.compactObject(object)
            : Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    }

    function enter(context = {}) {
        applyRuntime(context);
        if (!runtime.currentCharacter || runtime.charType === 'player') return;
        isInlineEditing = true;
        inlineEditDirty = false;
        inlineEditBlocks = normalizeInlineEditBlocks(runtime.currentCharacter);
        runtime.editLinkEl?.classList.add('is-editing');
        renderPage();
    }

    function exit(context = {}) {
        applyRuntime(context);
        isInlineEditing = false;
        inlineEditDirty = false;
        inlineEditBlocks = [];
        runtime.editLinkEl?.classList.remove('is-editing');
        renderPage();
    }

    function normalizeInlineEditBlocks(character) {
        const blocks = Array.isArray(character?.content_blocks) ? character.content_blocks : [];
        return blocks.map((block, index) => ({
            id: slugify(block.id || block.title || `blocco-${index + 1}`),
            type: block.type === 'image_box' || block.type === 'image' || block.image ? 'image' : 'text',
            title: block.title || 'Informazioni',
            icon: block.icon || 'fa-book-open',
            image: block.image || '',
            hidden: Boolean(block.hidden),
            text: getInlineEditableBlockText(block)
        }));
    }

    function getInlineEditableBlockText(block) {
        const candidates = [
            block?.markdownText,
            block?.text,
            block?.markdownHtml,
            block?.content
        ];
        for (const candidate of candidates) {
            if (typeof candidate !== 'string' || !candidate.trim()) continue;
            if (looksLikeHtml(candidate)) return normalizeInlineMarkdownText(convertInlineHtmlStringToMarkdown(candidate));
            return normalizeInlineMarkdownText(candidate);
        }
        return '';
    }

    function convertInlineHtmlStringToMarkdown(html) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        return convertInlineEditorHtmlToMarkdown(wrapper) || stripHtmlToText(html);
    }

    function handleInput(event, context = {}) {
        applyRuntime(context);
        const target = event.target;
        const characterField = target?.dataset?.inlineCharacterField;
        const characterImageField = target?.dataset?.inlineCharacterImageField;
        const characterSummaryField = target?.dataset?.inlineCharacterSummaryField;
        const imageAdjustKind = target?.dataset?.inlineImageAdjustKind;
        const imageAdjustField = target?.dataset?.inlineImageAdjustField;
        if (characterField || characterImageField || characterSummaryField) {
            updateInlineCharacterField(target, { characterField, characterImageField, characterSummaryField });
            return;
        }
        if (imageAdjustKind && imageAdjustField) {
            updateInlineImageAdjust(imageAdjustKind, imageAdjustField, target.value);
            return;
        }

        const visualBlockIndex = Number(target?.dataset?.inlineVisualEditor);
        if (Number.isInteger(visualBlockIndex) && inlineEditBlocks[visualBlockIndex]) {
            syncInlineVisualEditor(target, visualBlockIndex);
            return;
        }

        const blockIndex = Number(target?.dataset?.inlineBlockIndex);
        const blockField = target?.dataset?.inlineBlockField;
        if (!Number.isInteger(blockIndex) || !blockField || !inlineEditBlocks[blockIndex]) return;
        const value = target.matches?.('textarea, input, select')
            ? target.value
            : target.innerText.replace(/\u00a0/g, ' ').trimEnd();
        inlineEditBlocks[blockIndex][blockField] = value;
        if (blockField === 'text') updateInlineMarkdownPreview(target, blockIndex);
        if (blockField === 'image' && runtime.currentCharacter) runtime.currentCharacter.updatedAt = new Date().toISOString();
        inlineEditDirty = true;
    }

    function handleKeyDown(event, context = {}) {
        applyRuntime(context);
        if (!isInlineEditing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
        const editor = event.target?.closest?.('[data-inline-visual-editor]');
        if (!editor) return;
        const key = String(event.key || '').toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        const blockIndex = Number(editor.dataset.inlineVisualEditor);
        if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
        const command = key === 'y' || event.shiftKey ? 'redo' : 'undo';
        event.preventDefault();
        document.execCommand(command, false, null);
        window.requestAnimationFrame(() => syncInlineVisualEditor(editor, blockIndex));
    }

    function handleChange(event, context = {}) {
        applyRuntime(context);
        const target = event.target;
        const characterField = target?.dataset?.inlineCharacterField;
        const characterImageField = target?.dataset?.inlineCharacterImageField;
        const characterSummaryField = target?.dataset?.inlineCharacterSummaryField;
        const imageAdjustKind = target?.dataset?.inlineImageAdjustKind;
        const imageAdjustField = target?.dataset?.inlineImageAdjustField;
        if (characterField || characterImageField || characterSummaryField) {
            updateInlineCharacterField(target, { characterField, characterImageField, characterSummaryField });
            renderPage();
            return;
        }
        if (imageAdjustKind && imageAdjustField) {
            updateInlineImageAdjust(imageAdjustKind, imageAdjustField, target.value);
            renderPage();
            return;
        }

        const blockIndex = Number(target?.dataset?.inlineBlockIndex);
        const blockField = target?.dataset?.inlineBlockField;
        if (!Number.isInteger(blockIndex) || !blockField || !inlineEditBlocks[blockIndex]) return;
        inlineEditBlocks[blockIndex][blockField] = target.value;
        if (blockField === 'image' && runtime.currentCharacter) runtime.currentCharacter.updatedAt = new Date().toISOString();
        inlineEditDirty = true;
        renderPage();
    }

    function applyInlineMarkdownFormat(blockIndex, format) {
        const editor = runtime.container?.querySelector(`[data-inline-visual-editor="${blockIndex}"]`);
        if (!editor || !inlineEditBlocks[blockIndex]) return;
        editor.focus();
        if (!getInlineEditorSelection(editor)) return;
        document.execCommand('styleWithCSS', false, false);
        if (format === 'bold') {
            document.execCommand('bold', false, null);
        } else if (format === 'italic') {
            document.execCommand('italic', false, null);
        } else if (format === 'list') {
            document.execCommand('insertUnorderedList');
        } else if (format === 'quote') {
            document.execCommand('formatBlock', false, 'blockquote');
        } else if (format === 'gold') {
            applyInlineHighlightFormat(editor, getInlineMarkdownFormatFallback(format));
        } else if (format === 'secret') {
            applyInlineSecretFormat(editor, getInlineMarkdownFormatFallback(format));
        } else {
            return;
        }
        syncInlineVisualEditor(editor, blockIndex);
    }

    function getInlineEditorSelection(editor) {
        const selection = window.getSelection?.();
        if (!selection) return null;
        if (
            selection.rangeCount > 0
            && editor.contains(selection.anchorNode)
            && editor.contains(selection.focusNode)
        ) {
            return selection;
        }
        const range = document.createRange();
        if (!editor.childNodes.length) editor.innerHTML = '<p><br></p>';
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return selection;
    }

    function applyInlineHighlightFormat(editor, fallbackText) {
        const selection = getInlineEditorSelection(editor);
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
            replaceInlineSelectionWithHtml(editor, `<mark>${escapeHtml(fallbackText)}</mark>`);
            return;
        }
        const selectionWasFullyHighlighted = inlineRangeIsFullyFormatted(range, isInlineHighlightNode);
        const fragment = range.cloneContents();
        if (selectionWasFullyHighlighted) {
            unwrapInlineHighlightElements(fragment);
        } else {
            unwrapInlineHighlightElements(fragment);
            wrapInlineTextNodesWithHighlight(fragment);
        }
        replaceInlineSelectionWithHtml(editor, inlineFragmentToHtml(fragment), {
            unwrapInsertedFormat: selectionWasFullyHighlighted ? isInlineHighlightElement : null
        });
    }

    function applyInlineSecretFormat(editor, fallbackText) {
        const selection = getInlineEditorSelection(editor);
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
            replaceInlineSelectionWithHtml(editor, `<span class="inline-secret inline-secret--dm">${escapeHtml(fallbackText)}</span>`);
            return;
        }
        const selectionWasFullySecret = inlineRangeIsFullyFormatted(range, isInlineSecretNode);
        const fragment = range.cloneContents();
        if (selectionWasFullySecret) {
            unwrapInlineSecretElements(fragment);
        } else {
            unwrapInlineSecretElements(fragment);
            unwrapInlineHighlightElements(fragment);
            wrapInlineFragmentWithSecret(fragment);
        }
        replaceInlineSelectionWithHtml(editor, inlineFragmentToHtml(fragment), {
            unwrapInsertedFormat: selectionWasFullySecret ? isInlineSecretElement : null
        });
        unwrapSecretHighlightAncestors(editor);
    }

    function replaceInlineSelectionWithHtml(editor, html, options = {}) {
        const selection = getInlineEditorSelection(editor);
        if (!selection || selection.rangeCount === 0) return;
        const startId = `inline-selection-start-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const endId = `inline-selection-end-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const wrappedHtml = [
            `<span data-inline-selection-marker="${startId}"></span>`,
            html || '',
            `<span data-inline-selection-marker="${endId}"></span>`
        ].join('');
        const inserted = document.execCommand('insertHTML', false, wrappedHtml);
        if (!inserted) {
            const range = selection.getRangeAt(0);
            const template = document.createElement('template');
            template.innerHTML = wrappedHtml;
            range.deleteContents();
            range.insertNode(template.content);
        }
        restoreInlineSelectionBetweenMarkers(editor, startId, endId, options);
    }

    function restoreInlineSelectionBetweenMarkers(editor, startId, endId, options = {}) {
        const startMarker = editor.querySelector(`[data-inline-selection-marker="${startId}"]`);
        const endMarker = editor.querySelector(`[data-inline-selection-marker="${endId}"]`);
        if (!startMarker || !endMarker) return;
        if (typeof options.unwrapInsertedFormat === 'function') {
            unwrapInsertedSelectionFromFormat(editor, startMarker, endMarker, options.unwrapInsertedFormat);
        }
        const range = document.createRange();
        range.setStartAfter(startMarker);
        range.setEndBefore(endMarker);
        const selection = window.getSelection?.();
        if (selection) {
            editor.focus();
            selection.removeAllRanges();
            selection.addRange(range);
        }
        startMarker.remove();
        endMarker.remove();
    }

    function unwrapInsertedSelectionFromFormat(root, startMarker, endMarker, predicate) {
        let element = findClosestInlineFormatElement(startMarker, root, predicate);
        while (element && element.contains(endMarker)) {
            if (!splitInlineFormatElementAroundMarkers(element, startMarker, endMarker)) break;
            element = findClosestInlineFormatElement(startMarker, root, predicate);
        }
    }

    function findClosestInlineFormatElement(node, root, predicate) {
        let element = node?.parentElement || null;
        while (element && element !== root) {
            if (predicate(element)) return element;
            element = element.parentElement;
        }
        return null;
    }

    function splitInlineFormatElementAroundMarkers(element, startMarker, endMarker) {
        const parent = element?.parentNode;
        if (!parent) return false;
        if (startMarker.parentNode !== element || endMarker.parentNode !== element) return false;

        const before = element.cloneNode(false);
        const after = element.cloneNode(false);
        const selected = document.createDocumentFragment();
        let phase = 'before';

        while (element.firstChild) {
            const node = element.firstChild;
            if (node === startMarker) phase = 'selected';
            if (phase === 'before') before.appendChild(node);
            else if (phase === 'selected') selected.appendChild(node);
            else after.appendChild(node);
            if (node === endMarker) phase = 'after';
        }

        if (hasMeaningfulInlineChildren(before)) parent.insertBefore(before, element);
        parent.insertBefore(selected, element);
        if (hasMeaningfulInlineChildren(after)) parent.insertBefore(after, element);
        parent.removeChild(element);
        return true;
    }

    function hasMeaningfulInlineChildren(element) {
        return Boolean(
            String(element?.textContent || '').length
            || element?.querySelector?.('img, br, i, strong, em, mark, span, a, code')
        );
    }

    function inlineFragmentToHtml(fragment) {
        const wrapper = document.createElement('div');
        wrapper.appendChild(fragment);
        return wrapper.innerHTML;
    }

    function inlineRangeIsFullyFormatted(range, predicate) {
        if (!range || typeof predicate !== 'function') return false;
        const root = range.commonAncestorContainer?.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentNode
            : range.commonAncestorContainer;
        if (!root) return false;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let hasText = false;
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!rangeIntersectsTextNode(range, node)) continue;
            if (!getSelectedTextInNode(range, node).trim()) continue;
            hasText = true;
            if (!predicate(node)) return false;
        }
        return hasText;
    }

    function rangeIntersectsTextNode(range, node) {
        try {
            return range.intersectsNode(node);
        } catch (_) {
            return false;
        }
    }

    function getSelectedTextInNode(range, node) {
        const text = String(node?.textContent || '');
        let start = 0;
        let end = text.length;
        if (range.startContainer === node) start = range.startOffset;
        if (range.endContainer === node) end = range.endOffset;
        return text.slice(Math.max(0, start), Math.max(start, end));
    }

    function isInlineHighlightNode(node) {
        let element = node?.parentElement || null;
        while (element) {
            if (isInlineHighlightElement(element)) return true;
            element = element.parentElement;
        }
        return false;
    }

    function isInlineSecretNode(node) {
        let element = node?.parentElement || null;
        while (element) {
            if (isInlineSecretElement(element)) return true;
            element = element.parentElement;
        }
        return false;
    }

    function isInlineHighlightElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (isInlineSecretElement(element)) return false;
        const tag = element.tagName.toLowerCase();
        if (tag === 'mark') return true;
        if (tag !== 'span') return false;
        const background = String(element.style?.backgroundColor || '').trim().toLowerCase();
        return Boolean(background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)');
    }

    function isInlineSecretElement(element) {
        return Boolean(element?.nodeType === Node.ELEMENT_NODE && element.classList?.contains('inline-secret'));
    }

    function unwrapInlineHighlightElements(root) {
        Array.from(root.querySelectorAll?.('mark, span') || [])
            .filter(isInlineHighlightElement)
            .forEach((element) => {
                unwrapInlineElement(element);
            });
    }

    function unwrapInlineSecretElements(root) {
        Array.from(root.querySelectorAll?.('.inline-secret') || [])
            .forEach((element) => {
                unwrapInlineElement(element);
            });
    }

    function unwrapSecretHighlightAncestors(root) {
        Array.from(root.querySelectorAll?.('.inline-secret') || [])
            .forEach((secret) => {
                let element = secret.parentElement;
                while (element && element !== root) {
                    const parent = element.parentElement;
                    if (isInlineHighlightElement(element)) unwrapInlineElement(element);
                    element = parent;
                }
            });
    }

    function unwrapInlineElement(element) {
        const parent = element?.parentNode;
        if (!parent) return;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        parent.removeChild(element);
    }

    function wrapInlineTextNodesWithHighlight(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (String(node.textContent || '').trim()) nodes.push(node);
        }
        nodes.forEach((node) => {
            if (!node.parentNode) return;
            const mark = document.createElement('mark');
            node.parentNode.insertBefore(mark, node);
            mark.appendChild(node);
        });
    }

    function wrapInlineFragmentWithSecret(fragment) {
        if (!String(fragment?.textContent || '').trim()) return;
        const secret = document.createElement('span');
        secret.className = 'inline-secret inline-secret--dm';
        while (fragment.firstChild) secret.appendChild(fragment.firstChild);
        fragment.appendChild(secret);
    }

    function renderInlineVisualEditorFromMarkdown(editor, blockIndex) {
        const block = inlineEditBlocks[blockIndex];
        block.text = normalizeInlineMarkdownText(block.text || '');
        const html = renderMarkdown(block.text || '', { context: block.type === 'image' ? 'image_box' : 'lore', showInlineSecrets: true }) || '<p></p>';
        editor.innerHTML = html;
        const textarea = editor.closest('.character-inline-markdown-shell')?.querySelector('textarea[data-inline-block-field="text"]');
        if (textarea) textarea.value = block.text || '';
    }

    function updateInlineMarkdownPreview(target, blockIndex) {
        const editor = target.closest('.character-inline-markdown-shell')?.querySelector('[data-inline-visual-editor]');
        if (editor && document.activeElement !== editor) renderInlineVisualEditorFromMarkdown(editor, blockIndex);
    }

    function syncInlineVisualEditor(editor, blockIndex) {
        unwrapSecretHighlightAncestors(editor);
        const markdown = normalizeInlineMarkdownText(convertInlineEditorHtmlToMarkdown(editor));
        inlineEditBlocks[blockIndex].text = markdown;
        const textarea = editor.closest('.character-inline-markdown-shell')?.querySelector('textarea[data-inline-block-field="text"]');
        if (textarea) textarea.value = markdown;
        inlineEditDirty = true;
    }

    function getInlineMarkdownFormatFallback(format) {
        if (format === 'list') return 'Nuovo punto elenco';
        if (format === 'quote') return 'Testo in evidenza';
        if (format === 'gold') return 'parola importante';
        if (format === 'secret') return 'frase nascosta';
        return 'testo';
    }

    function convertInlineEditorHtmlToMarkdown(editor) {
        const blocks = Array.from(editor.childNodes)
            .map((node) => convertInlineEditorBlockToMarkdown(node))
            .map((text) => text.trim())
            .filter(Boolean);
        return normalizeInlineMarkdownText(blocks.join('\n\n').trim());
    }

    function normalizeInlineMarkdownText(value) {
        let text = String(value || '').replace(/\r\n?/g, '\n');
        let previous = '';
        while (text !== previous) {
            previous = text;
            text = text
                .replace(/%%[ \t]*==([^%\n]*?)==[ \t]*%%/g, '%%$1%%')
                .replace(/==[ \t]*%%([^%\n]*)%%[ \t]*==/g, '%%$1%%')
                .replace(/%%([^%\n]*)%%([ \t]*)%%([^%\n]*)%%/g, '%%$1$2$3%%')
                .replace(/==([^=\n]*)==([ \t]*)==([^=\n]*)==/g, '==$1$2$3==')
                .replace(/\*\*([^*\n]*)\*\*([ \t]*)\*\*([^*\n]*)\*\*/g, '**$1$2$3**')
                .replace(/%%%%/g, '');
        }
        return text.trim();
    }

    function convertInlineEditorBlockToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return convertInlineEditorInlineToMarkdown(node).trim();
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName.toLowerCase();
        if (tag === 'ul') {
            return Array.from(node.children)
                .filter((child) => child.tagName?.toLowerCase() === 'li')
                .map((child) => `- ${convertInlineEditorInlineToMarkdown(child).trim()}`)
                .join('\n');
        }
        if (tag === 'blockquote') {
            return convertInlineEditorInlineToMarkdown(node)
                .split(/\n+/)
                .map((line) => `> ${line.trim()}`)
                .join('\n');
        }
        if (node.classList?.contains('document-quote')) {
            const quoteText = convertInlineEditorInlineToMarkdown(node.querySelector('span') || node);
            return quoteText.split(/\n+/).map((line) => `> ${line.trim()}`).join('\n');
        }
        if (/^h[1-6]$/.test(tag)) return convertInlineEditorInlineToMarkdown(node).trim();
        if (tag === 'div' || tag === 'p') return convertInlineEditorInlineToMarkdown(node).trim();
        return convertInlineEditorInlineToMarkdown(node).trim();
    }

    function convertInlineEditorInlineToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName.toLowerCase();
        const inner = Array.from(node.childNodes).map(convertInlineEditorInlineToMarkdown).join('');
        if (tag === 'br') return '\n';
        if (tag === 'strong' || tag === 'b') return `**${inner}**`;
        if (tag === 'em' || tag === 'i') return `*${inner}*`;
        if (isInlineSecretElement(node)) return `%%${node.textContent || ''}%%`;
        if (tag === 'mark') return node.querySelector?.('.inline-secret') ? inner : `==${inner}==`;
        if (tag === 'span' && isInlineHighlightElement(node)) return node.querySelector?.('.inline-secret') ? inner : `==${inner}==`;
        if (tag === 'code') return `\`${inner}\``;
        if (tag === 'li') return inner;
        if (tag === 'a') return inner;
        return inner;
    }

    function handleMouseDown(event, context = {}) {
        applyRuntime(context);
        if (event.target.closest('[data-inline-edit-action="format-block"]')) event.preventDefault();
    }

    function handleClick(event, context = {}) {
        applyRuntime(context);
        const actionButton = event.target.closest('[data-inline-edit-action]');
        if (!actionButton || !isInlineEditing) return;
        event.preventDefault();
        const action = actionButton.dataset.inlineEditAction;
        const blockIndex = Number(actionButton.dataset.inlineBlockIndex);

        if (action === 'cancel') {
            if (inlineEditDirty && !window.confirm('Annullare le modifiche non salvate?')) return;
            exit(runtime);
            return;
        }
        if (action === 'save') {
            saveInlineCharacterEdits();
            return;
        }
        if (action === 'upload-character-image') {
            uploadInlineCharacterImage(actionButton.dataset.inlineCharacterImageTarget || 'avatar');
            return;
        }
        if (action === 'adjust-character-image') {
            openInlineImageAdjustModal(actionButton.dataset.inlineCharacterImageTarget || 'hover');
            return;
        }
        if (action === 'upload-block-image') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            uploadInlineBlockImage(blockIndex);
            return;
        }
        if (action === 'set-icon') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            inlineEditBlocks[blockIndex].icon = actionButton.dataset.inlineIcon || 'fa-book-open';
            inlineEditDirty = true;
            renderPage();
            return;
        }
        if (action === 'format-block') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            applyInlineMarkdownFormat(blockIndex, actionButton.dataset.inlineBlockFormat || '');
            return;
        }
        if (action === 'toggle-hidden') {
            if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
            inlineEditBlocks[blockIndex].hidden = !inlineEditBlocks[blockIndex].hidden;
            inlineEditDirty = true;
            renderPage();
            return;
        }
        if (action === 'add-block') {
            inlineEditBlocks.push({
                id: uniqueInlineBlockId('nuovo-blocco'),
                type: 'text',
                title: 'Nuovo blocco',
                icon: 'fa-book-open',
                image: '',
                text: ''
            });
            inlineEditDirty = true;
            renderPage();
            return;
        }
        if (!Number.isInteger(blockIndex) || !inlineEditBlocks[blockIndex]) return;
        if (action === 'delete-block') {
            if (!window.confirm('Eliminare questo blocco?')) return;
            inlineEditBlocks.splice(blockIndex, 1);
        } else if (action === 'move-up' && blockIndex > 0) {
            [inlineEditBlocks[blockIndex - 1], inlineEditBlocks[blockIndex]] = [inlineEditBlocks[blockIndex], inlineEditBlocks[blockIndex - 1]];
        } else if (action === 'move-down' && blockIndex < inlineEditBlocks.length - 1) {
            [inlineEditBlocks[blockIndex + 1], inlineEditBlocks[blockIndex]] = [inlineEditBlocks[blockIndex], inlineEditBlocks[blockIndex + 1]];
        }
        inlineEditDirty = true;
        renderPage();
    }

    function handleDragOver(event, context = {}) {
        applyRuntime(context);
        const dropTarget = event.target.closest('[data-inline-character-image-drop-target], [data-inline-block-image-drop-target]');
        if (!isInlineEditing || !dropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        dropTarget.classList.add('is-drop-target');
    }

    function handleDragLeave(event, context = {}) {
        applyRuntime(context);
        const dropTarget = event.target.closest('[data-inline-character-image-drop-target], [data-inline-block-image-drop-target]');
        if (!isInlineEditing || !dropTarget || dropTarget.contains(event.relatedTarget)) return;
        dropTarget.classList.remove('is-drop-target');
    }

    async function handleDrop(event, context = {}) {
        applyRuntime(context);
        const dropTarget = event.target.closest('[data-inline-character-image-drop-target], [data-inline-block-image-drop-target]');
        if (!isInlineEditing || !dropTarget) return;
        event.preventDefault();
        dropTarget.classList.remove('is-drop-target');
        if (dropTarget.dataset.inlineBlockImageDropTarget !== undefined) {
            await handleInlineBlockImageDrop(Number(dropTarget.dataset.inlineBlockImageDropTarget), event.dataTransfer?.files);
            return;
        }
        await handleInlineImageDrop(dropTarget.dataset.inlineCharacterImageDropTarget, event.dataTransfer?.files);
    }

    async function uploadInlineCharacterImage(field) {
        if (!runtime.currentCharacter) return;
        const file = await runtime.pickInlineImageFile?.();
        if (!file) return;
        const path = await runtime.uploadInlineImageFile?.(file, runtime.currentCharacter.id || runtime.charId, `${field}.webp`);
        if (!path) return;
        markImageUpdated(path);
        runtime.currentCharacter.images = runtime.currentCharacter.images || {};
        runtime.currentCharacter.images[field] = path;
        if (field === 'avatar' || field === 'token') runtime.ensureDefaultNpcListImagePaths?.(runtime.currentCharacter);
        inlineEditDirty = true;
        renderPage();
    }

    async function handleInlineImageDrop(field, fileList) {
        const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith('image/'));
        if (!field || !files.length) return;
        if (field === 'avatar' && files.length === 2) {
            await handleInlineAvatarTokenDrop(files);
            return;
        }
        await uploadDroppedInlineCharacterImage(field, files[0]);
    }

    async function uploadDroppedInlineCharacterImage(field, file) {
        if (!runtime.currentCharacter || !file) return;
        const path = await runtime.uploadInlineImageFile?.(file, runtime.currentCharacter.id || runtime.charId, `${field}.webp`);
        if (!path) return;
        markImageUpdated(path);
        runtime.currentCharacter.images = runtime.currentCharacter.images || {};
        runtime.currentCharacter.images[field] = path;
        if (field === 'avatar' || field === 'token') runtime.ensureDefaultNpcListImagePaths?.(runtime.currentCharacter);
        inlineEditDirty = true;
        renderPage();
    }

    async function handleInlineAvatarTokenDrop(fileList) {
        if (!runtime.currentCharacter) return;
        const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith('image/'));
        if (files.length !== 2) return;

        try {
            const assignment = await assignAvatarAndTokenFiles(files);
            const avatarPath = await runtime.uploadInlineImageFile?.(assignment.avatar.file, runtime.currentCharacter.id || runtime.charId, 'avatar.webp');
            const tokenPath = await runtime.uploadInlineImageFile?.(assignment.token.file, runtime.currentCharacter.id || runtime.charId, 'token.webp');
            if (!avatarPath || !tokenPath) return;
            markImageUpdated(avatarPath);
            markImageUpdated(tokenPath);
            runtime.currentCharacter.images = runtime.currentCharacter.images || {};
            runtime.currentCharacter.images.avatar = avatarPath;
            runtime.currentCharacter.images.token = tokenPath;
            runtime.ensureDefaultNpcListImagePaths?.(runtime.currentCharacter);
            inlineEditDirty = true;
            renderPage();
        } catch (error) {
            console.error('Drop avatar/token fallito:', error);
            alert(`Drop avatar/token fallito: ${error?.message || error}`);
        }
    }

    async function assignAvatarAndTokenFiles(files) {
        const analyzed = await Promise.all(files.map(async (file) => {
            const dimensions = await readInlineImageDimensions(file);
            const area = dimensions.width * dimensions.height;
            const squareDelta = Math.abs(dimensions.width - dimensions.height) / Math.max(dimensions.width, dimensions.height, 1);
            return { file, ...dimensions, area, squareDelta };
        }));
        analyzed.sort((left, right) => {
            const squareSort = left.squareDelta - right.squareDelta;
            if (Math.abs(squareSort) > 0.04) return squareSort;
            return left.area - right.area;
        });
        return {
            token: analyzed[0],
            avatar: analyzed[1]
        };
    }

    async function readInlineImageDimensions(file) {
        const bitmap = await createImageBitmap(file);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close?.();
        return dimensions;
    }

    async function uploadInlineBlockImage(index, providedFile = null) {
        const block = inlineEditBlocks[index];
        if (!runtime.currentCharacter || !block) return;
        const file = providedFile || await runtime.pickInlineImageFile?.();
        if (!file) return;
        const fileName = `${slugify(block.id || block.title || `blocco-${index + 1}`)}.webp`;
        const path = await runtime.uploadInlineImageFile?.(file, runtime.currentCharacter.id || runtime.charId, fileName);
        if (!path) return;
        markImageUpdated(path);
        block.image = path;
        block.type = 'image';
        inlineEditDirty = true;
        renderPage();
    }

    async function handleInlineBlockImageDrop(index, fileList) {
        const file = Array.from(fileList || []).find((entry) => entry?.type?.startsWith('image/'));
        if (!Number.isInteger(index) || !file) return;
        await uploadInlineBlockImage(index, file);
    }

    function updateInlineCharacterField(target, fields) {
        const character = runtime.currentCharacter;
        if (!character) return;
        const value = target.value;
        if (fields.characterField) {
            if (fields.characterField === 'categoryPriority') {
                const priority = runtime.normalizeCategoryPriority?.(value);
                if (priority === null) delete character.categoryPriority;
                else character.categoryPriority = priority;
            } else {
                character[fields.characterField] = value;
            }
            if (fields.characterField === 'name') {
                if (runtime.charNameEl) runtime.charNameEl.textContent = value;
                if ((character.type || 'npc') !== 'player') {
                    const nextId = slugify(value);
                    if (nextId) character.id = nextId;
                }
            }
            if (fields.characterField === 'role' && runtime.charRoleEl) runtime.charRoleEl.textContent = value;
            character.updatedAt = new Date().toISOString();
        }
        if (fields.characterImageField) {
            character.images = character.images || {};
            character.images[fields.characterImageField] = value;
            character.updatedAt = new Date().toISOString();
            const fieldPreview = runtime.container?.querySelector(`[data-inline-character-image-preview="${cssEscape(fields.characterImageField)}"]`);
            if (fieldPreview) fieldPreview.src = resolveInlineImagePath(value);
            if (fields.characterImageField === 'avatar') {
                const preview = runtime.container?.querySelector('[data-inline-portrait-preview]');
                if (preview) preview.src = resolveInlineImagePath(value);
            }
        }
        if (fields.characterSummaryField) {
            character.summary = character.summary || {};
            character.summary[fields.characterSummaryField] = value;
        }
        inlineEditDirty = true;
    }

    function updateInlineImageAdjust(kind, field, value) {
        const character = runtime.currentCharacter;
        if (!character || !kind || !field) return;
        character.images = character.images || {};
        const key = `${kind}Adjust`;
        const current = normalizeImageAdjust(character.images[key]);
        const nextValue = field === 'size'
            ? clampInlineAdjustZoom(Number(value) || 1)
            : Number(value) || 0;
        character.images[key] = { ...current, [field]: nextValue };
        character.updatedAt = new Date().toISOString();
        inlineEditDirty = true;

        const preview = runtime.container?.querySelector(`[data-inline-character-image-preview="${cssEscape(kind)}"]`);
        if (preview) preview.setAttribute('style', buildInlineAdjustStyle(character.images[key]));
        if (kind === 'avatar') {
            const portrait = runtime.container?.querySelector('[data-inline-portrait-preview]');
            if (portrait) portrait.setAttribute('style', buildInlineAdjustStyle(character.images[key]));
        }
    }

    function buildInlineNpcAdjustPreviewStyle(kind, adjust) {
        const normalized = normalizeImageAdjust(adjust);
        const scale = kind === 'hover'
            ? (normalized.size || 1.20)
            : (normalized.size || 1);
        return `--img-x:${normalized.x}px; --img-y:${normalized.y}px; --img-scale-rest:${scale}; --img-scale-hover:${scale};`;
    }

    function getInlineImagePathForAdjust(kind) {
        const images = runtime.currentCharacter?.images || {};
        if (kind === 'idle') return images.idle || images.token || images.avatar || '';
        if (kind === 'hover') return images.hover || images.token || images.idle || images.avatar || '';
        return images[kind] || images.token || images.avatar || images.idle || '';
    }

    function getInlineImageAdjust(kind) {
        return normalizeImageAdjust(runtime.currentCharacter?.images?.[`${kind}Adjust`]);
    }

    function setInlineImageAdjust(kind, adjust) {
        const character = runtime.currentCharacter;
        if (!character || !kind) return;
        character.images = character.images || {};
        character.images[`${kind}Adjust`] = normalizeImageAdjust(adjust);
        character.updatedAt = new Date().toISOString();
        inlineEditDirty = true;
    }

    function getInlineAdjustModal() {
        let modal = document.getElementById('character-inline-image-adjust-modal');
        const ownerId = String(runtime.currentCharacter?.id || runtime.charId || '');
        if (modal && modal.dataset.inlineAdjustOwnerId !== ownerId) {
            modal.remove();
            modal = null;
        }
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'character-inline-image-adjust-modal';
        modal.className = 'character-inline-adjust-modal';
        modal.dataset.inlineAdjustOwnerId = ownerId;
        modal.hidden = true;
        modal.innerHTML = `
            <button class="character-inline-adjust-backdrop" type="button" data-inline-adjust-action="close" aria-label="Chiudi"></button>
            <div class="character-inline-adjust-dialog" role="dialog" aria-modal="true" aria-labelledby="character-inline-adjust-title">
                <section class="character-inline-adjust-preview">
                    <div class="character-inline-adjust-card">
                        <span class="character-inline-adjust-label">Idle</span>
                        <div class="npc-avatar-container" data-inline-adjust-preview-frame="idle">
                            <img class="npc-img-pop img-main" data-inline-adjust-preview-img="idle" src="" alt="" draggable="false">
                        </div>
                    </div>
                    <div class="character-inline-adjust-card">
                        <span class="character-inline-adjust-label">Hover</span>
                        <div class="npc-avatar-container" data-inline-adjust-preview-frame="hover">
                            <img class="npc-img-pop img-hover" data-inline-adjust-preview-img="hover" src="" alt="" draggable="false">
                        </div>
                    </div>
                </section>
                <section class="character-inline-adjust-controls">
                    <h2 id="character-inline-adjust-title">Regola immagine</h2>
                    <label class="character-inline-adjust-field">
                        <span>X</span>
                        <input type="range" min="-120" max="120" step="1" data-inline-adjust-field="x">
                        <input type="number" min="-120" max="120" step="1" data-inline-adjust-number="x">
                    </label>
                    <label class="character-inline-adjust-field">
                        <span>Y</span>
                        <input type="range" min="-120" max="120" step="1" data-inline-adjust-field="y">
                        <input type="number" min="-120" max="120" step="1" data-inline-adjust-number="y">
                    </label>
                    <label class="character-inline-adjust-field">
                        <span>Zoom</span>
                        <input type="range" min="0.25" max="2.75" step="0.01" data-inline-adjust-field="size">
                        <input type="number" min="0.25" max="2.75" step="0.01" data-inline-adjust-number="size">
                    </label>
                    <div class="character-inline-adjust-actions">
                        <button class="character-inline-btn character-inline-btn--ghost" type="button" data-inline-adjust-action="reset">Reset</button>
                        <button class="character-inline-btn character-inline-btn--primary" type="button" data-inline-adjust-action="close">Chiudi</button>
                    </div>
                </section>
            </div>
        `;
        document.body.appendChild(modal);
        bindInlineAdjustModal(modal);
        return modal;
    }

    function bindInlineAdjustModal(modal) {
        modal.addEventListener('input', (event) => {
            const field = event.target?.dataset?.inlineAdjustField || event.target?.dataset?.inlineAdjustNumber;
            if (!field || !inlineAdjustKind) return;
            updateInlineImageAdjust(inlineAdjustKind, field, event.target.value);
            renderInlineImageAdjustModal();
        });
        modal.addEventListener('click', (event) => {
            const action = event.target.closest('[data-inline-adjust-action]')?.dataset?.inlineAdjustAction;
            if (!action) return;
            event.preventDefault();
            if (action === 'reset') {
                resetInlineImageAdjust();
                return;
            }
            if (action === 'close') closeInlineImageAdjustModal();
        });
        modal.querySelectorAll('[data-inline-adjust-preview-frame]').forEach((frame) => {
            frame.addEventListener('pointerdown', startInlineImageAdjustDrag);
            frame.addEventListener('wheel', handleInlineImageAdjustWheel, { passive: false });
        });
        window.addEventListener('pointermove', continueInlineImageAdjustDrag);
        window.addEventListener('pointerup', endInlineImageAdjustDrag);
        window.addEventListener('pointercancel', endInlineImageAdjustDrag);
    }

    function openInlineImageAdjustModal(kind) {
        if (!runtime.currentCharacter) return;
        inlineAdjustKind = kind || 'hover';
        inlineAdjustDrag = null;
        const modal = getInlineAdjustModal();
        renderInlineImageAdjustModal();
        modal.hidden = false;
    }

    function closeInlineImageAdjustModal() {
        const modal = document.getElementById('character-inline-image-adjust-modal');
        if (modal) modal.hidden = true;
        inlineAdjustDrag = null;
        clearInlineImageAdjustModalImages();
    }

    function renderInlineImageAdjustModal() {
        const modal = document.getElementById('character-inline-image-adjust-modal');
        if (!modal || !runtime.currentCharacter) return;
        if (modal.dataset.inlineAdjustOwnerId !== String(runtime.currentCharacter.id || runtime.charId || '')) {
            closeInlineImageAdjustModal();
            return;
        }
        const title = modal.querySelector('#character-inline-adjust-title');
        if (title) title.textContent = `Regola ${inlineAdjustKind === 'idle' ? 'Idle' : inlineAdjustKind === 'hover' ? 'Hover' : inlineAdjustKind || 'immagine'}`;

        ['idle', 'hover'].forEach((kind) => {
            const img = modal.querySelector(`[data-inline-adjust-preview-img="${kind}"]`);
            const frame = modal.querySelector(`[data-inline-adjust-preview-frame="${kind}"]`);
            const card = frame?.closest('.character-inline-adjust-card');
            if (img) {
                setInlineImageAdjustPreviewImage(
                    img,
                    resolveInlineImagePath(getInlineImagePathForAdjust(kind)),
                    buildInlineNpcAdjustPreviewStyle(kind, getInlineImageAdjust(kind))
                );
            }
            if (card) card.classList.toggle('is-active', kind === inlineAdjustKind);
        });

        const activeAdjust = getInlineImageAdjust(inlineAdjustKind);
        ['x', 'y', 'size'].forEach((field) => {
            const value = field === 'size' ? activeAdjust.size || 1 : activeAdjust[field] || 0;
            modal.querySelectorAll(`[data-inline-adjust-field="${field}"], [data-inline-adjust-number="${field}"]`).forEach((input) => {
                input.value = String(value);
            });
        });
    }

    function clearInlineImageAdjustModalImages() {
        document.getElementById('character-inline-image-adjust-modal')
            ?.querySelectorAll('[data-inline-adjust-preview-img]')
            .forEach((img) => {
                delete img.dataset.inlineAdjustPreviewSrc;
                img.removeAttribute('src');
                img.removeAttribute('style');
            });
    }

    function setInlineImageAdjustPreviewImage(img, src, style) {
        const nextSrc = String(src || '');
        if (img.dataset.inlineAdjustPreviewSrc !== nextSrc) {
            img.removeAttribute('src');
            img.dataset.inlineAdjustPreviewSrc = nextSrc;
        }
        img.setAttribute('style', style);
        img.src = nextSrc;
    }

    function resetInlineImageAdjust() {
        if (!runtime.currentCharacter || !inlineAdjustKind) return;
        setInlineImageAdjust(inlineAdjustKind, { x: 0, y: 0, size: 1 });
        const preview = runtime.container?.querySelector(`[data-inline-character-image-preview="${cssEscape(inlineAdjustKind)}"]`);
        if (preview) preview.setAttribute('style', buildInlineAdjustStyle(getInlineImageAdjust(inlineAdjustKind)));
        if (inlineAdjustKind === 'avatar') {
            const portrait = runtime.container?.querySelector('[data-inline-portrait-preview]');
            if (portrait) portrait.setAttribute('style', buildInlineAdjustStyle(getInlineImageAdjust(inlineAdjustKind)));
        }
        renderInlineImageAdjustModal();
    }

    function startInlineImageAdjustDrag(event) {
        const kind = event.currentTarget?.dataset?.inlineAdjustPreviewFrame;
        if (!runtime.currentCharacter || !kind) return;
        event.preventDefault();
        inlineAdjustKind = kind;
        const adjust = getInlineImageAdjust(kind);
        inlineAdjustDrag = {
            kind,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: adjust.x,
            originY: adjust.y,
            frame: event.currentTarget
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.classList.add('is-dragging');
        renderInlineImageAdjustModal();
    }

    function continueInlineImageAdjustDrag(event) {
        if (!inlineAdjustDrag || inlineAdjustDrag.pointerId !== event.pointerId) return;
        const current = getInlineImageAdjust(inlineAdjustDrag.kind);
        setInlineImageAdjust(inlineAdjustDrag.kind, {
            ...current,
            x: Math.round(inlineAdjustDrag.originX + (event.clientX - inlineAdjustDrag.startX) * INLINE_IMAGE_ADJUST_DRAG_SENSITIVITY),
            y: Math.round(inlineAdjustDrag.originY + (event.clientY - inlineAdjustDrag.startY) * INLINE_IMAGE_ADJUST_DRAG_SENSITIVITY)
        });
        const preview = runtime.container?.querySelector(`[data-inline-character-image-preview="${cssEscape(inlineAdjustDrag.kind)}"]`);
        if (preview) preview.setAttribute('style', buildInlineAdjustStyle(getInlineImageAdjust(inlineAdjustDrag.kind)));
        renderInlineImageAdjustModal();
        inlineAdjustDrag.frame?.classList.add('is-dragging');
    }

    function endInlineImageAdjustDrag() {
        if (!inlineAdjustDrag) return;
        inlineAdjustDrag.frame?.classList.remove('is-dragging');
        inlineAdjustDrag = null;
    }

    function handleInlineImageAdjustWheel(event) {
        const kind = event.currentTarget?.dataset?.inlineAdjustPreviewFrame;
        if (!runtime.currentCharacter || !kind) return;
        event.preventDefault();
        inlineAdjustKind = kind;
        const current = getInlineImageAdjust(kind);
        const visibleSize = current.size || (kind === 'hover' ? 1.20 : 1);
        const direction = event.deltaY < 0 ? 1 : -1;
        const step = event.shiftKey ? INLINE_IMAGE_ADJUST_WHEEL_FINE_STEP : INLINE_IMAGE_ADJUST_WHEEL_STEP;
        setInlineImageAdjust(kind, {
            ...current,
            size: roundInlineAdjustZoom(clampInlineAdjustZoom(visibleSize + direction * step))
        });
        const preview = runtime.container?.querySelector(`[data-inline-character-image-preview="${cssEscape(kind)}"]`);
        if (preview) preview.setAttribute('style', buildInlineAdjustStyle(getInlineImageAdjust(kind)));
        renderInlineImageAdjustModal();
    }

    function clampInlineAdjustZoom(value) {
        return Math.min(INLINE_IMAGE_ADJUST_MAX_ZOOM, Math.max(INLINE_IMAGE_ADJUST_MIN_ZOOM, Number(value) || 1));
    }

    function roundInlineAdjustZoom(value) {
        return Math.round(value * 100) / 100;
    }

    async function saveInlineCharacterEdits() {
        if (inlineCharacterSaveInFlight) return;
        const token = runtime.readAuthToken?.() || '';
        if (!token) {
            alert('Login richiesto: accedi come DM prima di salvare.');
            return;
        }

        inlineCharacterSaveInFlight = true;
        const toolbar = runtime.container?.querySelector('[data-inline-edit-toolbar]');
        toolbar?.setAttribute('data-saving', 'true');

        try {
            const updatedCharacter = serializeInlineEditedCharacter(runtime.currentCharacter);
            const originalId = slugify(runtime.currentCharacter._originalId || runtime.charId || updatedCharacter.id || updatedCharacter.name || 'npc');
            const nextId = slugify(updatedCharacter.id || updatedCharacter.name || 'npc');
            if (originalId && nextId && originalId !== nextId) {
                await runtime.copyInlineCharacterMediaFolder?.(originalId, nextId, token);
                runtime.rewriteInlineCharacterMediaFolderPaths?.(updatedCharacter, originalId, nextId);
            }
            const buildNextData = (sourceData) => mergeInlineCharacterIntoCollection(sourceData, updatedCharacter, originalId, nextId);
            await runtime.saveVersionedCollection?.({
                load: runtime.loadCharactersDocumentForSave,
                url: runtime.getCharactersApiUrl?.(),
                token,
                buildData: buildNextData
            });
            window.CriptaApp?.api?.clearCache?.();

            const normalized = runtime.normalizeCharactersCollection?.([updatedCharacter])?.[0] || updatedCharacter;
            setCurrentCharacter(normalized);
            const nextAllCharacters = (Array.isArray(runtime.currentAllCharacters) ? runtime.currentAllCharacters.slice() : []);
            const allIndex = nextAllCharacters.findIndex((entry) => {
                const entryId = slugify(entry?.id || entry?.name || '');
                return entryId === originalId || entryId === normalized.id;
            });
            if (allIndex >= 0) nextAllCharacters[allIndex] = normalized;
            else nextAllCharacters.push(normalized);
            setCurrentAllCharacters(nextAllCharacters);

            isInlineEditing = false;
            inlineEditDirty = false;
            inlineEditBlocks = [];
            runtime.editLinkEl?.classList.remove('is-editing');
            renderPage();
        } catch (error) {
            console.error('Salvataggio inline NPC fallito:', error);
            alert(`Salvataggio fallito: ${error?.message || error}`);
        } finally {
            inlineCharacterSaveInFlight = false;
            toolbar?.removeAttribute('data-saving');
        }
    }

    function mergeInlineCharacterIntoCollection(sourceData, updatedCharacter, originalId, nextId) {
        const nextData = Array.isArray(sourceData) ? sourceData.slice() : [];
        const targetIndex = nextData.findIndex((entry) => {
            const entryId = slugify(entry?.id || entry?.name || '');
            return entryId === originalId || entryId === nextId;
        });
        if (targetIndex >= 0) {
            const mergedCharacter = { ...nextData[targetIndex], ...updatedCharacter };
            nextData[targetIndex] = mergedCharacter;
        } else {
            nextData.push(updatedCharacter);
        }
        return nextData;
    }

    function serializeInlineEditedCharacter(character) {
        const serialized = { ...character };
        delete serialized._originalId;
        delete serialized.content_blocks;
        serialized.id = character.id || runtime.charId;
        serialized.name = character.name || 'NPC senza nome';
        serialized.type = character.type || 'npc';
        serialized.category = character.category || '';
        const categoryPriority = runtime.normalizeCategoryPriority?.(character.categoryPriority);
        if (categoryPriority === null) delete serialized.categoryPriority;
        else serialized.categoryPriority = categoryPriority;
        serialized.updatedAt = character.updatedAt || new Date().toISOString();
        if ((serialized.type || 'npc') !== 'player') {
            runtime.ensureDefaultNpcListImagePaths?.(serialized);
            const images = character.images || {};
            serialized.images = {
                idle: images.idle || runtime.getSyncedNpcImagePath?.(serialized, 'idle') || '',
                hover: images.hover || runtime.getSyncedNpcImagePath?.(serialized, 'hover') || '',
                token: images.token || images.idle || '',
                avatar: images.avatar || images.token || '',
                ...compactObject({
                    idleAdjust: serializeImageAdjust(images.idleAdjust),
                    hoverAdjust: serializeImageAdjust(images.hoverAdjust),
                    tokenAdjust: serializeImageAdjust(images.tokenAdjust),
                    avatarAdjust: serializeImageAdjust(images.avatarAdjust)
                })
            };
        }
        serialized.blocks = serializeInlineBlocksForSave();
        serialized.content_blocks = inlineEditBlocks.map(serializeInlineContentBlockForSave);
        return serialized;
    }

    function serializeInlineBlocksForSave() {
        return inlineEditBlocks.map((block) => ({
            id: slugify(block.id || block.title || 'blocco'),
            type: block.type === 'image' ? 'image' : 'text',
            title: block.title || 'Informazioni',
            icon: block.icon || 'fa-book-open',
            image: block.type === 'image' ? (block.image || '') : '',
            hidden: Boolean(block.hidden),
            text: normalizeInlineMarkdownText(block.text || '')
        }));
    }

    function serializeInlineContentBlockForSave(block) {
        const text = normalizeInlineMarkdownText(block.text || '');
        const type = block.type === 'image' ? 'image_box' : 'lore';
        return compactObject({
            id: slugify(block.id || block.title || 'blocco'),
            type,
            title: block.title || 'Informazioni',
            icon: block.icon || 'fa-book-open',
            image: block.type === 'image' ? (block.image || '') : '',
            hidden: Boolean(block.hidden),
            markdownText: text,
            markdownHtml: text && typeof runtime.renderMarkdown === 'function' ? runtime.renderMarkdown(text, { showInlineSecrets: false }) : ''
        });
    }

    function stripHtmlToText(html) {
        const div = document.createElement('div');
        div.innerHTML = html || '';
        return div.innerText || '';
    }

    function uniqueInlineBlockId(base) {
        const used = new Set(inlineEditBlocks.map((block) => block.id));
        let id = slugify(base);
        let index = 2;
        while (used.has(id)) id = `${slugify(base)}-${index++}`;
        return id;
    }

    function renderIconPicker(selectedIcon, blockIndex) {
        const options = [
            ['fa-book-open', 'Libro'],
            ['fa-scroll', 'Pergamena'],
            ['fa-feather-alt', 'Nota / diario'],
            ['fa-user-secret', 'Segreto'],
            ['fa-crown', 'Corona'],
            ['fa-skull', 'Pericolo'],
            ['fa-book-dead', 'Bestiario'],
            ['fa-gem', 'Reliquia'],
            ['fa-hand-sparkles', 'Magia'],
            ['fa-heart', 'Cuore'],
            ['fa-shield-halved', 'Difesa'],
            ['fa-flag', 'Bandiera'],
            ['fa-box', 'Generico']
        ];
        const normalizedIcon = selectedIcon || 'fa-book-open';
        const known = options.some(([value]) => value === normalizedIcon);
        const effectiveOptions = known ? options : [[normalizedIcon, 'Attuale'], ...options];
        return effectiveOptions.map(([value, label]) => `
            <button type="button" class="character-inline-icon-choice ${value === normalizedIcon ? 'is-selected' : ''}" data-inline-edit-action="set-icon" data-inline-block-index="${blockIndex}" data-inline-icon="${escapeHtml(value)}" title="${escapeHtml(label)}">
                <i class="fas ${escapeHtml(value)}"></i>
                <span>${escapeHtml(label)}</span>
            </button>
        `).join('');
    }

    function removeStaleAdjustModal(character, context = {}) {
        applyRuntime(context);
        const modal = document.getElementById('character-inline-image-adjust-modal');
        const ownerId = String(character?.id || runtime.charId || '');
        if (modal && modal.dataset.inlineAdjustOwnerId !== ownerId) modal.remove();
    }

    function getInlineImageFileName(path) {
        return String(path || '').split(/[?#]/)[0].split(/[\\/]/).pop() || '';
    }

    function renderInlineImageFileName(path, fallback = 'Trascina o scegli un file webp') {
        return `<small class="character-inline-image-file-name">${escapeHtml(getInlineImageFileName(path) || fallback)}</small>`;
    }

    function renderLeftColumn(leftCol, context = {}) {
        applyRuntime(context);
        leftCol.appendChild(renderInlineEditToolbar());
        inlineEditBlocks.forEach((block, index) => {
            leftCol.appendChild(renderInlineEditBlock(block, index));
        });
        const addCard = document.createElement('button');
        addCard.className = 'character-inline-add-block';
        addCard.type = 'button';
        addCard.dataset.inlineEditAction = 'add-block';
        addCard.innerHTML = '<i class="fas fa-plus"></i><span>Aggiungi blocco</span>';
        leftCol.appendChild(addCard);
    }

    function renderInlineEditToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'character-inline-toolbar';
        toolbar.dataset.inlineEditToolbar = 'true';
        toolbar.innerHTML = `
                    <div>
                        <strong>Modifica pagina NPC</strong>
                        <span>Scrivi nei blocchi, aggiungi sezioni o elimina quelle inutili.</span>
                    </div>
                    <div class="character-inline-toolbar__actions">
                        <button type="button" class="character-inline-btn character-inline-btn--ghost" data-inline-edit-action="cancel">
                            <i class="fas fa-xmark"></i> Annulla
                        </button>
                        <button type="button" class="character-inline-btn character-inline-btn--primary" data-inline-edit-action="save">
                            <i class="fas fa-cloud-arrow-up"></i> Salva
                        </button>
                    </div>
                `;
        return toolbar;
    }

    function renderInlineEditBlock(block, index) {
        const card = document.createElement('article');
        card.className = `content-card character-inline-block ${block.type === 'image' ? 'document-card' : ''}`;
        card.dataset.inlineBlock = String(index);

        const imageControls = block.type === 'image' ? `
                    <div class="character-inline-field character-inline-field--full">
                        <span>Immagine</span>
                        <input type="hidden" value="${escapeHtml(block.image || '')}" data-inline-block-index="${index}" data-inline-block-field="image">
                        ${renderInlineImageFileName(block.image)}
                    </div>
                ` : '';

        card.innerHTML = `
                    <div class="character-inline-controls">
                        <div class="character-inline-field character-inline-field--icons">
                            <span>Icona</span>
                            <div class="character-inline-icon-grid">
                                ${renderIconPicker(block.icon || 'fa-book-open', index)}
                            </div>
                        </div>
                        <label class="character-inline-field">
                            <span>Tipo</span>
                            <select data-inline-block-index="${index}" data-inline-block-field="type">
                                <option value="text"${block.type !== 'image' ? ' selected' : ''}>Testo</option>
                                <option value="image"${block.type === 'image' ? ' selected' : ''}>Testo + immagine</option>
                            </select>
                        </label>
                        ${imageControls}
                        <div class="character-inline-actions">
                            <button type="button" class="character-inline-icon-btn ${block.hidden ? 'is-active' : ''}" data-inline-edit-action="toggle-hidden" data-inline-block-index="${index}" title="${block.hidden ? 'Blocco nascosto ai giocatori' : 'Nascondi ai giocatori'}"><i class="fas ${block.hidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button type="button" class="character-inline-icon-btn" data-inline-edit-action="move-up" data-inline-block-index="${index}" title="Sposta su"><i class="fas fa-arrow-up"></i></button>
                            <button type="button" class="character-inline-icon-btn" data-inline-edit-action="move-down" data-inline-block-index="${index}" title="Sposta giu"><i class="fas fa-arrow-down"></i></button>
                            <button type="button" class="character-inline-icon-btn character-inline-icon-btn--danger" data-inline-edit-action="delete-block" data-inline-block-index="${index}" title="Elimina"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="character-inline-final ${block.hidden ? 'character-inline-final--hidden' : ''}">
                        ${block.hidden ? '<span class="character-hidden-badge"><i class="fas fa-eye-slash"></i> Nascosto</span>' : ''}
                        ${block.type === 'image' ? `
                            <div class="document-header">
                                <div class="doc-label">
                                    <i class="fas ${escapeHtml(block.icon || 'fa-book-dead')}"></i>
                                    <span class="character-inline-title" contenteditable="plaintext-only" spellcheck="true" data-inline-block-index="${index}" data-inline-block-field="title">${escapeHtml(block.title || 'Informazioni')}</span>
                                </div>
                            </div>
                            <div class="document-body">
                                <div class="document-image">
                                    <button type="button" class="character-inline-image-upload" data-inline-edit-action="upload-block-image" data-inline-block-index="${index}" data-inline-block-image-drop-target="${index}" title="Carica nuova immagine">
                                        ${block.image ? `<img src="${resolveInlineImagePath(block.image)}" alt="${escapeHtml(block.title || '')}" onerror="this.style.display='none'">` : '<span class="character-inline-image-placeholder">Nessuna immagine</span>'}
                                        <span class="character-inline-upload-hint">Cambia immagine</span>
                                    </button>
                                </div>
                                <div class="document-content">
                                    ${renderInlineMarkdownEditor(block, index, 'chapter-content--compact')}
                                </div>
                            </div>
                        ` : `
                            <h3>
                                <i class="fas ${escapeHtml(block.icon || 'fa-book-open')}"></i>
                                <span class="character-inline-title" contenteditable="plaintext-only" spellcheck="true" data-inline-block-index="${index}" data-inline-block-field="title">${escapeHtml(block.title || 'Informazioni')}</span>
                            </h3>
                            ${renderInlineMarkdownEditor(block, index)}
                        `}
                    </div>
                `;
        runtime.classifyDocumentCardImage?.(card);
        return card;
    }

    function renderInlineMarkdownEditor(block, index, extraClass = '') {
        const previewHtml = renderMarkdown(block.text || '', { context: block.type === 'image' ? 'image_box' : 'lore', showInlineSecrets: true });
        const previewClass = extraClass ? `chapter-content ${extraClass}` : 'chapter-content';
        return `
            <div class="character-inline-markdown-shell">
                <div class="character-inline-format-toolbar" aria-label="Strumenti testo blocco">
                    ${renderInlineFormatButton(index, 'bold', 'fa-bold', 'Grassetto')}
                    ${renderInlineFormatButton(index, 'italic', 'fa-italic', 'Corsivo')}
                    ${renderInlineFormatButton(index, 'list', 'fa-list-ul', 'Elenco')}
                    ${renderInlineFormatButton(index, 'quote', 'fa-quote-left', 'Citazione')}
                    ${renderInlineFormatButton(index, 'gold', 'fa-highlighter', 'Evidenzia oro')}
                    ${renderInlineFormatButton(index, 'secret', 'fa-eye-slash', 'Oscura frase')}
                </div>
                <textarea class="character-inline-markdown-editor" hidden data-inline-block-index="${index}" data-inline-block-field="text">${escapeHtml(block.text || '')}</textarea>
                <div class="${previewClass} character-inline-markdown-preview character-inline-visual-editor" contenteditable="true" spellcheck="true" data-inline-visual-editor="${index}">${previewHtml || '<p></p>'}</div>
            </div>
        `;
    }

    function renderInlineFormatButton(index, format, icon, label) {
        return `
            <button type="button" class="character-inline-format-btn" data-inline-edit-action="format-block" data-inline-block-index="${index}" data-inline-block-format="${escapeHtml(format)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
                <i class="fas ${escapeHtml(icon)}"></i>
            </button>
        `;
    }

    function buildInlineAdjustStyle(adjust) {
        const normalized = normalizeImageAdjust(adjust);
        return `transform: translate(${normalized.x}px, ${normalized.y}px) scale(${normalized.size || 1});`;
    }

    function renderInlineImageAdjustControls(kind) {
        if (kind !== 'idle' && kind !== 'hover') return '';
        const safeKind = escapeHtml(kind);
        return `
                                <div class="character-inline-image-adjust" data-inline-image-adjust-group="${safeKind}">
                                    <button type="button" class="character-inline-adjust-open" data-inline-edit-action="adjust-character-image" data-inline-character-image-target="${safeKind}">
                                        <i class="fas fa-sliders"></i> Regola
                                    </button>
                                </div>
        `;
    }

    function formatCategoryPriorityValue(value) {
        const formatted = runtime.formatCategoryPriority?.(value);
        return formatted === undefined || formatted === null ? '' : formatted;
    }

    function getEditableRightColumnHtml(character, context = {}) {
        applyRuntime(context);
        const summary = character.summary || {};
        const images = character.images || {};
        const editableStats = [
            ['race', 'Razza'],
            ['period', 'Nascita / periodo'],
            ['age', 'Eta'],
            ['height', 'Altezza'],
            ['weight', 'Peso'],
            ['cause_of_death', 'Causa del decesso']
        ];

        return `
                    <div class="image-card character-inline-side-editor">
                        <button type="button" class="character-inline-portrait-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="avatar" data-inline-character-image-drop-target="avatar" data-avatar-token-drop-zone title="Carica avatar scheda">
                            <img src="${resolveInlineImagePath(images.avatar || images.token)}" class="char-portrait" data-inline-portrait-preview style="${buildInlineAdjustStyle(images.avatarAdjust)}" onerror="this.src='https://placehold.co/400x500/111/333?text=No+Image'">
                            <span class="character-inline-upload-hint">Cambia avatar scheda</span>
                        </button>
                        <div class="character-inline-side-fields">
                            <label class="character-inline-field">
                                <span>Nome</span>
                                <input type="text" value="${escapeHtml(character.name || '')}" data-inline-character-field="name">
                            </label>
                            <label class="character-inline-field">
                                <span>Ruolo</span>
                                <input type="text" value="${escapeHtml(character.role || '')}" data-inline-character-field="role">
                            </label>
                            <label class="character-inline-field character-inline-field--wide">
                                <span>Frase elenco</span>
                                <textarea rows="3" data-inline-character-field="quote" placeholder="Breve descrizione mostrata nella lista NPC">${escapeHtml(character.quote || '')}</textarea>
                            </label>
                            <label class="character-inline-field">
                                <span>Categoria</span>
                                <input type="text" value="${escapeHtml(character.category || '')}" data-inline-character-field="category" placeholder="es. Corte, Criminali, Alleati">
                            </label>
                            <label class="character-inline-field">
                                <span>Priorita categoria</span>
                                <input type="number" step="1" value="${escapeHtml(formatCategoryPriorityValue(character.categoryPriority))}" data-inline-character-field="categoryPriority" placeholder="vuoto = alfabetico">
                            </label>
                            <label class="character-inline-field">
                                <span>Idle lista</span>
                                <div class="character-inline-image-field-row" data-inline-character-image-drop-target="idle">
                                    <img class="character-inline-image-preview" src="${resolveInlineImagePath(images.idle || images.token)}" alt="" data-inline-character-image-preview="idle" style="${buildInlineAdjustStyle(images.idleAdjust)}" onerror="this.style.visibility='hidden'">
                                    <input type="hidden" value="${escapeHtml(images.idle || '')}" data-inline-character-image-field="idle">
                                    ${renderInlineImageFileName(images.idle)}
                                    <button type="button" class="character-inline-mini-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="idle" title="Carica idle">File</button>
                                </div>
                                ${renderInlineImageAdjustControls('idle', images.idleAdjust)}
                            </label>
                            <label class="character-inline-field">
                                <span>Hover lista</span>
                                <div class="character-inline-image-field-row" data-inline-character-image-drop-target="hover">
                                    <img class="character-inline-image-preview" src="${resolveInlineImagePath(images.hover || images.token)}" alt="" data-inline-character-image-preview="hover" style="${buildInlineAdjustStyle(images.hoverAdjust)}" onerror="this.style.visibility='hidden'">
                                    <input type="hidden" value="${escapeHtml(images.hover || '')}" data-inline-character-image-field="hover">
                                    ${renderInlineImageFileName(images.hover)}
                                    <button type="button" class="character-inline-mini-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="hover" title="Carica hover">File</button>
                                </div>
                                ${renderInlineImageAdjustControls('hover', images.hoverAdjust)}
                            </label>
                            <label class="character-inline-field">
                                <span>Token fallback</span>
                                <div class="character-inline-image-field-row" data-inline-character-image-drop-target="token">
                                    <img class="character-inline-image-preview" src="${resolveInlineImagePath(images.token || images.idle || images.avatar)}" alt="" data-inline-character-image-preview="token" style="${buildInlineAdjustStyle(images.tokenAdjust)}" onerror="this.style.visibility='hidden'">
                                    <input type="hidden" value="${escapeHtml(images.token || '')}" data-inline-character-image-field="token">
                                    ${renderInlineImageFileName(images.token)}
                                    <button type="button" class="character-inline-mini-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="token" title="Carica token">File</button>
                                </div>
                                ${renderInlineImageAdjustControls('token', images.tokenAdjust)}
                            </label>
                            <label class="character-inline-field">
                                <span>Avatar scheda</span>
                                <div class="character-inline-image-field-row" data-inline-character-image-drop-target="avatar" data-avatar-token-drop-zone>
                                    <img class="character-inline-image-preview" src="${resolveInlineImagePath(images.avatar || images.token)}" alt="" data-inline-character-image-preview="avatar" style="${buildInlineAdjustStyle(images.avatarAdjust)}" onerror="this.style.visibility='hidden'">
                                    <input type="hidden" value="${escapeHtml(images.avatar || '')}" data-inline-character-image-field="avatar">
                                    ${renderInlineImageFileName(images.avatar)}
                                    <button type="button" class="character-inline-mini-upload" data-inline-edit-action="upload-character-image" data-inline-character-image-target="avatar" title="Carica avatar scheda">File</button>
                                </div>
                                ${renderInlineImageAdjustControls('avatar', images.avatarAdjust)}
                            </label>
                        </div>
                        <div class="stats-grid character-inline-stats-grid">
                            ${editableStats.map(([field, label]) => `
                                <label class="stat-box character-inline-stat-field">
                                    <span class="stat-label">${label}</span>
                                    <input type="text" value="${escapeHtml(summary[field] || '')}" data-inline-character-summary-field="${field}" placeholder="Non disponibile">
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `;
    }

    function resolveImagePath(resolved, imagePath, context = {}) {
        applyRuntime(context);
        if (isInlineEditing) return appendInlineImageVersion(resolved, imagePath);
        return runtime.appendAssetVersion?.(resolved, runtime.currentCharacter?.updatedAt) || resolved;
    }

    function markImageUpdated(path, context) {
        if (context) applyRuntime(context);
        const key = String(path || '').trim();
        if (key) inlineImageVersions.set(key, Date.now());
        if (runtime.currentCharacter) runtime.currentCharacter.updatedAt = new Date().toISOString();
    }

    function resolveInlineImagePath(imagePath, context) {
        if (context) applyRuntime(context);
        const resolved = runtime.resolveCharacterAssetPath?.(imagePath) || String(imagePath || '');
        return appendInlineImageVersion(resolved, imagePath);
    }

    function appendInlineImageVersion(resolved, imagePath) {
        const version = inlineImageVersions.get(String(imagePath || '').trim());
        if (!version || !resolved) return resolved;
        try {
            const url = new URL(resolved, window.location.href);
            url.searchParams.set('v', String(version));
            return url.toString();
        } catch (_) {
            const separator = resolved.includes('?') ? '&' : '?';
            return `${resolved}${separator}v=${version}`;
        }
    }

    function cssEscape(value) {
        return window.CSS?.escape ? window.CSS.escape(String(value || '')) : String(value || '').replace(/"/g, '\\"');
    }

    window.CriptaCharacterInlineEditor = Object.freeze({
        enter,
        exit,
        isEditing: () => isInlineEditing,
        handleInput,
        handleKeyDown,
        handleChange,
        handleMouseDown,
        handleClick,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        renderLeftColumn,
        getEditableRightColumnHtml,
        removeStaleAdjustModal,
        resolveImagePath,
        markImageUpdated,
        resolveInlineImagePath
    });
})();
