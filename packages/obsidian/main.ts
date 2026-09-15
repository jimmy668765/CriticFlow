import {
  App,
  Notice,
  Plugin,
  Editor,
  EditorPosition,
  MarkdownView,
  TFile,
} from "obsidian";
import {
  ViewPlugin,
  ViewUpdate,
  EditorView,
  MatchDecorator,
  Decoration,
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

let activePluginInstance: CriticMarkupPlugin | null = null;
let lastActionTimestamp = 0;

function isMobileDevice(): boolean {
  return (
    window.innerWidth <= 768 ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

// 4-tier context resolver across Desktop & Mobile
function resolveActiveContext(app: App) {
  let view = app.workspace.getActiveViewOfType(MarkdownView);

  if (!view && (app.workspace as any).activeLeaf?.view instanceof MarkdownView) {
    view = (app.workspace as any).activeLeaf.view as MarkdownView;
  }

  if (!view) {
    const leaves = app.workspace.getLeavesOfType("markdown");
    if (leaves && leaves.length > 0 && leaves[0].view instanceof MarkdownView) {
      view = leaves[0].view as MarkdownView;
    }
  }

  let file = view?.file || app.workspace.getActiveFile();
  if (!file) {
    const leaves = app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if ((leaf.view as any)?.file) {
        file = (leaf.view as any).file;
        break;
      }
    }
  }

  return { view, file, editor: view?.editor };
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
 * 1. 新建划词批注弹窗 (原生独立顶层 DOM，跨端 100% 弹出)
 */
function openAddAnnotationModal(
  app: App,
  selectedText: string,
  savedRange?: { from: EditorPosition; to: EditorPosition }
) {
  closeAllCriticModals();

  const overlay = document.createElement("div");
  overlay.className = "criticflow-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background-color: rgba(0, 0, 0, 0.7);
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
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.7);
    padding: 18px 20px;
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
    background: rgba(234, 179, 8, 0.15);
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
    padding: 8px 16px;
    border-radius: 8px;
    background: linear-gradient(135deg, #eab308, #ca8a04);
    border: none;
    color: #18181b;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  `;

  const doSubmit = async () => {
    const comment = textarea.value.trim();
    if (!comment) {
      new Notice("请输入批注内容");
      return;
    }

    const cleanOrig = selectedText.trim();
    const critic = `{==${cleanOrig}==}{>>${comment}<<}`;
    const ctx = resolveActiveContext(app);

    if (ctx.view && ctx.view.getMode() === "source" && ctx.editor) {
      const editor = ctx.editor;
      if (savedRange) {
        editor.replaceRange(critic, savedRange.from, savedRange.to);
      } else {
        const curSel = editor.getSelection().trim();
        if (curSel === cleanOrig) {
          editor.replaceSelection(critic);
        } else {
          const docVal = editor.getValue();
          const idx = docVal.indexOf(cleanOrig);
          if (idx !== -1) {
            editor.replaceRange(critic, editor.offsetToPos(idx), editor.offsetToPos(idx + cleanOrig.length));
          } else {
            editor.replaceSelection(critic);
          }
        }
      }
      new Notice("✅ 已插入划词批注！");
    } else if (ctx.file) {
      // Reading View file update
      try {
        const file = ctx.file;
        const oldContent = await app.vault.read(file);
        const safeOrig = escapeRegExp(cleanOrig);
        let pattern = new RegExp(safeOrig);

        if (!pattern.test(oldContent)) {
          const words = cleanOrig.split(/\s+/).map(escapeRegExp).join("\\s+");
          pattern = new RegExp(words);
        }

        if (pattern.test(oldContent)) {
          const newContent = oldContent.replace(pattern, critic);
          await app.vault.modify(file, newContent);
          new Notice("✅ 已在文件中插入批注！");

          // Force view refresh across mobile/desktop
          if (ctx.view) {
            if ((ctx.view as any).leaf?.rebuildView) {
              (ctx.view as any).leaf.rebuildView();
            } else if ((ctx.view as any).previewMode?.rerender) {
              (ctx.view as any).previewMode.rerender(true);
            }
          }
        } else {
          new Notice("⚠️ 未能在原文中定位选区");
        }
      } catch (err) {
        new Notice("❌ 批注写入失败：" + String(err));
      }
    }

    overlay.remove();
    activePluginInstance?.resetSelectionState();
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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doSubmit();
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
  editorView?: EditorView
) {
  closeAllCriticModals();

  const overlay = document.createElement("div");
  overlay.className = "criticflow-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background-color: rgba(0, 0, 0, 0.7);
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
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.7);
    padding: 18px 20px;
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
    background: rgba(234, 179, 8, 0.15);
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

  const updateDoc = async (newCommentOrNull: string | null) => {
    const cleanOrig = originalText.trim();
    const cleanComm = comment.trim();

    if (editorView) {
      const fullDoc = editorView.state.doc.toString();
      const safeOrig = escapeRegExp(cleanOrig);
      const safeOldComm = escapeRegExp(cleanComm);

      let pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>\\s*${safeOldComm}\\s*<<\\}`, "g");
      let match = pattern.exec(fullDoc);

      if (!match) {
        pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
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
        const replacement = newCommentOrNull === null ? cleanOrig : `{==${cleanOrig}==}{>>${newCommentOrNull.trim()}<<}`;
        editorView.dispatch({ changes: { from, to, insert: replacement } });
      }
    } else {
      const ctx = resolveActiveContext(app);
      if (ctx.file) {
        try {
          const file = ctx.file;
          const fullDoc = await app.vault.read(file);
          const safeOrig = escapeRegExp(cleanOrig);
          const safeOldComm = escapeRegExp(cleanComm);

          let pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>\\s*${safeOldComm}\\s*<<\\}`);
          if (!pattern.test(fullDoc)) {
            pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`);
          }
          if (!pattern.test(fullDoc)) {
            const words = cleanOrig.split(/\s+/).map(escapeRegExp).join("\\s+");
            pattern = new RegExp(`\\{==\\s*${words}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`);
          }

          if (pattern.test(fullDoc)) {
            const replacement = newCommentOrNull === null ? cleanOrig : `{==${cleanOrig}==}{>>${newCommentOrNull.trim()}<<}`;
            await app.vault.modify(file, fullDoc.replace(pattern, replacement));
            if (ctx.view) {
              if ((ctx.view as any).leaf?.rebuildView) {
                (ctx.view as any).leaf.rebuildView();
              } else if ((ctx.view as any).previewMode?.rerender) {
                (ctx.view as any).previewMode.rerender(true);
              }
            }
          }
        } catch (err) {
          console.error("CriticFlow update file error:", err);
        }
      }
    }

    overlay.remove();
    new Notice(newCommentOrNull === null ? "✅ 已删除批注并还原原文！" : "✅ 批注已修改并保存！");
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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
    badge.innerHTML = `💬 <span>${escapeHtml(this.comment)}</span>`;
    badge.title = `批注：${this.comment} (点击查看或删除)`;

    const handleOpen = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (activePluginInstance) {
        safeRunAction(() => {
          openAnnotationManageModal(
            activePluginInstance!.app,
            this.original,
            this.comment,
            view
          );
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
// 4. Main Plugin Class (v1.1.0)
// ==========================================
export default class CriticMarkupPlugin extends Plugin {
  settings: CriticMarkupSettings = DEFAULT_SETTINGS;
  private floatingBtn: HTMLElement | null = null;
  private activeSelectedText = "";
  private savedEditorRange: { from: EditorPosition; to: EditorPosition } | null = null;
  private updatePending = false;

  async onload() {
    activePluginInstance = this;
    await this.loadSettings();

    // 1. CM6 Extension for Live Preview
    this.registerEditorExtension(this.buildEditorExtension());

    // 2. Reading View PostProcessor
    this.registerReadingViewProcessor();

    // 3. Floating Toolbar (Dual positioning for Mobile/Desktop)
    this.setupFloatingToolbar();

    // 4. Commands
    this.registerPluginCommands();
  }

  resetSelectionState() {
    this.activeSelectedText = "";
    this.savedEditorRange = null;
    if (this.floatingBtn) {
      this.floatingBtn.style.display = "none";
    }
  }

  private buildEditorExtension(): Extension {
    const criticMatcher = new MatchDecorator({
      regexp: /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g,
      decorate: (add, from, to, match) => {
        if (!this.settings.foldEnabled) return;
        const orig = match[1];
        const comm = match[2];
        const origStart = from + 3;
        const origEnd = origStart + orig.length;

        add(from, origStart, Decoration.replace({}));
        add(origStart, origEnd, Decoration.mark({ class: "cm-critic-highlight" }));
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

  private registerReadingViewProcessor() {
    this.registerMarkdownPostProcessor((element: HTMLElement) => {
      if (!this.settings.foldEnabled) return;

      const blocks = element.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, div.markdown-preview-section");
      const targets: Element[] = blocks.length > 0 ? Array.from(blocks) : [element];

      for (const block of targets) {
        let html = block.innerHTML;
        if (!html.includes("{") || (!html.includes(">>") && !html.includes("&gt;&gt;"))) {
          continue;
        }

        const criticRegex =
          /\{(?:==|<mark[^>]*>)([\s\S]*?)(?:==|<\/mark>)\}\{(?:>>|&gt;&gt;)([\s\S]*?)(?:<<|&lt;&lt;)\}/g;

        if (criticRegex.test(html)) {
          criticRegex.lastIndex = 0;
          const newHtml = html.replace(criticRegex, (m, orig, comm) => {
            const cleanOrig = orig.replace(/<[^>]+>/g, "").trim();
            const cleanComm = comm.replace(/<[^>]+>/g, "").trim();
            return `<span class="cm-critic-highlight">${escapeHtml(
              cleanOrig
            )}</span><span class="cm-critic-badge" data-orig="${encodeURIComponent(
              cleanOrig
            )}" data-comm="${encodeURIComponent(
              cleanComm
            )}">💬 <span>${escapeHtml(cleanComm)}</span></span>`;
          });

          block.innerHTML = newHtml;

          const badges = block.querySelectorAll(".cm-critic-badge");
          badges.forEach((badge) => {
            const origText = decodeURIComponent(badge.getAttribute("data-orig") || "");
            const commText = decodeURIComponent(badge.getAttribute("data-comm") || "");

            const handleBadgeAction = (e: Event) => {
              e.stopPropagation();
              e.preventDefault();
              safeRunAction(() => {
                openAnnotationManageModal(this.app, origText, commText);
              });
            };

            badge.addEventListener("click", handleBadgeAction);
            badge.addEventListener("touchend", handleBadgeAction);
          });
        }
      }
    });
  }

  private setupFloatingToolbar() {
    this.floatingBtn = document.createElement("div");
    this.floatingBtn.id = "obsidian-floating-annotate-btn";
    this.floatingBtn.innerHTML = `<span style="color:#eab308;font-size:13px;">📝</span><span>批注</span>`;
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

      const txt = this.activeSelectedText;
      const savedRange = this.savedEditorRange;
      this.hideFloatingBtn();

      safeRunAction(() => {
        openAddAnnotationModal(this.app, txt, savedRange || undefined);
      });
    };

    this.floatingBtn.addEventListener("mousedown", triggerAnnotation);
    this.floatingBtn.addEventListener("touchend", triggerAnnotation);
  }

  private updateFloatingButton() {
    let text = "";
    this.savedEditorRange = null;

    const ctx = resolveActiveContext(this.app);
    if (ctx.editor) {
      text = ctx.editor.getSelection().trim();
      if (text) {
        this.savedEditorRange = {
          from: ctx.editor.getCursor("from"),
          to: ctx.editor.getCursor("to"),
        };
      }
    }

    const domSel = window.getSelection();
    if (!text && domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
      text = domSel.toString().trim();
    }

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
        let top = 0;
        let left = 0;

        if (mobile) {
          // MOBILE: Position strictly BELOW selection to avoid iPhone native Copy/Share menu overlap!
          top = rect.bottom + 14;
          // If near viewport bottom, dock to bottom toolbar position
          if (top + 45 > window.innerHeight) {
            top = window.innerHeight - 56;
          }
          left = Math.max(16, Math.min(window.innerWidth - 105, rect.left + rect.width / 2 - 40));
        } else {
          // DESKTOP: Position above selection
          top = rect.top - 42;
          if (top < 12) top = rect.bottom + 10;
          left = Math.max(12, Math.min(window.innerWidth - 95, rect.left + rect.width / 2 - 40));
        }

        if (this.floatingBtn) {
          this.floatingBtn.style.top = `${top}px`;
          this.floatingBtn.style.left = `${left}px`;
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
        let selection = "";
        let savedRange: { from: EditorPosition; to: EditorPosition } | undefined = undefined;

        const ctx = resolveActiveContext(this.app);
        if (ctx.editor) {
          selection = ctx.editor.getSelection().trim();
          if (selection) {
            savedRange = {
              from: ctx.editor.getCursor("from"),
              to: ctx.editor.getCursor("to"),
            };
          }
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

        openAddAnnotationModal(this.app, selection, savedRange);
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
