import {
  App,
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import {
  EditorView,
  Decoration,
  WidgetType,
} from "@codemirror/view";
import { Extension, StateField } from "@codemirror/state";
import { captureAddition, hasMarkers, markupPattern, replaceTarget, resolveActiveContext, targetForWidget, type Target } from "./document-target";
import { renderReadingAnnotations } from "./reading-renderer";

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

let activePluginInstance: CriticMarkupPlugin | null = null;
let lastActionTimestamp = 0;

function isMobileDevice(): boolean {
  return (
    window.innerWidth <= 768 ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

// Anti-ghost-click runner for mobile touch
function safeRunAction(action: () => void) {
  const now = Date.now();
  if (now - lastActionTimestamp < 350) {
    return;
  }
  lastActionTimestamp = now;
  action();
}

function closeAllCriticModals() {
  const modals = document.querySelectorAll(".criticflow-modal-overlay");
  modals.forEach((el) => el.remove());
}

/**
 * 1. 新建划词批注弹窗
 */
function openAddAnnotationModal(
  app: App,
  selectedText: string,
  target: Target
) {
  closeAllCriticModals();

  const overlay = document.createElement("div");
  overlay.className = "criticflow-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background-color: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 99999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  `;

  const modal = document.createElement("div");
  modal.className = "criticflow-modal-card";
  modal.style.cssText = `
    width: 100%;
    max-width: 440px;
    background-color: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 14px;
    box-shadow: 0 24px 50px rgba(0, 0, 0, 0.8);
    padding: 20px;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  // Title
  const title = document.createElement("div");
  title.style.cssText = "font-size: 16px; font-weight: 700; color: #f4f4f5; display: flex; align-items: center; gap: 6px;";
  title.innerHTML = `<span>✍️</span><span>添加划词批注</span>`;
  modal.appendChild(title);

  // Quote preview
  const quoteBox = document.createElement("div");
  quoteBox.style.cssText = `
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(234, 179, 8, 0.18);
    border-left: 3px solid #eab308;
    color: #fef08a;
    font-size: 13px;
    line-height: 1.4;
    word-break: break-word;
    max-height: 80px;
    overflow-y: auto;
  `;
  quoteBox.textContent = `“${selectedText}”`;
  modal.appendChild(quoteBox);

  // Textarea
  const textarea = document.createElement("textarea");
  textarea.placeholder = "输入修改建议或批注内容 (按 ⌘+Enter 插入)...";
  textarea.style.cssText = `
    width: 100%;
    height: 85px;
    padding: 10px;
    border-radius: 8px;
    background: #27272a;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #ffffff;
    font-size: 14px;
    line-height: 1.4;
    box-sizing: border-box;
    resize: none;
    outline: none;
  `;
  modal.appendChild(textarea);

  // Buttons
  const footer = document.createElement("div");
  footer.style.cssText = "display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText = `
    padding: 8px 14px;
    border-radius: 8px;
    background: #3f3f46;
    border: none;
    color: #e4e4e7;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  `;
  cancelBtn.onclick = () => {
    overlay.remove();
    activePluginInstance?.resetSelectionState();
  };

  const submitBtn = document.createElement("button");
  submitBtn.textContent = "✍️ 插入批注";
  submitBtn.style.cssText = `
    padding: 8px 18px;
    border-radius: 8px;
    background: linear-gradient(135deg, #eab308, #ca8a04);
    border: none;
    color: #18181b;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  `;

  let saving = false;
  const doSubmit = async () => {
    if (saving) return;
    const comment = textarea.value.trim();
    if (!comment) {
      new Notice("请输入批注内容");
      return;
    }

    if (hasMarkers(selectedText + comment)) { new Notice("不支持嵌套批注或 CriticMarkup 分隔符"); return; }
    saving = true; submitBtn.disabled = true;
    try {
      const result = await replaceTarget(app, target, selectedText, `{==${selectedText}==}{>>${comment}<<}`);
      new Notice(result === "file" ? "✅ 已保存到原文件" : "✅ 已写入原编辑器，由 Obsidian 自动保存");
      overlay.remove();
      activePluginInstance?.resetSelectionState();
    } catch (err) {
      new Notice("❌ 未保存：" + String(err));
    } finally { saving = false; submitBtn.disabled = false; }
  };

  submitBtn.onclick = () => safeRunAction(doSubmit);

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);
  modal.appendChild(footer);
  overlay.appendChild(modal);

  const openTime = Date.now();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && Date.now() - openTime > 400) {
      overlay.remove();
      activePluginInstance?.resetSelectionState();
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (!e.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void doSubmit();
    }
    if (e.key === "Escape") {
      overlay.remove();
      activePluginInstance?.resetSelectionState();
    }
  });

  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 80);
}

/**
 * 2. 查看/编辑/删除批注详情弹窗
 */
function openAnnotationManageModal(
  app: App,
  originalText: string,
  comment: string,
  target: Target
) {
  closeAllCriticModals();

  const overlay = document.createElement("div");
  overlay.className = "criticflow-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background-color: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 99999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  `;

  const modal = document.createElement("div");
  modal.className = "criticflow-modal-card";
  modal.style.cssText = `
    width: 100%;
    max-width: 440px;
    background-color: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 14px;
    box-shadow: 0 24px 50px rgba(0, 0, 0, 0.8);
    padding: 20px;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  // Title
  const title = document.createElement("div");
  title.style.cssText = "font-size: 16px; font-weight: 700; color: #f4f4f5; display: flex; align-items: center; gap: 6px;";
  title.innerHTML = `<span>💬</span><span>批注详情</span>`;
  modal.appendChild(title);

  // Quote preview
  const quoteBox = document.createElement("div");
  quoteBox.style.cssText = `
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(234, 179, 8, 0.18);
    border-left: 3px solid #eab308;
    color: #fef08a;
    font-size: 13px;
    line-height: 1.4;
    word-break: break-word;
    max-height: 80px;
    overflow-y: auto;
  `;
  quoteBox.textContent = `“${originalText}”`;
  modal.appendChild(quoteBox);

  // Textarea
  const textarea = document.createElement("textarea");
  textarea.value = comment;
  textarea.style.cssText = `
    width: 100%;
    height: 85px;
    padding: 10px;
    border-radius: 8px;
    background: #27272a;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #ffffff;
    font-size: 14px;
    line-height: 1.4;
    box-sizing: border-box;
    resize: none;
    outline: none;
  `;
  modal.appendChild(textarea);

  // Buttons
  const footer = document.createElement("div");
  footer.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-top: 4px; gap: 8px;";

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "🗑️ 删除此批注";
  deleteBtn.style.cssText = `
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #f87171;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  `;

  const rightGroup = document.createElement("div");
  rightGroup.style.cssText = "display: flex; gap: 8px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText = `
    padding: 8px 14px;
    border-radius: 8px;
    background: #3f3f46;
    border: none;
    color: #e4e4e7;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  `;
  cancelBtn.onclick = () => overlay.remove();

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "保存修改";
  saveBtn.style.cssText = `
    padding: 8px 16px;
    border-radius: 8px;
    background: linear-gradient(135deg, #eab308, #ca8a04);
    border: none;
    color: #18181b;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  `;

  let saving = false;
  const updateDoc = async (newCommentOrNull: string | null) => {
    if (saving) return;
    if (newCommentOrNull !== null && hasMarkers(newCommentOrNull)) { new Notice("批注内容不能含 CriticMarkup 分隔符"); return; }
    saving = true; saveBtn.disabled = deleteBtn.disabled = true;
    try {
      const expected = `{==${originalText}==}{>>${comment}<<}`;
      const replacement = newCommentOrNull === null ? originalText : `{==${originalText}==}{>>${newCommentOrNull.trim()}<<}`;
      const result = await replaceTarget(app, target, expected, replacement);
      overlay.remove();
      new Notice(result === "file" ? "✅ 已保存到原文件" : "✅ 已更新原编辑器，由 Obsidian 自动保存");
    } catch (err) { new Notice("❌ 未保存：" + String(err)); }
    finally { saving = false; saveBtn.disabled = deleteBtn.disabled = false; }
  };

  deleteBtn.onclick = () => safeRunAction(() => updateDoc(null));
  saveBtn.onclick = () => {
    const val = textarea.value.trim();
    if (!val) {
      new Notice("批注内容不能为空");
      return;
    }
    safeRunAction(() => updateDoc(val));
  };

  footer.appendChild(deleteBtn);
  rightGroup.appendChild(cancelBtn);
  rightGroup.appendChild(saveBtn);
  footer.appendChild(rightGroup);
  modal.appendChild(footer);
  overlay.appendChild(modal);

  const openTime = Date.now();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && Date.now() - openTime > 400) {
      overlay.remove();
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if (!e.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveBtn.click();
    }
    if (e.key === "Escape") {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 80);
}

// ==========================================
// 3. CodeMirror 6 Visual Widget (Live Preview)
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
    badge.innerHTML = `💬 <span>${escapeHtml(this.comment.length > 36 || this.comment.includes("\n") ? "查看批注" : this.comment)}</span>`;
    badge.title = `批注：${this.comment} (点击查看或删除)`;

    const handleOpen = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (activePluginInstance) {
        safeRunAction(() => {
          const app = activePluginInstance!.app;
          const target = targetForWidget(app, view, badge);
          if (!target) { new Notice("无法定位当前批注，未修改"); return; }
          openAnnotationManageModal(app, this.original, this.comment, target);
        });
      }
    };

    badge.addEventListener("click", handleOpen);
    badge.addEventListener("touchend", handleOpen);

    return badge;
  }

  ignoreEvent(e: Event): boolean {
    return e.type === "click" || e.type === "touchend" || e.type === "mousedown";
  }
}

// ==========================================
// 4. Main Plugin Class (v1.1.2)
// ==========================================
export default class CriticMarkupPlugin extends Plugin {
  settings: CriticMarkupSettings = DEFAULT_SETTINGS;
  private floatingBtn: HTMLElement | null = null;
  private activeSelectedText = "";
  private savedAddition: ReturnType<typeof captureAddition> = null;
  private updatePending = false;

  async onload() {
    activePluginInstance = this;
    await this.loadSettings();

    // 1. CM6 Extension for Live Preview
    this.registerEditorExtension(this.buildEditorExtension());

    // 2. Reading View PostProcessor
    this.registerReadingViewProcessor();

    // 3. Floating Toolbar (Desktop Floating + Mobile Bottom Dock)
    this.setupFloatingToolbar();

    // 4. Commands
    this.registerPluginCommands();
  }

  resetSelectionState() {
    this.activeSelectedText = "";
    this.savedAddition = null;
    if (this.floatingBtn) {
      this.floatingBtn.style.display = "none";
    }
  }

  private buildEditorExtension(): Extension {
    const decorate = (text: string) => {
      if (!this.settings.foldEnabled) return Decoration.none;
      const ranges = [];
      for (const match of text.matchAll(markupPattern())) {
        const from = match.index!, origEnd = from + 3 + match[1].length;
        ranges.push(Decoration.replace({}).range(from, from + 3));
        if (origEnd > from + 3) ranges.push(Decoration.mark({ class: "cm-critic-highlight" }).range(from + 3, origEnd));
        ranges.push(Decoration.replace({ widget: new CriticBadgeWidget(match[1], match[2]) }).range(origEnd, from + match[0].length));
      }
      return Decoration.set(ranges, true);
    };
    // Direct StateField decorations may span line breaks; viewport MatchDecorator cannot.
    return StateField.define({
      create: state => decorate(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged || transaction.reconfigured
        ? decorate(transaction.state.doc.toString()) : value,
      provide: field => EditorView.decorations.from(field),
    });
  }

  private registerReadingViewProcessor() {
    this.registerMarkdownPostProcessor(async (element, context) => {
      if (!this.settings.foldEnabled) return;
      const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
      if (!(file instanceof TFile)) return;
      try {
        const section = context.getSectionInfo(element);
        const snapshot = await this.app.vault.read(file);
        if (activePluginInstance !== this || !this.settings.foldEnabled) return;
        let bounds = null;
        if (section) {
          const lines = snapshot.split("\n");
          const offset = (line: number) => lines.slice(0, line).reduce((sum, s) => sum + s.length + 1, 0);
          bounds = { from: offset(section.lineStart), to: Math.min(snapshot.length, offset(section.lineEnd + 1)) };
        }
        renderReadingAnnotations(element, { file, path: file.path, snapshot }, bounds,
          (original, comment, target) => openAnnotationManageModal(this.app, original, comment, target));
      } catch (err) { console.warn("CriticFlow reading renderer:", err); }
    });
  }

  private setupFloatingToolbar() {
    this.floatingBtn = document.createElement("div");
    this.floatingBtn.id = "obsidian-floating-annotate-btn";
    this.floatingBtn.innerHTML = `<span style="color:#eab308;font-size:15px;">✍️</span><span>添加划词批注</span>`;
    document.body.appendChild(this.floatingBtn);

    const scheduleUpdate = () => {
      if (this.updatePending) return;
      this.updatePending = true;
      requestAnimationFrame(() => {
        this.updatePending = false;
        this.updateFloatingButton();
      });
    };

    this.registerDomEvent(document, "selectionchange", scheduleUpdate);
    this.registerDomEvent(document, "mouseup", () => setTimeout(scheduleUpdate, 60));
    this.registerDomEvent(document, "touchend", () => setTimeout(scheduleUpdate, 140));

    const triggerAnnotation = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();

      if (!this.activeSelectedText) {
        this.hideFloatingBtn();
        return;
      }

      const addition = captureAddition(this.app) || this.savedAddition;
      this.hideFloatingBtn();
      if (!addition) return;
      safeRunAction(() => openAddAnnotationModal(this.app, addition.text, addition.target));
    };

    this.floatingBtn.addEventListener("mousedown", triggerAnnotation);
    this.floatingBtn.addEventListener("touchend", triggerAnnotation);
  }

  private updateFloatingButton() {
    if (document.querySelector(".criticflow-modal-overlay")) return;
    this.savedAddition = captureAddition(this.app);
    const text = this.savedAddition?.text || "";
    const domSel = window.getSelection();

    if (!text || text.length === 0) {
      this.hideFloatingBtn();
      return;
    }

    this.activeSelectedText = text;

    if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
      const range = domSel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        const mobile = isMobileDevice();

        if (this.floatingBtn) {
          if (mobile) {
            // MOBILE: Dock strictly to BOTTOM of viewport (0% Overlap with iOS Copy/Share Callout Menu!)
            this.floatingBtn.classList.add("is-mobile-dock");
            this.floatingBtn.style.top = "";
            this.floatingBtn.style.left = "";
          } else {
            // DESKTOP: Traditional cursor-following floating pill
            this.floatingBtn.classList.remove("is-mobile-dock");
            let top = rect.top - 42;
            if (top < 12) top = rect.bottom + 10;
            let left = Math.max(12, Math.min(window.innerWidth - 95, rect.left + rect.width / 2 - 40));
            this.floatingBtn.style.top = `${top}px`;
            this.floatingBtn.style.left = `${left}px`;
          }
          this.floatingBtn.style.display = "inline-flex";
        }
        return;
      }
    }

    this.hideFloatingBtn();
  }

  private hideFloatingBtn() {
    if (this.floatingBtn) {
      this.floatingBtn.style.display = "none";
    }
  }

  private registerPluginCommands() {
    this.addCommand({
      id: "criticmarkup-add-annotation",
      name: "添加划词批注 (Add Annotation)",
      callback: () => {
        const addition = captureAddition(this.app);
        if (!addition) { new Notice("请先在目标文档划选要批注的文字"); return; }
        openAddAnnotationModal(this.app, addition.text, addition.target);
      },
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "c" }],
    });

    this.addCommand({
      id: "criticmarkup-extract-annotations",
      name: "一键提取全文档批注为 Agent 指令 (Extract for Agent)",
      callback: async () => {
        const ctx = resolveActiveContext(this.app);
        let content = "";
        if (ctx.editor) {
          content = ctx.editor.getValue();
        } else if (ctx.file) {
          content = await this.app.vault.read(ctx.file);
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
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "e" }],
    });

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
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "c" }],
    });
  }

  onunload() {
    activePluginInstance = null;
    closeAllCriticModals();
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
