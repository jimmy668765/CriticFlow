import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  Editor,
  MarkdownView,
  MarkdownPostProcessorContext,
  TFile,
} from "obsidian";
import {
  ViewPlugin,
  ViewUpdate,
  EditorView,
  MatchDecorator,
  Decoration,
  DecorationSet,
  WidgetType,
} from "@codemirror/view";
import { Extension } from "@codemirror/state";

interface CriticMarkupSettings {
  foldEnabled: boolean;
}

const DEFAULT_SETTINGS: CriticMarkupSettings = {
  foldEnabled: true,
};

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegExp(str: string): string {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Target definition for applying annotation changes
export type AnnotationTarget =
  | { type: "editor"; editor: Editor }
  | { type: "cm-view"; view: EditorView }
  | { type: "file"; file: TFile };

// Global reference to active plugin instance
let activePluginInstance: CriticMarkupPlugin | null = null;

// ==========================================
// 1. CodeMirror 6 Visual Widget (编辑视图)
// ==========================================
class CriticBadgeWidget extends WidgetType {
  constructor(public original: string, public comment: string) {
    super();
  }

  eq(other: CriticBadgeWidget): boolean {
    return this.original === other.original && this.comment === other.comment;
  }

  toDOM(view: EditorView): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "cm-critic-badge";
    badge.innerHTML = `💬 <span>${escapeHtml(this.comment)}</span>`;
    badge.title = `批注：${this.comment} (点击查看或删除)`;

    const handleOpen = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (activePluginInstance) {
        new AnnotationManageModal(
          activePluginInstance.app,
          { type: "cm-view", view },
          this.original,
          this.comment
        ).open();
      }
    };

    badge.addEventListener("click", handleOpen);
    badge.addEventListener("touchend", handleOpen);

    return badge;
  }

  ignoreEvent(e: Event): boolean {
    return e.type === "click" || e.type === "mousedown" || e.type === "touchend";
  }
}

// ==========================================
// 2. Add Annotation Modal (添加批注弹窗)
// ==========================================
class AddAnnotationModal extends Modal {
  private comment = "";

  constructor(
    app: App,
    private target: AnnotationTarget,
    private selectedText: string
  ) {
    super(app);
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
    quoteBox.style.cssText =
      "padding: 8px 12px; border-radius: 8px; background: rgba(234, 179, 8, 0.12); border-left: 3px solid #eab308; margin-bottom: 12px; font-size: 13px; word-break: break-word;";

    // Textarea
    const textarea = contentEl.createEl("textarea");
    textarea.placeholder = "输入修改意见 / 批注内容 (按 ⌘+Enter 插入)...";
    textarea.style.cssText =
      "width: 100%; height: 80px; padding: 8px; border-radius: 6px; box-sizing: border-box; resize: none; margin-bottom: 12px;";

    textarea.addEventListener("input", () => {
      this.comment = textarea.value;
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.submit();
      }
    });

    // Footer buttons
    const footer = contentEl.createEl("div");
    footer.style.cssText =
      "display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;";

    const cancelBtn = footer.createEl("button", { text: "取消 (Esc)" });
    cancelBtn.onclick = () => this.close();

    const submitBtn = footer.createEl("button", {
      text: "✍️ 插入批注 (⌘↵)",
      cls: "mod-cta",
    });
    submitBtn.onclick = () => this.submit();

    setTimeout(() => textarea.focus(), 60);
  }

  async submit() {
    const text = this.comment.trim();
    if (!text) {
      new Notice("请输入批注内容");
      return;
    }
    const cleanOrig = this.selectedText.trim();
    const critic = `{==${cleanOrig}==}{>>${text}<<}`;

    if (this.target.type === "editor") {
      this.target.editor.replaceSelection(critic);
      new Notice("✅ 已在文档中插入批注！");
    } else if (this.target.type === "file") {
      // Direct Vault file modification for Reading View
      try {
        const file = this.target.file;
        const oldContent = await this.app.vault.read(file);
        const safeOrig = escapeRegExp(cleanOrig);
        let pattern = new RegExp(safeOrig);

        if (!pattern.test(oldContent)) {
          // Fallback with whitespace flex
          const words = cleanOrig.split(/\s+/).map(escapeRegExp).join("\\s+");
          pattern = new RegExp(words);
        }

        if (pattern.test(oldContent)) {
          const newContent = oldContent.replace(pattern, critic);
          await this.app.vault.modify(file, newContent);
          new Notice("✅ 已在文件中插入批注并落盘！");
        } else {
          new Notice("⚠️ 未能在原文中定位选区，请尝试在编辑模式下添加");
        }
      } catch (err) {
        console.error("CriticFlow file modification failed:", err);
        new Notice("❌ 批注写入失败：" + String(err));
      }
    }

    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ==========================================
// 3. Annotation Manage Modal (查看/编辑/删除)
// ==========================================
class AnnotationManageModal extends Modal {
  constructor(
    app: App,
    private target: AnnotationTarget,
    private originalText: string,
    private comment: string
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "💬 批注详情" });

    // Quote preview
    const quoteBox = contentEl.createEl("div", {
      text: `“${this.originalText}”`,
    });
    quoteBox.style.cssText =
      "padding: 8px 12px; border-radius: 8px; background: rgba(234, 179, 8, 0.12); border-left: 3px solid #eab308; margin-bottom: 12px; font-size: 13px; word-break: break-word;";

    // Editable comment textarea
    const textarea = contentEl.createEl("textarea");
    textarea.value = this.comment;
    textarea.style.cssText =
      "width: 100%; height: 80px; padding: 8px; border-radius: 6px; box-sizing: border-box; resize: none; margin-bottom: 12px;";

    // Footer
    const footer = contentEl.createEl("div");
    footer.style.cssText =
      "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;";

    const deleteBtn = footer.createEl("button", {
      text: "🗑️ 删除此批注",
      cls: "mod-warning",
    });
    deleteBtn.onclick = async () => {
      await this.updateInDoc(null);
      this.close();
      new Notice("✅ 已删除批注并还原原文！");
    };

    const rightGroup = footer.createEl("div");
    rightGroup.style.cssText = "display: flex; gap: 8px;";

    const cancelBtn = rightGroup.createEl("button", { text: "取消 (Esc)" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = rightGroup.createEl("button", {
      text: "保存修改 (⌘↵)",
      cls: "mod-cta",
    });
    saveBtn.onclick = async () => {
      const newComment = textarea.value.trim();
      if (!newComment) {
        new Notice("批注内容不能为空");
        return;
      }
      await this.updateInDoc(newComment);
      this.close();
      new Notice("✅ 批注已修改并保存！");
    };

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveBtn.click();
      }
    });

    setTimeout(() => textarea.focus(), 60);
  }

  private async updateInDoc(newCommentOrNull: string | null) {
    const cleanOrig = this.originalText.trim();
    const cleanComm = this.comment.trim();

    if (this.target.type === "cm-view") {
      const view = this.target.view;
      const fullDoc = view.state.doc.toString();
      const safeOrig = escapeRegExp(cleanOrig);
      const safeOldComm = escapeRegExp(cleanComm);

      let pattern = new RegExp(
        `\\{==\\s*${safeOrig}\\s*==\\}\\{>>\\s*${safeOldComm}\\s*<<\\}`,
        "g"
      );
      let match = pattern.exec(fullDoc);

      if (!match) {
        pattern = new RegExp(
          `\\{==\\s*${safeOrig}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`,
          "g"
        );
        match = pattern.exec(fullDoc);
      }

      if (!match) {
        const words = cleanOrig.split(/\s+/).map(escapeRegExp).join("\\s+");
        pattern = new RegExp(`\\{==\\s*${words}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
        match = pattern.exec(fullDoc);
      }

      if (match) {
        const from = match.index;
        const to = from + match[0].length;
        const replacement =
          newCommentOrNull === null
            ? cleanOrig
            : `{==${cleanOrig}==}{>>${newCommentOrNull.trim()}<<}`;

        view.dispatch({
          changes: { from, to, insert: replacement },
        });
      }
    } else if (this.target.type === "file") {
      try {
        const file = this.target.file;
        const fullDoc = await this.app.vault.read(file);
        const safeOrig = escapeRegExp(cleanOrig);
        const safeOldComm = escapeRegExp(cleanComm);

        let pattern = new RegExp(
          `\\{==\\s*${safeOrig}\\s*==\\}\\{>>\\s*${safeOldComm}\\s*<<\\}`
        );

        if (!pattern.test(fullDoc)) {
          pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`);
        }

        if (!pattern.test(fullDoc)) {
          const words = cleanOrig.split(/\s+/).map(escapeRegExp).join("\\s+");
          pattern = new RegExp(`\\{==\\s*${words}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`);
        }

        if (pattern.test(fullDoc)) {
          const replacement =
            newCommentOrNull === null
              ? cleanOrig
              : `{==${cleanOrig}==}{>>${newCommentOrNull.trim()}<<}`;
          const newDoc = fullDoc.replace(pattern, replacement);
          await this.app.vault.modify(file, newDoc);
        } else {
          new Notice("⚠️ 未能在文档中定位该批注位置");
        }
      } catch (err) {
        console.error("CriticFlow update file failed:", err);
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ==========================================
// 4. Main Plugin
// ==========================================
export default class CriticMarkupPlugin extends Plugin {
  settings: CriticMarkupSettings = DEFAULT_SETTINGS;
  private floatingBtn: HTMLElement | null = null;
  private activeSelectedText = "";

  async onload() {
    activePluginInstance = this;
    await this.loadSettings();

    // 1. Register CodeMirror 6 Visual Decorator for Editing View (Live Preview)
    this.registerEditorExtension(this.buildEditorExtension());

    // 2. Register Markdown Post Processor for Reading View (阅读视图)
    this.registerReadingViewProcessor();

    // 3. Setup Floating Toolbar (Desktop & Mobile Support)
    this.setupFloatingToolbar();

    // 4. Register Context Menu on Selection (Right Click / Mobile Selection Menu)
    this.registerContextMenu();

    // 5. Register Commands
    this.registerPluginCommands();
  }

  // --------------------------------------------------
  // A. Editing View (Live Preview) CodeMirror Decorator
  // --------------------------------------------------
  private buildEditorExtension(): Extension {
    const criticMatcher = new MatchDecorator({
      regexp: /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g,
      decorate: (add, from, to, match) => {
        if (!this.settings.foldEnabled) return;
        const orig = match[1];
        const comm = match[2];
        const origStart = from + 3;
        const origEnd = origStart + orig.length;

        // 1. Hide opening {==
        add(from, origStart, Decoration.replace({}));
        // 2. Continuous highlight on original text
        add(origStart, origEnd, Decoration.mark({ class: "cm-critic-highlight" }));
        // 3. Replace ==}{>>comment<<} with golden capsule badge widget
        add(
          origEnd,
          to,
          Decoration.replace({
            widget: new CriticBadgeWidget(orig, comm),
          })
        );
      },
    });

    return ViewPlugin.define(
      (view) => ({
        decorations: criticMatcher.createDeco(view),
        update(u: ViewUpdate) {
          this.decorations = activePluginInstance?.settings.foldEnabled
            ? criticMatcher.updateDeco(u, this.decorations)
            : Decoration.none;
        },
      }),
      {
        decorations: (v) => v.decorations,
      }
    );
  }

  // --------------------------------------------------
  // B. Reading View Markdown Post Processor (阅读视图渲染)
  // --------------------------------------------------
  private registerReadingViewProcessor() {
    this.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) => {
      if (!this.settings.foldEnabled) return;

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text);
      }

      const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;

      for (const textNode of textNodes) {
        const val = textNode.nodeValue;
        if (!val || !val.includes("{==")) continue;

        regex.lastIndex = 0;
        if (!regex.test(val)) continue;
        regex.lastIndex = 0;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(val)) !== null) {
          const matchStart = match.index;
          const matchEnd = match.index + match[0].length;
          const origText = match[1];
          const commentText = match[2];

          if (matchStart > lastIndex) {
            frag.appendChild(document.createTextNode(val.slice(lastIndex, matchStart)));
          }

          // Highlight text span
          const hlSpan = document.createElement("span");
          hlSpan.className = "cm-critic-highlight";
          hlSpan.textContent = origText;
          frag.appendChild(hlSpan);

          // Golden capsule badge span
          const badgeSpan = document.createElement("span");
          badgeSpan.className = "cm-critic-badge";
          badgeSpan.innerHTML = `💬 <span>${escapeHtml(commentText)}</span>`;
          badgeSpan.title = `批注：${commentText} (点击查看或删除)`;

          const handleBadgeClick = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            const targetFile = activeView?.file;
            if (targetFile) {
              new AnnotationManageModal(
                this.app,
                { type: "file", file: targetFile },
                origText,
                commentText
              ).open();
            }
          };

          badgeSpan.addEventListener("click", handleBadgeClick);
          badgeSpan.addEventListener("touchend", handleBadgeClick);
          frag.appendChild(badgeSpan);

          lastIndex = matchEnd;
        }

        if (lastIndex < val.length) {
          frag.appendChild(document.createTextNode(val.slice(lastIndex)));
        }

        textNode.replaceWith(frag);
      }
    });
  }

  // --------------------------------------------------
  // C. Floating Toolbar (Desktop Mouse & Mobile Touch)
  // --------------------------------------------------
  private setupFloatingToolbar() {
    this.floatingBtn = document.createElement("div");
    this.floatingBtn.id = "obsidian-floating-annotate-btn";
    this.floatingBtn.innerHTML = `<span style="color:#eab308;font-size:13px;">📝</span><span>批注</span>`;
    document.body.appendChild(this.floatingBtn);

    const updateBtn = () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView) {
        this.hideFloatingBtn();
        return;
      }

      // Check both editor selection and DOM selection
      let sel = "";
      if (activeView.getMode() === "source" && activeView.editor) {
        sel = activeView.editor.getSelection().trim();
      }

      const domSel = window.getSelection();
      if (!sel && domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
        sel = domSel.toString().trim();
      }

      if (!sel) {
        this.hideFloatingBtn();
        return;
      }

      this.activeSelectedText = sel;

      if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
        const range = domSel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0) {
          // Position above selection or adjust for viewport bounds
          let top = rect.top - 42;
          if (top < 12) top = rect.bottom + 10; // place below if clipped at top
          let left = rect.left + rect.width / 2 - 40;
          left = Math.max(12, Math.min(window.innerWidth - 95, left));

          if (this.floatingBtn) {
            this.floatingBtn.style.top = `${top}px`;
            this.floatingBtn.style.left = `${left}px`;
            this.floatingBtn.style.display = "inline-flex";
          }
          return;
        }
      }

      this.hideFloatingBtn();
    };

    // Desktop events
    this.registerDomEvent(document, "mouseup", () => setTimeout(updateBtn, 80));
    this.registerDomEvent(document, "selectionchange", () => setTimeout(updateBtn, 100));

    // Mobile touch events
    this.registerDomEvent(document, "touchend", () => setTimeout(updateBtn, 120));

    const triggerAnnotation = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();

      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView || !this.activeSelectedText) {
        this.hideFloatingBtn();
        return;
      }

      const txt = this.activeSelectedText;
      this.hideFloatingBtn();

      if (activeView.getMode() === "source" && activeView.editor) {
        new AddAnnotationModal(this.app, { type: "editor", editor: activeView.editor }, txt).open();
      } else if (activeView.file) {
        // Reading View
        new AddAnnotationModal(this.app, { type: "file", file: activeView.file }, txt).open();
      }
    };

    this.floatingBtn.addEventListener("mousedown", triggerAnnotation);
    this.floatingBtn.addEventListener("touchstart", triggerAnnotation);
  }

  private hideFloatingBtn() {
    if (this.floatingBtn) {
      this.floatingBtn.style.display = "none";
    }
    this.activeSelectedText = "";
  }

  // --------------------------------------------------
  // D. Context Menu Integration
  // --------------------------------------------------
  private registerContextMenu() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const sel = editor.getSelection().trim();
        if (sel) {
          menu.addItem((item) => {
            item
              .setTitle("📝 添加划词批注 (CriticFlow)")
              .setIcon("highlighter")
              .onClick(() => {
                new AddAnnotationModal(this.app, { type: "editor", editor }, sel).open();
              });
          });
        }
      })
    );
  }

  // --------------------------------------------------
  // E. Commands
  // --------------------------------------------------
  private registerPluginCommands() {
    // 1. Add Annotation
    this.addCommand({
      id: "criticmarkup-add-annotation",
      name: "添加划词批注 (Add Annotation)",
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
          new Notice("请先打开一篇 Markdown 笔记");
          return;
        }

        let selection = "";
        if (activeView.getMode() === "source" && activeView.editor) {
          selection = activeView.editor.getSelection().trim();
        }
        if (!selection) {
          const domSel = window.getSelection();
          if (domSel && !domSel.isCollapsed) {
            selection = domSel.toString().trim();
          }
        }

        if (!selection) {
          new Notice("请先划选要批注的一段文字");
          return;
        }

        if (activeView.getMode() === "source" && activeView.editor) {
          new AddAnnotationModal(this.app, { type: "editor", editor: activeView.editor }, selection).open();
        } else if (activeView.file) {
          new AddAnnotationModal(this.app, { type: "file", file: activeView.file }, selection).open();
        }
      },
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "c",
        },
      ],
    });

    // 2. Extract All Annotations for AI Agent (Dual Mode)
    this.addCommand({
      id: "criticmarkup-extract-annotations",
      name: "一键提取全文档批注为 Agent 指令 (Extract for Agent)",
      callback: async () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
          new Notice("请先打开一篇 Markdown 笔记");
          return;
        }

        let content = "";
        if (activeView.getMode() === "source" && activeView.editor) {
          content = activeView.editor.getValue();
        } else if (activeView.file) {
          content = await this.app.vault.read(activeView.file);
        }

        if (!content) {
          new Notice("当前文档为空");
          return;
        }

        const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}|\{>>([\s\S]*?)<<\}/g;
        const matches: Array<{ text: string; comment: string }> = [];
        let match;

        while ((match = regex.exec(content)) !== null) {
          if (match[1] && match[2]) {
            matches.push({ text: match[1].trim(), comment: match[2].trim() });
          } else if (match[3]) {
            matches.push({ text: "(上下文)", comment: match[3].trim() });
          }
        }

        if (matches.length === 0) {
          new Notice("ℹ️ 当前文档暂无批注");
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

        await navigator.clipboard.writeText(report);
        new Notice(`✅ 已将全部 ${matches.length} 条批注复制到剪贴板！可以直接发给 AI Agent。`);
      },
      hotkeys: [
        {
          modifiers: ["Mod", "Shift"],
          key: "e",
        },
      ],
    });

    // 3. Toggle View Mode
    this.addCommand({
      id: "criticmarkup-toggle-fold",
      name: "切换便签折叠视图 / 源码视图 (Toggle View)",
      callback: () => {
        this.settings.foldEnabled = !this.settings.foldEnabled;
        this.saveSettings();
        new Notice(
          this.settings.foldEnabled
            ? "👁️ 已开启便签折叠预览"
            : "📝 已切换至纯文本源码视图"
        );
        this.app.workspace.updateOptions();
      },
      hotkeys: [
        {
          modifiers: ["Alt", "Shift"],
          key: "c",
        },
      ],
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
