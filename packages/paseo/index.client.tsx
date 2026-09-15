import type { PluginClientContext } from "@getpaseo/plugin/client";
import { annotateDocumentRpc, readDocumentAnnotationsRpc } from "./shared/rpc";
import { renderAnnotations } from "./client/markup-renderer";
import { captureDocumentContext, type DocumentContext } from "./client/document-context";
import { captureTextAnchor, captureMarkAnchor } from "./client/selection-anchor";

/**
 * Format selected text into a standard Markdown blockquote.
 * Empty lines within selection are formatted as ">" to prevent breaking the quote block.
 */
function formatMarkdownQuote(text: string): string {
  const normalized = text.trim().replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const quotedLines = lines.map((line) => (line.length > 0 ? `> ${line}` : ">"));
  return quotedLines.join("\n");
}

/**
 * Build structured quote prompt (aligned with Pi Web UI architecture)
 * Creates crystal clear logical hierarchy for the AI Agent:
 * 1. Intro context header ("关于这段内容：" / "针对这段内容：")
 * 2. Formatted Markdown blockquote (> ...)
 * 3. User instruction header ("我的问题是：" / "我的评论是：")
 * 4. Trailing newline where the user cursor lands to type comments immediately
 */
function buildQuotedSelection(text: string, mode: "ask" | "comment" = "ask"): string {
  const isZh =
    typeof navigator !== "undefined" &&
    (navigator.language || "").toLowerCase().startsWith("zh");

  let intro: string;
  let promptHeader: string;

  if (mode === "comment") {
    intro = isZh ? "针对这段内容：" : "Regarding this passage:";
    promptHeader = isZh ? "我的评论是：" : "My comment is:";
  } else {
    intro = isZh ? "关于这段内容：" : "Regarding this passage:";
    promptHeader = isZh ? "我的问题是：" : "My question is:";
  }

  const quote = formatMarkdownQuote(text);
  return `${intro}\n\n${quote}\n\n${promptHeader}\n`;
}

/**
 * Format selected text and comment into standard CriticMarkup syntax.
 * Syntax: {==selected text==}{>>comment/instruction<<}
 */
function formatCriticMarkupAnnotation(text: string, comment: string): string {
  const cleanText = text.trim();
  const cleanComment = comment.trim();
  return `{==${cleanText}==}{>>${cleanComment}<<}`;
}

/**
 * Build structured annotation prompt for AI Agent consumption.
 */
function buildStructuredAnnotationPrompt(text: string, comment: string): string {
  const isZh =
    typeof navigator !== "undefined" &&
    (navigator.language || "").toLowerCase().startsWith("zh");

  const intro = isZh ? "【文档修改批注】针对以下内容：" : "[Document Review] Regarding:";
  const instructionHeader = isZh ? "我的修改意见是：" : "My instruction:";
  const quote = formatMarkdownQuote(text);
  return `${intro}\n\n${quote}\n\n${instructionHeader}\n${comment.trim()}\n`;
}

/**
 * Check whether a node is inside an input, textarea or editable region
 */
function isInsideInputElement(node: Node | null): boolean {
  if (!node) return false;
  const el = node instanceof HTMLElement ? node : node.parentElement;
  if (!el) return false;
  return !!el.closest(
    'input, textarea, [data-testid="message-input-root"], [data-testid*="message-input"], [data-composer-input], #paseo-quote-selection-toolbar, #paseo-quote-annotation-popover, #paseo-critic-detail-modal'
  );
}

/**
 * Main plugin contribution
 */
export default function contribute(client: PluginClientContext) {
  // Safe environment check: supports Electron desktop and mobile PWA / WebKit
  const g = typeof globalThis !== "undefined" ? (globalThis as any) : {};
  const doc: Document | undefined = g.document;
  const win: (Window & typeof globalThis) | undefined = g.window;

  // On non-DOM runtimes (e.g. pure React Native Hermes on iOS/Android native app), gracefully no-op
  if (!doc || !win || typeof doc.addEventListener !== "function" || typeof doc.createElement !== "function") {
    return () => {};
  }

  let floatingToolbar: HTMLDivElement | null = null;
  let annotationPopover: HTMLDivElement | null = null;
  let activeToast: HTMLDivElement | null = null;
  let toastTimeout: any = null;
  let activeSelectedText = "";
  let activeSourceContainer: HTMLElement | null = null;
  let activeSavedRange: Range | null = null;
  let activeDocument: DocumentContext | null = null;
  let hideTimeout: any = null;
  let isInteractingWithButton = false;
  let isInteractingWithPopover = false;

  // Show a sleek micro-interaction toast notification
  function showToast(message: string, duration = 2400) {
    if (activeToast && doc!.body.contains(activeToast)) {
      activeToast.remove();
    }
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }

    const toast = doc!.createElement("div");
    toast.id = "paseo-quote-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "28px",
      left: "50%",
      transform: "translateX(-50%) translateY(12px)",
      zIndex: "1000001",
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 16px",
      borderRadius: "20px",
      backgroundColor: "rgba(18, 22, 29, 0.96)",
      color: "#ffffff",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
      fontSize: "13px",
      fontWeight: "500",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 0.18s ease, transform 0.18s ease",
      backdropFilter: "blur(16px)",
      webkitBackdropFilter: "blur(16px)",
    });
    toast.textContent = message;
    doc!.body.appendChild(toast);
    activeToast = toast;

    const raf = win!.requestAnimationFrame || ((cb: () => void) => setTimeout(cb, 16));
    raf(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });

    toastTimeout = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        if (activeToast === toast) {
          activeToast = null;
        }
      }, 200);
    }, duration);
  }

  // Remove synchronously: a delayed close must never remove a newly opened popover.
  function closeAnnotationPopover() {
    annotationPopover?.remove();
    annotationPopover = null;
    isInteractingWithPopover = false;
  }

  function createAnnotationMark(text: string, comment: string, context?: DocumentContext | null) {
    const mark = doc!.createElement("mark");
    mark.className = "paseo-critic-mark";
    mark.dataset.criticComment = comment;
    if (context) {
      mark.dataset.criticFile = context.filePath;
      mark.dataset.criticWorkspace = context.workspaceId;
    }
    mark.textContent = text;
    const badge = doc!.createElement("span");
    badge.className = "paseo-critic-badge";
    badge.appendChild(doc!.createTextNode("💬 "));
    const label = doc!.createElement("span");
    label.textContent = comment.length > 36 || comment.includes("\n") ? "查看批注" : comment;
    badge.appendChild(label);
    badge.title = "点击查看、修改或删除批注";
    badge.onclick = e => { e.stopPropagation(); openCommentDetailModal(mark, text, mark.dataset.criticComment || ""); };
    mark.appendChild(badge);
    return mark;
  }

  // Open inline annotation popover (for Markdown document review & CriticMarkup)
  function openAnnotationPopover(textToAnnotate: string, defaultComment = "") {
    // Keyboard/command actions may arrive before debounced selectionchange.
    const liveSelection = win!.getSelection();
    if (liveSelection && !liveSelection.isCollapsed && liveSelection.rangeCount) {
      if (isInsideInputElement(liveSelection.anchorNode) || liveSelection.toString().trim() !== textToAnnotate.trim()) return;
      activeSavedRange = liveSelection.getRangeAt(0).cloneRange();
      const node = activeSavedRange.startContainer;
      activeDocument = captureDocumentContext(node.nodeType === 1 ? node as HTMLElement : node.parentElement, win!.location.pathname);
    } else if (!activeSavedRange?.startContainer.isConnected || activeSavedRange.toString().trim() !== textToAnnotate.trim()) {
      showToast("选区已变化，请重新划选"); return;
    }
    closeAnnotationPopover();
    hideToolbar();

    const popover = doc!.createElement("div");
    popover.id = "paseo-quote-annotation-popover";
    Object.assign(popover.style, {
      position: "fixed",
      zIndex: "1000000",
      width: "360px",
      maxWidth: "calc(100vw - 32px)",
      borderRadius: "14px",
      backgroundColor: "rgba(22, 26, 34, 0.97)",
      color: "#ffffff",
      border: "1px solid rgba(255, 255, 255, 0.22)",
      boxShadow: "0 14px 40px rgba(0, 0, 0, 0.65), 0 2px 8px rgba(0, 0, 0, 0.3)",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: "14px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      opacity: "0",
      transform: "translateY(8px)",
      transition: "opacity 0.15s ease, transform 0.15s ease",
      backdropFilter: "blur(20px)",
      webkitBackdropFilter: "blur(20px)",
    });

    popover.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      isInteractingWithPopover = true;
    });

    // 1. Header
    const header = doc!.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });

    const title = doc!.createElement("div");
    Object.assign(title.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "#f3f4f6",
      display: "flex",
      alignItems: "center",
      gap: "6px",
    });
    title.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span>Markdown 就地批注 (CriticMarkup)</span>
    `;

    const closeBtn = doc!.createElement("button");
    closeBtn.type = "button";
    Object.assign(closeBtn.style, {
      border: "none",
      background: "transparent",
      color: "rgba(255, 255, 255, 0.5)",
      cursor: "pointer",
      padding: "4px",
      borderRadius: "4px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
    closeBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
    closeBtn.onclick = () => closeAnnotationPopover();
    header.appendChild(title);
    header.appendChild(closeBtn);

    // 2. Quote Preview
    const quoteBox = doc!.createElement("div");
    Object.assign(quoteBox.style, {
      fontSize: "12px",
      color: "rgba(255, 255, 255, 0.7)",
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderLeft: "3px solid #3b82f6",
      padding: "6px 8px",
      borderRadius: "4px",
      maxHeight: "56px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    const previewSnippet = textToAnnotate.length > 70 ? textToAnnotate.slice(0, 68) + "..." : textToAnnotate;
    quoteBox.textContent = `“${previewSnippet}”`;

    // 3. Comment Input Textarea
    const textarea = doc!.createElement("textarea");
    Object.assign(textarea.style, {
      width: "100%",
      minHeight: "72px",
      boxSizing: "border-box",
      padding: "8px 10px",
      borderRadius: "8px",
      backgroundColor: "rgba(0, 0, 0, 0.35)",
      border: "1px solid rgba(255, 255, 255, 0.18)",
      color: "#ffffff",
      fontSize: "13px",
      lineHeight: "1.45",
      fontFamily: "inherit",
      resize: "vertical",
      outline: "none",
    });
    textarea.placeholder = "输入你的修改批注 / 要求 (按 ⌘+Enter 提交)...";
    if (defaultComment) textarea.value = defaultComment;

    // 4. Action Buttons Footer
    const footer = doc!.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "4px",
    });

    const btnCancel = doc!.createElement("button");
    btnCancel.type = "button";
    Object.assign(btnCancel.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      border: "1px solid rgba(255, 255, 255, 0.14)",
      color: "#e5e7eb",
      fontSize: "12px",
      cursor: "pointer",
    });
    btnCancel.textContent = "取消 (Esc)";
    btnCancel.onclick = () => closeAnnotationPopover();

    // In-place annotation button (Save directly into document)
    const btnSubmit = doc!.createElement("button");
    btnSubmit.type = "button";
    Object.assign(btnSubmit.style, {
      height: "28px",
      padding: "0 14px",
      borderRadius: "6px",
      backgroundColor: "#eab308",
      border: "none",
      color: "#000000",
      fontSize: "12.5px",
      fontWeight: "700",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      boxShadow: "0 2px 8px rgba(234, 179, 8, 0.35)",
    });
    btnSubmit.textContent = "✍️ 保存批注 (⌘/Ctrl+Enter)";
    const targetDocument = activeDocument; // Freeze identity before focus/navigation changes.
    const savedRange = activeSavedRange?.cloneRange();
    const anchor = savedRange ? captureTextAnchor(savedRange, textToAnnotate) : undefined;
    let submitting = false;

    const handleSubmit = async () => {
      if (submitting) return;
      const comment = textarea.value.trim();
      if (!comment) { textarea.focus(); showToast("请先输入批注或修改要求"); return; }
      if (!targetDocument) { showToast("未能绑定当前文档，请关闭批注框后在文档内重新划选"); return; }
      submitting = true;
      btnSubmit.disabled = true;
      btnSubmit.textContent = "正在写入…";
      try {
        const result = await client.rpc(annotateDocumentRpc, {
          ...targetDocument, originalText: textToAnnotate, comment, anchor,
        });
        if (!result.success) throw new Error(result.error || "保存失败");
        // Only decorate a still-live, plain-text range after disk persistence succeeds.
        // Never execCommand into a managed editor or move React-owned child elements.
        if (savedRange?.startContainer.isConnected && savedRange.toString().trim() === textToAnnotate.trim()
          && savedRange.startContainer === savedRange.endContainer && savedRange.startContainer.nodeType === 3
          && !savedRange.startContainer.parentElement?.closest('[contenteditable="true"], .cm-editor, .monaco-editor')) {
          try {
            const mark = createAnnotationMark(textToAnnotate, comment, {
              ...targetDocument, filePath: result.fullPath || targetDocument.filePath,
            });
            savedRange.deleteContents();
            savedRange.insertNode(mark);
          } catch { /* The host may already have re-rendered the saved document. */ }
        }
        showToast(`✅ 已写入 ${result.savedPath}（原文已备份）`, 3500);
        if (annotationPopover === popover) closeAnnotationPopover();
        win!.getSelection()?.removeAllRanges();
      } catch (error) {
        showToast(`未保存：${error instanceof Error ? error.message : String(error)}`, 5500);
      } finally {
        submitting = false;
        btnSubmit.disabled = false;
        btnSubmit.textContent = "✍️ 保存批注 (⌘/Ctrl+Enter)";
      }
    };

    btnSubmit.onclick = handleSubmit;

    textarea.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAnnotationPopover();
        e.stopPropagation();
      } else if (e.key === "Enter" && !e.isComposing && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    });

    footer.appendChild(btnCancel);
    footer.appendChild(btnSubmit);

    popover.appendChild(header);
    popover.appendChild(quoteBox);
    popover.appendChild(textarea);
    popover.appendChild(footer);

    // Compute Popover Position (Near selection or centered)
    const selection = win!.getSelection();
    let top = 100;
    let left = 100;

    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const popWidth = 360;
      const popHeight = 250;
      const vHeight = win!.innerHeight;
      const vWidth = win!.innerWidth;

      top = rect.bottom + 10;
      if (top + popHeight > vHeight - 16) {
        top = Math.max(16, rect.top - popHeight - 10);
      }
      left = Math.max(16, Math.min(vWidth - popWidth - 16, rect.left + rect.width / 2 - popWidth / 2));
    } else {
      top = win!.innerHeight / 3;
      left = win!.innerWidth / 2 - 180;
    }

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;

    doc!.body.appendChild(popover);
    annotationPopover = popover;

    const raf = win!.requestAnimationFrame || ((cb: () => void) => setTimeout(cb, 16));
    raf(() => {
      popover.style.opacity = "1";
      popover.style.transform = "translateY(0)";
      textarea.focus();
    });
  }

  // Helper: Verify if an element and all its ancestor panels are actually visible and active
  // (Paseo retains inactive workspaces in DOM with display: none / pointer-events: none)
  function isElementVisibleAndActive(el: HTMLElement | null): boolean {
    if (!el) return false;

    // 1. Direct bounding box check
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // 2. offsetParent check (null for display: none unless fixed)
    if (el.offsetParent === null && el.style.position !== "fixed") return false;

    // 3. Computed style check
    try {
      const style = win!.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    } catch {}

    // 4. Ancestor check: Paseo wraps inactive workspace decks in RetainedPanel with display: none
    let cur: HTMLElement | null = el;
    while (cur && cur !== doc!.body) {
      if (cur.style && (cur.style.display === "none" || cur.style.pointerEvents === "none")) {
        return false;
      }
      try {
        const parentStyle = win!.getComputedStyle(cur);
        if (parentStyle.display === "none" || parentStyle.visibility === "hidden") {
          return false;
        }
      } catch {}
      cur = cur.parentElement;
    }

    return true;
  }

  // 1. Locate the active composer textarea strictly bound to the CURRENT workspace/session
  function findComposerTextarea(sourceContainer?: HTMLElement | null): HTMLTextAreaElement | null {
    const source = sourceContainer || activeSourceContainer;
    const selector = '[data-testid="message-input-root"] textarea, textarea[data-composer-input], textarea[data-composerinput], textarea[data-testid="message-input"]';
    const candidates = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLTextAreaElement>(selector)).filter(isElementVisibleAndActive);
    if (source) {
      const pane = source.closest('[data-testid^="workspace-pane-"]');
      const local = pane ? candidates(pane) : [];
      if (local.length) return local.length === 1 ? local[0] : null;
      const deck = source.closest('[data-testid^="workspace-deck-entry-"]');
      const inWorkspace = deck ? candidates(deck) : [];
      return inWorkspace.length === 1 ? inWorkspace[0] : null;
    }
    const visible = candidates(doc!);
    return visible.length === 1 ? visible[0] : null;
  }

  // 2. Inject formatted quote into composer
  function injectIntoComposer(formattedPrompt: string) {
    const textarea = findComposerTextarea();

    if (!textarea) {
      console.warn("[quote-selection] Active composer textarea not found in DOM");
      return;
    }

    const currentText = textarea.value || "";
    let nextValue: string;

    if (!currentText.trim()) {
      nextValue = formattedPrompt;
    } else {
      const trimmed = currentText.trimEnd();
      nextValue = `${trimmed}\n\n${formattedPrompt}`;
    }

    // 1. Reset React's internal value tracker
    const tracker = (textarea as any)._valueTracker;
    if (tracker) {
      tracker.setValue("");
    }

    // 2. Call native value setter to update DOM element
    const textareaProto = win!.HTMLTextAreaElement?.prototype || g.HTMLTextAreaElement?.prototype;
    const nativeSetter = textareaProto
      ? Object.getOwnPropertyDescriptor(textareaProto, "value")?.set
      : null;

    if (nativeSetter) {
      nativeSetter.call(textarea, nextValue);
    } else {
      textarea.value = nextValue;
    }

    // 3. Dispatch standard InputEvent & Event for React Native Web
    try {
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: nextValue }));
    } catch {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    // 4. Directly invoke React's internal props handlers if available
    try {
      const reactPropsKey = Object.keys(textarea).find((k) => k.startsWith("__reactProps$"));
      if (reactPropsKey) {
        const reactProps = (textarea as any)[reactPropsKey];
        if (reactProps) {
          if (typeof reactProps.onChangeText === "function") {
            reactProps.onChangeText(nextValue);
          }
          if (typeof reactProps.onChange === "function") {
            reactProps.onChange({
              target: textarea,
              currentTarget: textarea,
              bubbles: true,
              nativeEvent: { text: nextValue },
            });
          }
        }
      }
    } catch (err) {
      console.warn("[quote-selection] React internal prop invoke error:", err);
    }

    // 5. Focus and position caret at the end (directly on the question/comment line)
    textarea.focus();
    const endPos = textarea.value.length;
    try {
      textarea.setSelectionRange(endPos, endPos);
    } catch {}
    textarea.scrollTop = textarea.scrollHeight;
  }

  // 3. Execute quote action
  function executeQuote(customText?: string, mode: "ask" | "comment" = "ask") {
    const textToQuote =
      customText ||
      activeSelectedText ||
      floatingToolbar?.getAttribute("data-quote-text") ||
      win!.getSelection()?.toString()?.trim() ||
      "";

    if (!textToQuote) return;

    // Fallback: If activeSourceContainer was not captured yet, resolve from current selection anchor
    if (!activeSourceContainer) {
      const sel = win!.getSelection();
      const node = sel?.anchorNode;
      const el = node instanceof HTMLElement ? node : node?.parentElement;
      if (el) {
        activeSourceContainer =
          el.closest<HTMLElement>('[data-testid^="workspace-pane-"]') ||
          el.closest<HTMLElement>('[data-testid^="workspace-deck-entry-"]') ||
          el.closest<HTMLElement>('[data-testid*="workspace"]') ||
          el.closest<HTMLElement>('[data-testid*="pane"]') ||
          el;
      }
    }

    // Fallback in pure Markdown documents / non-chat panels: open annotation popover directly!
    const targetTextarea = findComposerTextarea();
    if (!targetTextarea) {
      openAnnotationPopover(
        textToQuote,
        mode === "comment" ? "优化此段内容：" : "针对此段提出问题："
      );
      hideToolbar();
      return;
    }

    const formattedPrompt = buildQuotedSelection(textToQuote, mode);
    injectIntoComposer(formattedPrompt);

    hideToolbar();

    try {
      win!.getSelection()?.removeAllRanges();
    } catch {}

    activeSelectedText = "";
    activeSourceContainer = null;
    isInteractingWithButton = false;
  }

  // 4. Hide floating toolbar
  function hideToolbar() {
    if (!floatingToolbar) return;
    floatingToolbar.style.opacity = "0";
    floatingToolbar.style.transform = "translateY(6px)";
    floatingToolbar.style.pointerEvents = "none";
    if (hideTimeout !== null) {
      clearTimeout(hideTimeout);
    }
    hideTimeout = setTimeout(() => {
      if (floatingToolbar) {
        floatingToolbar.style.display = "none";
      }
      hideTimeout = null;
    }, 150);
  }

  // 5. Create mobile & touch-friendly floating quote toolbar with dual actions + close
  function getOrCreateToolbar(): HTMLDivElement {
    if (floatingToolbar && doc!.body.contains(floatingToolbar)) {
      return floatingToolbar;
    }

    const toolbar = doc!.createElement("div");
    toolbar.id = "paseo-quote-selection-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "划词引用工具栏");

    Object.assign(toolbar.style, {
      position: "fixed",
      zIndex: "999999",
      display: "none",
      alignItems: "center",
      gap: "4px",
      minHeight: "38px",
      padding: "3px 6px",
      borderRadius: "20px",
      backgroundColor: "rgba(22, 26, 34, 0.96)",
      color: "#ffffff",
      border: "1px solid rgba(255, 255, 255, 0.22)",
      boxShadow: "0 8px 28px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3)",
      fontSize: "12.5px",
      fontWeight: "500",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      userSelect: "none",
      webkitUserSelect: "none",
      webkitTapHighlightColor: "transparent",
      webkitTouchCallout: "none",
      opacity: "0",
      transform: "translateY(6px)",
      transition: "opacity 0.15s ease, transform 0.15s ease",
      backdropFilter: "blur(16px)",
      webkitBackdropFilter: "blur(16px)",
      touchAction: "manipulation",
    });

    function createActionButton(
      id: string,
      label: string,
      iconSvg: string,
      mode: "ask" | "comment"
    ): HTMLButtonElement {
      const btn = doc!.createElement("button");
      btn.id = id;
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-label", label);

      Object.assign(btn.style, {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "5px",
        height: "30px",
        padding: "0 10px",
        borderRadius: "15px",
        backgroundColor: "transparent",
        color: "#ffffff",
        border: "none",
        cursor: "pointer",
        fontSize: "12.5px",
        fontWeight: "500",
        fontFamily: 'inherit',
        outline: "none",
        transition: "background-color 0.12s ease, transform 0.1s ease",
        touchAction: "manipulation",
        whiteSpace: "nowrap",
      });

      btn.innerHTML = `
        ${iconSvg}
        <span style="pointer-events: none;">${label}</span>
      `;

      btn.onmouseenter = () => {
        btn.style.backgroundColor = "rgba(255, 255, 255, 0.12)";
      };
      btn.onmouseleave = () => {
        btn.style.backgroundColor = "transparent";
      };

      let touchMoved = false;
      let touchStartX = 0;
      let touchStartY = 0;
      let lastTriggerTime = 0;

      const trigger = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();

        const now = Date.now();
        if (now - lastTriggerTime < 500) return;
        lastTriggerTime = now;

        const text =
          activeSelectedText ||
          toolbar.getAttribute("data-quote-text") ||
          win!.getSelection()?.toString()?.trim() ||
          "";

        if (text) {
          executeQuote(text, mode);
        }
      };

      btn.addEventListener(
        "touchstart",
        (e: TouchEvent) => {
          isInteractingWithButton = true;
          touchMoved = false;
          if (e.touches && e.touches[0]) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
          }
          btn.style.transform = "scale(0.95)";
          btn.style.backgroundColor = "rgba(255, 255, 255, 0.18)";
          e.stopPropagation();
        },
        { passive: false }
      );

      btn.addEventListener(
        "touchmove",
        (e: TouchEvent) => {
          if (e.touches && e.touches[0]) {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 10 || dy > 10) {
              touchMoved = true;
            }
          }
        },
        { passive: true }
      );

      btn.addEventListener(
        "touchend",
        (e: TouchEvent) => {
          btn.style.transform = "scale(1)";
          btn.style.backgroundColor = "transparent";
          if (!touchMoved) {
            trigger(e);
          }
          setTimeout(() => {
            isInteractingWithButton = false;
          }, 300);
        },
        { passive: false }
      );

      btn.addEventListener("mousedown", (e: MouseEvent) => {
        isInteractingWithButton = true;
        e.preventDefault();
        e.stopPropagation();
      });

      btn.addEventListener("click", (e: MouseEvent) => {
        trigger(e);
        setTimeout(() => {
          isInteractingWithButton = false;
        }, 300);
      });

      return btn;
    }

    function createDivider(): HTMLDivElement {
      const divider = doc!.createElement("div");
      Object.assign(divider.style, {
        width: "1px",
        height: "15px",
        backgroundColor: "rgba(255, 255, 255, 0.16)",
        margin: "0 1px",
        flexShrink: "0",
      });
      return divider;
    }

    const isZh =
      typeof navigator !== "undefined" &&
      (navigator.language || "").toLowerCase().startsWith("zh");

    // 1. Ask button (Quote & Ask / 引用提问)
    const askIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; pointer-events:none;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="7" x2="12" y2="13"/></svg>`;
    const btnAsk = createActionButton(
      "paseo-quote-ask-btn",
      isZh ? "引用提问" : "Quote & Ask",
      askIcon,
      "ask"
    );

    // 2. Comment button (Quote & Comment / 引用评论)
    const commentIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; pointer-events:none;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    const btnComment = createActionButton(
      "paseo-quote-comment-btn",
      isZh ? "引用评论" : "Quote & Comment",
      commentIcon,
      "comment"
    );

    // 3. Dismiss / Close button
    const btnClose = doc!.createElement("button");
    btnClose.id = "paseo-quote-close-btn";
    btnClose.setAttribute("type", "button");
    btnClose.setAttribute("aria-label", "关闭工具栏");
    Object.assign(btnClose.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "24px",
      height: "24px",
      borderRadius: "12px",
      backgroundColor: "transparent",
      color: "rgba(255, 255, 255, 0.5)",
      border: "none",
      cursor: "pointer",
      outline: "none",
      padding: "0",
      transition: "background-color 0.12s ease, color 0.12s ease",
      touchAction: "manipulation",
      flexShrink: "0",
    });
    btnClose.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    btnClose.onmouseenter = () => {
      btnClose.style.backgroundColor = "rgba(255, 255, 255, 0.12)";
      btnClose.style.color = "#ffffff";
    };
    btnClose.onmouseleave = () => {
      btnClose.style.backgroundColor = "transparent";
      btnClose.style.color = "rgba(255, 255, 255, 0.5)";
    };
    const handleClose = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      hideToolbar();
      try {
        win!.getSelection()?.removeAllRanges();
      } catch {}
      activeSelectedText = "";
      activeSourceContainer = null;
      isInteractingWithButton = false;
    };
    btnClose.addEventListener("touchend", handleClose, { passive: false });
    btnClose.addEventListener("click", handleClose);
    btnClose.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // 3. Annotate button (CriticMarkup / 就地批注)
    const annotateIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; pointer-events:none;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    const btnAnnotate = doc!.createElement("button");
    btnAnnotate.id = "paseo-quote-annotate-btn";
    btnAnnotate.setAttribute("type", "button");
    btnAnnotate.setAttribute("aria-label", isZh ? "就地批注" : "Annotate");
    Object.assign(btnAnnotate.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "5px",
      height: "30px",
      padding: "0 10px",
      borderRadius: "15px",
      backgroundColor: "rgba(37, 99, 235, 0.28)",
      color: "#93c5fd",
      border: "1px solid rgba(147, 197, 253, 0.35)",
      cursor: "pointer",
      fontSize: "12.5px",
      fontWeight: "500",
      fontFamily: "inherit",
      outline: "none",
      transition: "all 0.12s ease",
      touchAction: "manipulation",
      whiteSpace: "nowrap",
    });
    btnAnnotate.innerHTML = `
      ${annotateIcon}
      <span style="pointer-events: none;">${isZh ? "批注" : "Annotate"}</span>
      <span style="pointer-events: none; opacity: 0.7; font-size: 10px; margin-left: 1px;">⌘⇧C</span>
    `;
    btnAnnotate.onmouseenter = () => {
      btnAnnotate.style.backgroundColor = "rgba(37, 99, 235, 0.45)";
      btnAnnotate.style.color = "#ffffff";
    };
    btnAnnotate.onmouseleave = () => {
      btnAnnotate.style.backgroundColor = "rgba(37, 99, 235, 0.28)";
      btnAnnotate.style.color = "#93c5fd";
    };
    const handleAnnotateClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const text =
        activeSelectedText ||
        toolbar.getAttribute("data-quote-text") ||
        win!.getSelection()?.toString()?.trim() ||
        "";
      if (text) {
        openAnnotationPopover(text);
      }
    };
    btnAnnotate.addEventListener("click", handleAnnotateClick);
    btnAnnotate.addEventListener("touchend", handleAnnotateClick, { passive: false });
    btnAnnotate.addEventListener("mousedown", (e) => {
      isInteractingWithButton = true;
      e.preventDefault();
      e.stopPropagation();
    });

    toolbar.appendChild(btnAsk);
    toolbar.appendChild(createDivider());
    toolbar.appendChild(btnComment);
    toolbar.appendChild(createDivider());
    toolbar.appendChild(btnAnnotate);
    toolbar.appendChild(createDivider());
    toolbar.appendChild(btnClose);

    doc!.body.appendChild(toolbar);
    floatingToolbar = toolbar;
    return toolbar;
  }

  // 6. Position toolbar (Adaptive Mobile Docking + Desktop Floating)
  function updateButtonPosition() {
    const selection = win!.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hideToolbar();
      return;
    }

    // Don't show if user is selecting inside composer or input fields
    if (isInsideInputElement(selection.anchorNode) || isInsideInputElement(selection.focusNode)) {
      hideToolbar();
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      hideToolbar();
      return;
    }

    activeSelectedText = text;
    const anchorNode = selection.anchorNode;
    const anchorEl = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;

    activeDocument = captureDocumentContext(anchorEl || null, win!.location.pathname);

    // Track the source element & container where the text was selected
    activeSourceContainer = anchorEl
      ? anchorEl.closest<HTMLElement>('[data-testid^="workspace-pane-"]') ||
        anchorEl.closest<HTMLElement>('[data-testid^="workspace-deck-entry-"]') ||
        anchorEl.closest<HTMLElement>('[data-testid*="workspace"]') ||
        anchorEl.closest<HTMLElement>('[data-testid*="pane"]') ||
        anchorEl
      : null;

    const range = selection.getRangeAt(0);
    try {
      activeSavedRange = range.cloneRange();
    } catch {}
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      hideToolbar();
      return;
    }

    const toolbar = getOrCreateToolbar();
    toolbar.setAttribute("data-quote-text", text);

    const barWidth = 220;
    const barHeight = 40;

    const viewport = win!.visualViewport;
    const vHeight = viewport ? viewport.height : win!.innerHeight;
    const vWidth = viewport ? viewport.width : win!.innerWidth;
    const vOffsetTop = viewport ? viewport.offsetTop : 0;
    const vOffsetLeft = viewport ? viewport.offsetLeft : 0;

    const isTouch =
      ("ontouchstart" in win! ||
        win!.navigator.maxTouchPoints > 0 ||
        (win!.navigator as any).msMaxTouchPoints > 0) &&
      (win!.innerWidth < 1024 || (viewport && viewport.width < 1024));

    if (isTouch) {
      // Locate the active visible composer
      const activeComposerTa = findComposerTextarea();
      const composerEl = activeComposerTa
        ? activeComposerTa.closest<HTMLElement>('[data-testid="message-input-root"]') || activeComposerTa
        : null;
      const composerRect = composerEl ? composerEl.getBoundingClientRect() : null;

      // Locate scroll-to-bottom button within the active container if available
      const activeContainer = composerEl?.closest<HTMLElement>('[data-testid^="workspace-deck-entry-"]') || doc!;
      const scrollBtn = activeContainer.querySelector('[data-testid="scroll-to-bottom-button"]');
      const scrollRect = scrollBtn ? scrollBtn.getBoundingClientRect() : null;

      let targetTop: number;

      if (scrollRect && scrollRect.height > 0 && scrollRect.top > 0) {
        // Sit above scroll-to-bottom button
        targetTop = scrollRect.top - barHeight - 10;
      } else if (composerRect && composerRect.top > 0) {
        // Sit above composer
        targetTop = composerRect.top - barHeight - 12;
      } else {
        // Fallback to bottom of visual viewport
        targetTop = vOffsetTop + vHeight - barHeight - 75;
      }

      // Keep strictly within visual viewport bounds
      targetTop = Math.max(vOffsetTop + 10, Math.min(vOffsetTop + vHeight - barHeight - 10, targetTop));

      // Horizontally centered on screen
      const centerLeft = vOffsetLeft + vWidth / 2 - barWidth / 2;
      const targetLeft = Math.max(vOffsetLeft + 10, Math.min(vOffsetLeft + vWidth - barWidth - 10, centerLeft));

      toolbar.style.top = `${Math.round(targetTop)}px`;
      toolbar.style.left = `${Math.round(targetLeft)}px`;
    } else {
      // Desktop Layout: Float right above selection near mouse pointer
      let targetTop = rect.top - barHeight - 8;

      // If too close to viewport top, flip below selection
      if (targetTop < vOffsetTop + 10) {
        targetTop = rect.bottom + 8;
      }

      // Center horizontally over selection
      let targetLeft = rect.left + rect.width / 2 - barWidth / 2;
      targetLeft = Math.max(vOffsetLeft + 10, Math.min(vOffsetLeft + vWidth - barWidth - 10, targetLeft));

      toolbar.style.top = `${Math.round(targetTop)}px`;
      toolbar.style.left = `${Math.round(targetLeft)}px`;
    }

    toolbar.style.display = "inline-flex";
    toolbar.style.pointerEvents = "auto";

    const raf = win!.requestAnimationFrame || ((cb: () => void) => setTimeout(cb, 16));
    raf(() => {
      if (floatingToolbar) {
        floatingToolbar.style.opacity = "1";
        floatingToolbar.style.transform = "translateY(0)";
      }
    });
  }

  // 7. Multi-input listeners (Pointer, Mouse, Touch, Selection)
  let selectionDebounce: any = null;

  function onSelectionChange() {
    if (isInteractingWithButton) {
      return;
    }
    if (selectionDebounce !== null) {
      clearTimeout(selectionDebounce);
    }
    selectionDebounce = setTimeout(() => {
      if (isInteractingWithButton) return;
      updateButtonPosition();
      selectionDebounce = null;
    }, 90);
  }

  function onPointerUp(e: Event) {
    if (floatingToolbar && floatingToolbar.contains(e.target as Node)) {
      return;
    }
    setTimeout(() => {
      if (!isInteractingWithButton) {
        updateButtonPosition();
      }
    }, 20);
  }

  function onPointerDown(e: Event) {
    if (floatingToolbar && floatingToolbar.contains(e.target as Node)) {
      isInteractingWithButton = true;
      return;
    }
    isInteractingWithButton = false;
    const selection = win!.getSelection();
    if (!selection || selection.isCollapsed) {
      hideToolbar();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      hideToolbar();
      closeAnnotationPopover();
      return;
    }

    const nav = win!.navigator || g.navigator;
    const isMac = nav?.platform ? nav.platform.toUpperCase().indexOf("MAC") >= 0 : true;
    const isModifier = isMac ? e.metaKey : e.ctrlKey;

    // Shortcut 1: ⌘+Shift+Q or Ctrl+Shift+Q (Quote)
    if (isModifier && e.shiftKey && (e.code === "KeyQ" || e.key === "Q" || e.key === "q")) {
      const selection = win!.getSelection();
      const text = selection?.toString()?.trim();
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        executeQuote(text, "ask");
      }
    }

    // Shortcut 2: ⌘+Shift+C or Ctrl+Shift+C (CriticMarkup Annotation Popover)
    if (isModifier && e.shiftKey && (e.code === "KeyC" || e.key === "C" || e.key === "c")) {
      const selection = win!.getSelection();
      const text = selection?.toString()?.trim();
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        openAnnotationPopover(text);
      }
    }
  }

  function onViewportChange() {
    if (isInteractingWithButton || isInteractingWithPopover) return;
    const selection = win!.getSelection();
    if (!selection || selection.isCollapsed) {
      hideToolbar();
    } else {
      updateButtonPosition();
    }
  }

  // Attach pointer & selection listeners
  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("pointerup", onPointerUp);
  doc.addEventListener("pointerdown", onPointerDown);
  doc.addEventListener("touchend", onPointerUp);
  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("scroll", onViewportChange, true);
  win.addEventListener("resize", onViewportChange);

  if (win.visualViewport) {
    win.visualViewport.addEventListener("resize", onViewportChange);
    win.visualViewport.addEventListener("scroll", onViewportChange);
  }

  // 8. Register Command Center Action - Quote
  const cleanupCommand = client.addCommandCenterItem({
    id: "quote-selection",
    title: "Quote Selected Text (引用选中文本提问)",
    icon: "Quote",
    context: "agent",
    keywords: ["quote", "selection", "reply", "引用", "提问", "划词"],
    onSelect: () => {
      const sel = win!.getSelection();
      const text = sel?.toString()?.trim();
      if (text) {
        executeQuote(text, "ask");
      }
    },
  });

  // 8.1 Register Command Center Action - Annotate
  const cleanupAnnotateCommand = client.addCommandCenterItem({
    id: "annotate-selection",
    title: "Annotate Selected Text (就地批注选中文本 CriticMarkup)",
    icon: "Edit3",
    context: "agent",
    keywords: ["annotate", "comment", "criticmarkup", "批注", "备注", "修改", "评审"],
    onSelect: () => {
      const sel = win!.getSelection();
      const text = sel?.toString()?.trim();
      if (text) {
        openAnnotationPopover(text);
      }
    },
  });

  // 9. Register Slash Command (/quote)
  const cleanupSlash = client.addSlashCommand({
    name: "quote",
    description: "Quote selected text into composer / 引用选中文本提问",
    argumentHint: "[comment]",
    context: "agent",
    onSubmit: ({ args }) => {
      const sel = win!.getSelection();
      const text = sel?.toString()?.trim();
      if (text) {
        const isZh =
          typeof navigator !== "undefined" &&
          (navigator.language || "").toLowerCase().startsWith("zh");
        const intro = isZh ? "关于这段内容：" : "Regarding this passage:";
        const promptHeader = isZh ? "我的问题是：" : "My question is:";
        const quote = formatMarkdownQuote(text);
        const nextPrompt = args
          ? `${intro}\n\n${quote}\n\n${promptHeader}\n${args}`
          : `${intro}\n\n${quote}\n\n${promptHeader}\n`;

        injectIntoComposer(nextPrompt);
      }
    },
  });

  // 10. Live WYSIWYG CriticMarkup Decorator for Paseo UI
  // Automatically transforms {==text==}{>>comment<<} in Paseo's markdown/chat views into continuous highlight + sticky badges
  const styleEl = doc!.createElement("style");
  styleEl.id = "paseo-criticmarkup-styles";
  styleEl.textContent = `
    .paseo-critic-mark {
      white-space: pre-wrap !important;
      background-color: rgba(234, 179, 8, 0.22) !important;
      border-bottom: 2px solid #eab308 !important;
      border-radius: 3px !important;
      padding: 1px 2px !important;
      color: inherit !important;
    }
    .paseo-critic-badge {
      display: inline-flex !important;
      align-items: center !important;
      gap: 3px !important;
      background: linear-gradient(135deg, #eab308, #ca8a04) !important;
      color: #18181b !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      line-height: 1.2 !important;
      padding: 1px 7px !important;
      border-radius: 12px !important;
      margin-left: 5px !important;
      vertical-align: 1px !important;
      cursor: pointer !important;
      user-select: none !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28) !important;
      transition: transform 0.1s ease !important;
    }
    .paseo-critic-badge:hover {
      transform: scale(1.05) !important;
    }
  `;
  doc!.head.appendChild(styleEl);

  let commentDetailModal: HTMLDivElement | null = null;
  let modalKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  function closeCommentDetailModal() {
    if (modalKeyHandler) win!.removeEventListener("keydown", modalKeyHandler, true);
    modalKeyHandler = null;
    // 1. Remove tracked modal
    if (commentDetailModal) {
      commentDetailModal.remove();
      commentDetailModal = null;
    }
    // 2. Safety cleanup for any stray modals
    if (doc) {
      doc.querySelectorAll("#paseo-critic-detail-modal").forEach((el) => el.remove());
    }
  }

  function openCommentDetailModal(markElement: HTMLElement, originalText: string, currentComment: string) {
    closeCommentDetailModal();

    const modal = doc!.createElement("div");
    modal.id = "paseo-critic-detail-modal";
    commentDetailModal = modal;
    Object.assign(modal.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0, 0, 0, 0.45)",
      backdropFilter: "blur(4px)",
      webkitBackdropFilter: "blur(4px)",
      zIndex: "1000005",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const card = doc!.createElement("div");
    Object.assign(card.style, {
      width: "400px",
      maxWidth: "90vw",
      backgroundColor: "rgba(24, 24, 28, 0.98)",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      borderRadius: "14px",
      boxShadow: "0 16px 40px rgba(0, 0, 0, 0.65)",
      padding: "16px",
      color: "#ffffff",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    });

    // 1. Header
    const header = doc!.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });
    header.innerHTML = `
      <div style="font-size: 13.5px; font-weight: 600; color: #f3f4f6; display: flex; align-items: center; gap: 6px;">
        <span>💬 审阅批注详情</span>
      </div>
    `;

    const closeBtn = doc!.createElement("button");
    closeBtn.innerHTML = "✕";
    Object.assign(closeBtn.style, {
      background: "transparent",
      border: "none",
      color: "#9ca3af",
      fontSize: "14px",
      cursor: "pointer",
      padding: "2px 6px",
    });
    closeBtn.onclick = closeCommentDetailModal;
    header.appendChild(closeBtn);

    // 2. Quote
    const quoteBox = doc!.createElement("div");
    Object.assign(quoteBox.style, {
      padding: "8px 12px",
      borderRadius: "8px",
      backgroundColor: "rgba(234, 179, 8, 0.12)",
      borderLeft: "3px solid #eab308",
      color: "#e5e7eb",
      fontSize: "12.5px",
      lineHeight: "1.45",
      maxHeight: "80px",
      overflowY: "auto",
    });
    quoteBox.textContent = `“${originalText}”`;

    // 3. Comment Content / Editor
    const commentInput = doc!.createElement("textarea");
    Object.assign(commentInput.style, {
      width: "100%",
      boxSizing: "border-box",
      height: "70px",
      padding: "8px 10px",
      borderRadius: "8px",
      backgroundColor: "rgba(0, 0, 0, 0.35)",
      border: "1px solid rgba(255, 255, 255, 0.18)",
      color: "#ffffff",
      fontSize: "13px",
      lineHeight: "1.45",
      fontFamily: "inherit",
      resize: "none",
      outline: "none",
    });
    commentInput.value = currentComment;
    const targetDocument = captureDocumentContext(markElement, win!.location.pathname);
    const anchor = captureMarkAnchor(markElement, originalText);
    let saving = false;

    async function mutate(action: "edit" | "delete") {
      if (saving) return;
      const newComment = commentInput.value.trim();
      if (action === "edit" && !newComment) { showToast("批注不能为空"); return; }
      if (!targetDocument) { showToast("未能绑定当前文档，请在文档中重新打开该批注"); return; }
      saving = true;
      btnDelete.disabled = btnSave.disabled = true;
      try {
        const result = await client.rpc(annotateDocumentRpc, {
          ...targetDocument, action, originalText, comment: currentComment, anchor,
          ...(action === "edit" ? { newComment } : {}),
        });
        if (!result.success) throw new Error(result.error || "保存失败");
        if (action === "delete") markElement.replaceWith(doc!.createTextNode(originalText));
        else {
          markElement.dataset.criticComment = newComment;
          markElement.dataset.criticFile = result.fullPath || targetDocument.filePath;
          markElement.dataset.criticWorkspace = targetDocument.workspaceId;
          const label = markElement.querySelector(".paseo-critic-badge span");
          if (label) label.textContent = newComment.length > 36 || newComment.includes("\n") ? "查看批注" : newComment;
        }
        if (commentDetailModal === modal) closeCommentDetailModal();
        showToast(`✅ ${action === "delete" ? "已删除批注" : "已修改批注"}并写入 ${result.savedPath}`);
      } catch (error) { showToast(`未保存：${error instanceof Error ? error.message : String(error)}`, 5500); }
      finally { saving = false; btnDelete.disabled = btnSave.disabled = false; }
    }

    // 4. Footer Actions
    const footer = doc!.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: "4px",
    });

    // Delete button (Red)
    const btnDelete = doc!.createElement("button");
    btnDelete.innerHTML = `<span>🗑️ 删除批注</span>`;
    Object.assign(btnDelete.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "rgba(239, 68, 68, 0.15)",
      border: "1px solid rgba(239, 68, 68, 0.4)",
      color: "#f87171",
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
    });

    btnDelete.onclick = () => { void mutate("delete"); };

    const rightBtns = doc!.createElement("div");
    Object.assign(rightBtns.style, { display: "flex", gap: "8px" });

    // Cancel
    const btnCancel = doc!.createElement("button");
    btnCancel.textContent = "取消";
    Object.assign(btnCancel.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "rgba(255, 255, 255, 0.08)",
      border: "none",
      color: "#d1d5db",
      fontSize: "12px",
      cursor: "pointer",
    });
    btnCancel.onclick = closeCommentDetailModal;

    // Save Edit
    const btnSave = doc!.createElement("button");
    btnSave.textContent = "保存修改";
    Object.assign(btnSave.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "#eab308",
      border: "none",
      color: "#18181b",
      fontSize: "12px",
      fontWeight: "700",
      cursor: "pointer",
    });

    btnSave.onclick = () => { void mutate("edit"); };

    rightBtns.appendChild(btnCancel);
    rightBtns.appendChild(btnSave);

    footer.appendChild(btnDelete);
    footer.appendChild(rightBtns);

    card.appendChild(header);
    card.appendChild(quoteBox);
    card.appendChild(commentInput);
    card.appendChild(footer);
    modal.appendChild(card);
    doc!.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCommentDetailModal();
    });
    modal.addEventListener("pointerdown", (e) => {
      if (e.target === modal) closeCommentDetailModal();
    });

    const onModalKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeCommentDetailModal();
        win!.removeEventListener("keydown", onModalKey, true);
      }
    };
    modalKeyHandler = onModalKey;
    win!.addEventListener("keydown", onModalKey, true);
  }

  const decorating = new WeakSet<Element>();
  let decoratorDisposed = false;
  function decoratePaseoCriticMarkup() {
    doc!.querySelectorAll<HTMLElement>('[data-testid="workspace-file-pane"]').forEach(container => {
      if (decorating.has(container) || !container.textContent?.includes("{==")) return;
      const context = captureDocumentContext(container, win!.location.pathname);
      if (!context) return;
      decorating.add(container);
      void client.rpc(readDocumentAnnotationsRpc, context).then(result => {
        if (decoratorDisposed || !container.isConnected) return;
        const current = captureDocumentContext(container, win!.location.pathname);
        if (current?.filePath !== context.filePath || current?.workspaceId !== context.workspaceId) return;
        renderAnnotations(container, result.annotations, item => createAnnotationMark(item.originalText, item.comment, context));
      }).catch(error => console.warn("[CriticFlow] 批注渲染未完成", error))
        .finally(() => decorating.delete(container));
    });
  }

  const liveDecoratorInterval = setInterval(decoratePaseoCriticMarkup, 1500);
  decoratePaseoCriticMarkup();

  // 11. Teardown / Cleanup
  return () => {
    decoratorDisposed = true;
    clearInterval(liveDecoratorInterval);
    if (toastTimeout) clearTimeout(toastTimeout);
    closeCommentDetailModal();
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);

    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("pointerup", onPointerUp);
    doc.removeEventListener("pointerdown", onPointerDown);
    doc.removeEventListener("touchend", onPointerUp);
    win.removeEventListener("keydown", onKeyDown, true);
    win.removeEventListener("scroll", onViewportChange, true);
    win.removeEventListener("resize", onViewportChange);

    if (win.visualViewport) {
      win.visualViewport.removeEventListener("resize", onViewportChange);
      win.visualViewport.removeEventListener("scroll", onViewportChange);
    }

    if (selectionDebounce !== null) {
      clearTimeout(selectionDebounce);
    }
    if (hideTimeout !== null) {
      clearTimeout(hideTimeout);
    }

    if (floatingToolbar && floatingToolbar.parentNode) {
      floatingToolbar.parentNode.removeChild(floatingToolbar);
      floatingToolbar = null;
    }

    closeAnnotationPopover();

    if (activeToast && activeToast.parentNode) {
      activeToast.parentNode.removeChild(activeToast);
      activeToast = null;
    }

    cleanupCommand();
    cleanupAnnotateCommand();
    cleanupSlash();
  };
}
