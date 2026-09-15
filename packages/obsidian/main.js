"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const view_1 = require("@codemirror/view");
const DEFAULT_SETTINGS = {
    foldEnabled: true,
};
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Global reference to active plugin instance for widgets/modals
let activePluginInstance = null;
class CriticBadgeWidget extends view_1.WidgetType {
    constructor(original, comment) {
        super();
        this.original = original;
        this.comment = comment;
    }
    eq(other) {
        return this.original === other.original && this.comment === other.comment;
    }
    toDOM(view) {
        const badge = document.createElement("span");
        badge.className = "cm-critic-badge";
        badge.innerHTML = `💬 <span>${escapeHtml(this.comment)}</span>`;
        badge.title = `批注：${this.comment} (点击查看或删除)`;
        badge.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (activePluginInstance) {
                new AnnotationManageModal(activePluginInstance.app, view, this.original, this.comment).open();
            }
        });
        return badge;
    }
    ignoreEvent(e) {
        return e.type === "click" || e.type === "mousedown";
    }
}
// Annotation Input Modal (新增批注)
class AddAnnotationModal extends obsidian_1.Modal {
    constructor(app, editor, selectedText) {
        super(app);
        this.editor = editor;
        this.selectedText = selectedText;
        this.comment = "";
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("critic-annotate-modal");
        contentEl.createEl("h3", { text: "✍️ 添加划词批注" });
        // Quote preview
        const quoteBox = contentEl.createEl("div", {
            cls: "critic-quote-box",
            text: `“${this.selectedText}”`,
        });
        quoteBox.style.cssText = "padding: 8px 12px; border-radius: 8px; background: rgba(234, 179, 8, 0.12); border-left: 3px solid #eab308; margin-bottom: 12px; font-size: 13px;";
        // Textarea
        const textarea = contentEl.createEl("textarea");
        textarea.placeholder = "输入修改意见 / 批注内容 (按 ⌘+Enter 插入)...";
        textarea.style.cssText = "width: 100%; height: 75px; padding: 8px; border-radius: 6px; box-sizing: border-box; resize: none; margin-bottom: 12px; background: rgba(0,0,0,0.25); color: inherit; border: 1px solid var(--background-modifier-border);";
        textarea.addEventListener("input", () => {
            this.comment = textarea.value;
        });
        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                this.submit();
            }
        });
        // Buttons
        const footer = contentEl.createEl("div");
        footer.style.cssText = "display: flex; justify-content: flex-end; gap: 8px;";
        const cancelBtn = footer.createEl("button", { text: "取消 (Esc)" });
        cancelBtn.onclick = () => this.close();
        const submitBtn = footer.createEl("button", { text: "✍️ 插入批注 (⌘↵)", cls: "mod-cta" });
        submitBtn.onclick = () => this.submit();
        setTimeout(() => textarea.focus(), 50);
    }
    submit() {
        const text = this.comment.trim();
        if (!text) {
            new obsidian_1.Notice("请输入批注内容");
            return;
        }
        const critic = `{==${this.selectedText.trim()}==}{>>${text}<<}`;
        this.editor.replaceSelection(critic);
        this.close();
        new obsidian_1.Notice("✅ 已在文档中插入批注！");
    }
    onClose() {
        this.contentEl.empty();
    }
}
// Annotation Manage Modal (查看/编辑/删除)
class AnnotationManageModal extends obsidian_1.Modal {
    constructor(app, view, originalText, comment) {
        super(app);
        this.view = view;
        this.originalText = originalText;
        this.comment = comment;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "💬 批注详情" });
        // Quote
        const quoteBox = contentEl.createEl("div", {
            text: `“${this.originalText}”`,
        });
        quoteBox.style.cssText = "padding: 8px 12px; border-radius: 8px; background: rgba(234, 179, 8, 0.12); border-left: 3px solid #eab308; margin-bottom: 12px; font-size: 13px;";
        // Editable comment textarea
        const textarea = contentEl.createEl("textarea");
        textarea.value = this.comment;
        textarea.style.cssText = "width: 100%; height: 75px; padding: 8px; border-radius: 6px; box-sizing: border-box; resize: none; margin-bottom: 12px; background: rgba(0,0,0,0.25); color: inherit; border: 1px solid var(--background-modifier-border);";
        // Footer
        const footer = contentEl.createEl("div");
        footer.style.cssText = "display: flex; justify-content: space-between; align-items: center;";
        const deleteBtn = footer.createEl("button", { text: "🗑️ 删除此批注", cls: "mod-warning" });
        deleteBtn.onclick = () => {
            this.updateInDoc(null);
            this.close();
            new obsidian_1.Notice("✅ 已删除批注并还原原文！");
        };
        const rightGroup = footer.createEl("div");
        rightGroup.style.cssText = "display: flex; gap: 8px;";
        const cancelBtn = rightGroup.createEl("button", { text: "取消 (Esc)" });
        cancelBtn.onclick = () => this.close();
        const saveBtn = rightGroup.createEl("button", { text: "保存修改 (⌘↵)", cls: "mod-cta" });
        saveBtn.onclick = () => {
            const newComment = textarea.value.trim();
            if (!newComment) {
                new obsidian_1.Notice("批注内容不能为空");
                return;
            }
            this.updateInDoc(newComment);
            this.close();
            new obsidian_1.Notice("✅ 批注已修改并保存！");
        };
        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveBtn.click();
            }
        });
        setTimeout(() => textarea.focus(), 50);
    }
    updateInDoc(newCommentOrNull) {
        const fullDoc = this.view.state.doc.toString();
        const safeOrig = escapeRegExp(this.originalText.trim());
        const safeOldComm = escapeRegExp(this.comment.trim());
        let pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>\\s*${safeOldComm}\\s*<<\\}`, "g");
        let match = pattern.exec(fullDoc);
        if (!match) {
            pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
            match = pattern.exec(fullDoc);
        }
        if (!match) {
            const words = this.originalText.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
            pattern = new RegExp(`\\{==\\s*${words}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
            match = pattern.exec(fullDoc);
        }
        if (match) {
            const from = match.index;
            const to = from + match[0].length;
            const replacement = newCommentOrNull === null
                ? this.originalText.trim()
                : `{==${this.originalText.trim()}==}{>>${newCommentOrNull.trim()}<<}`;
            this.view.dispatch({
                changes: { from, to, insert: replacement },
            });
        }
    }
    onClose() {
        this.contentEl.empty();
    }
}
class CriticMarkupPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.settings = DEFAULT_SETTINGS;
        this.floatingBtn = null;
        this.activeSelectedText = "";
    }
    async onload() {
        activePluginInstance = this;
        await this.loadSettings();
        // 1. Register CodeMirror 6 Visual Decorator (for Live Preview / Editing View)
        this.registerEditorExtension(this.buildEditorExtension());
        // 2. Register Markdown Post Processor (for Reading View)
        this.registerMarkdownPostProcessor((element) => {
            if (!this.settings.foldEnabled)
                return;
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node;
            const nodesToReplace = [];
            const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;
            while ((node = walker.nextNode())) {
                if (node.nodeValue && node.nodeValue.includes("{==") && node.nodeValue.includes("<<}")) {
                    const parent = node.parentElement;
                    if (parent && !parent.closest("pre, code")) {
                        nodesToReplace.push(node);
                    }
                }
            }
            nodesToReplace.forEach((textNode) => {
                const text = textNode.nodeValue || "";
                if (!regex.test(text))
                    return;
                regex.lastIndex = 0;
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    const before = text.slice(lastIndex, match.index);
                    if (before)
                        fragment.appendChild(document.createTextNode(before));
                    const originalText = match[1];
                    const comment = match[2];
                    const mark = document.createElement("mark");
                    mark.className = "cm-critic-highlight";
                    mark.textContent = originalText;
                    const badge = document.createElement("span");
                    badge.className = "cm-critic-badge";
                    badge.innerHTML = `💬 <span>${escapeHtml(comment)}</span>`;
                    badge.title = `批注：${comment}`;
                    mark.appendChild(badge);
                    fragment.appendChild(mark);
                    lastIndex = regex.lastIndex;
                }
                const remaining = text.slice(lastIndex);
                if (remaining)
                    fragment.appendChild(document.createTextNode(remaining));
                if (textNode.parentNode) {
                    textNode.parentNode.replaceChild(fragment, textNode);
                }
            });
        });
        // 3. Setup Floating Toolbar on Mouse Selection
        this.setupFloatingToolbar();
        // 4. Register Commands
        this.addCommand({
            id: "criticmarkup-add-annotation",
            name: "添加划词批注 (Add Annotation)",
            editorCallback: (editor) => {
                const selection = editor.getSelection().trim();
                if (!selection) {
                    new obsidian_1.Notice("请先划选要批注的一段文字");
                    return;
                }
                new AddAnnotationModal(this.app, editor, selection).open();
            },
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "c",
                },
            ],
        });
        this.addCommand({
            id: "criticmarkup-extract-annotations",
            name: "一键提取全文档批注为 Agent 指令 (Extract for Agent)",
            editorCallback: (editor) => {
                const content = editor.getValue();
                const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}|\{>>([\s\S]*?)<<\}/g;
                const matches = [];
                let match;
                while ((match = regex.exec(content)) !== null) {
                    if (match[1] && match[2]) {
                        matches.push({ text: match[1].trim(), comment: match[2].trim() });
                    }
                    else if (match[3]) {
                        matches.push({ text: "(上下文)", comment: match[3].trim() });
                    }
                }
                if (matches.length === 0) {
                    new obsidian_1.Notice("ℹ️ 当前文档暂无批注");
                    return;
                }
                let report = `# 文档审阅与修改要求 (来自批注)\n\n`;
                report += `本文档共包含 **${matches.length}** 条审阅修改意见：\n\n`;
                matches.forEach((item, index) => {
                    report += `### 批注 ${index + 1}\n`;
                    report += `- **原文位置**：\`${item.text}\`\n`;
                    report += `- **修改批注**：${item.comment}\n\n`;
                });
                report += `请严格根据上述批注修改对应文件并保存，保持其他无关内容不变。\n`;
                navigator.clipboard.writeText(report).then(() => {
                    new obsidian_1.Notice(`✅ 已将全部 ${matches.length} 条批注复制到剪贴板！可以直接发给 AI Agent。`);
                });
            },
            hotkeys: [
                {
                    modifiers: ["Mod", "Shift"],
                    key: "e",
                },
            ],
        });
        this.addCommand({
            id: "criticmarkup-toggle-fold",
            name: "切换便签折叠视图 / 源码视图 (Toggle View)",
            callback: () => {
                this.settings.foldEnabled = !this.settings.foldEnabled;
                this.saveSettings();
                new obsidian_1.Notice(this.settings.foldEnabled ? "👁️ 已开启便签折叠预览" : "📝 已切换至纯文本源码视图");
                this.app.workspace.updateOptions();
            },
            hotkeys: [
                {
                    modifiers: ["Alt", "Shift"],
                    key: "c",
                },
            ],
        });
        console.log("[CriticFlow] Plugin loaded successfully!");
        new obsidian_1.Notice("⚡️ CriticFlow 划词批注插件已激活！");
    }
    buildEditorExtension() {
        const criticMatcher = new view_1.MatchDecorator({
            regexp: /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g,
            decorate: (add, from, to, match) => {
                if (!this.settings.foldEnabled)
                    return;
                const orig = match[1];
                const comm = match[2];
                const origStart = from + 3;
                const origEnd = origStart + orig.length;
                // 1. Hide opening {==
                add(from, origStart, view_1.Decoration.replace({}));
                // 2. Continuous highlight on original text
                add(origStart, origEnd, view_1.Decoration.mark({ class: "cm-critic-highlight" }));
                // 3. Replace ==}{>>comment<<} with golden capsule widget
                add(origEnd, to, view_1.Decoration.replace({
                    widget: new CriticBadgeWidget(orig, comm),
                }));
            },
        });
        return view_1.ViewPlugin.define((view) => ({
            decorations: criticMatcher.createDeco(view),
            update(u) {
                this.decorations = activePluginInstance?.settings.foldEnabled
                    ? criticMatcher.updateDeco(u, this.decorations)
                    : view_1.Decoration.none;
            },
        }), {
            decorations: (v) => v.decorations,
        });
    }
    setupFloatingToolbar() {
        this.floatingBtn = document.createElement("div");
        this.floatingBtn.id = "obsidian-floating-annotate-btn";
        this.floatingBtn.innerHTML = `<span style="color:#eab308;font-size:13px;">📝</span><span>批注</span>`;
        document.body.appendChild(this.floatingBtn);
        const updateBtn = () => {
            const activeView = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
            if (!activeView || !activeView.editor) {
                if (this.floatingBtn)
                    this.floatingBtn.style.display = "none";
                return;
            }
            const sel = activeView.editor.getSelection().trim();
            if (!sel) {
                if (this.floatingBtn)
                    this.floatingBtn.style.display = "none";
                this.activeSelectedText = "";
                return;
            }
            this.activeSelectedText = sel;
            const domSel = window.getSelection();
            if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
                const rect = domSel.getRangeAt(0).getBoundingClientRect();
                if (rect && rect.width > 0) {
                    const top = Math.max(12, rect.top - 38);
                    const left = Math.min(window.innerWidth - 90, Math.max(12, rect.left + rect.width / 2 - 38));
                    if (this.floatingBtn) {
                        this.floatingBtn.style.top = `${top}px`;
                        this.floatingBtn.style.left = `${left}px`;
                        this.floatingBtn.style.display = "inline-flex";
                    }
                    return;
                }
            }
            if (this.floatingBtn)
                this.floatingBtn.style.display = "none";
        };
        this.registerDomEvent(document, "mouseup", () => setTimeout(updateBtn, 60));
        this.registerDomEvent(document, "selectionchange", () => setTimeout(updateBtn, 80));
        this.floatingBtn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const activeView = this.app.workspace.getActiveViewOfType(obsidian_1.MarkdownView);
            if (activeView && activeView.editor && this.activeSelectedText) {
                const txt = this.activeSelectedText;
                if (this.floatingBtn)
                    this.floatingBtn.style.display = "none";
                new AddAnnotationModal(this.app, activeView.editor, txt).open();
            }
        });
    }
    onunload() {
        activePluginInstance = null;
        if (this.floatingBtn) {
            this.floatingBtn.remove();
            this.floatingBtn = null;
        }
    }
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
}
exports.default = CriticMarkupPlugin;

module.exports = CriticMarkupPlugin;
module.exports.default = CriticMarkupPlugin;
