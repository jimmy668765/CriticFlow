/**
 * MarkEdit CriticMarkup Live Annotation & WYSIWYG Decorator
 * 
 * 专为 MarkEdit (macOS) 打造的批注与 Agent 反馈扩展脚本。
 * 
 * 功能特性：
 * 1. 鼠标拉选即浮现工具栏：鼠标划选文字后，选区上方自动浮现【📝 批注】小胶囊，点击直接批注；
 * 2. 所见即所得折叠：利用 CodeMirror 6 原生 MatchDecorator 与 WidgetType 将 {==选区==}{>>批注<<}
 *    折叠为金色荧光高亮正文 + 词尾胶囊便签 💬 批注内容；
 * 3. 便签点击卡片管理：点击任何已有批注气泡，弹出详情卡片，支持【🗑️ 删除批注】还原原文或【保存修改】更新批注；
 * 4. 快捷键支持：
 *    - ⌘ + Shift + C：划选文字后弹出批注卡片
 *    - ⌘ + Shift + E：一键提取全文档所有批注编译为 Agent 指令并复制到剪贴板
 *    - ⌥ + Shift + C：切换可视化便签折叠视图 / 源码视图
 *    - Esc：极速关闭任何弹窗，无残留
 */

(function () {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  let isFoldEnabled = true;

  // 1. Inject Styles
  const existingStyle = document.getElementById("markedit-criticmarkup-styles");
  if (existingStyle) existingStyle.remove();

  const styleEl = document.createElement("style");
  styleEl.id = "markedit-criticmarkup-styles";
  styleEl.textContent = `
    .cm-critic-highlight {
      background-color: rgba(234, 179, 8, 0.22) !important;
      border-bottom: 2px solid #eab308 !important;
      border-radius: 3px !important;
      padding: 1px 2px !important;
    }
    .cm-critic-badge {
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
      transition: transform 0.1s ease, filter 0.1s ease !important;
    }
    .cm-critic-badge:hover {
      transform: scale(1.08) !important;
      filter: brightness(1.1) !important;
    }
    #markedit-floating-annotate-btn {
      position: fixed;
      z-index: 999997;
      height: 30px;
      padding: 0 12px;
      border-radius: 16px;
      background-color: rgba(22, 26, 34, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
      display: none;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      transition: opacity 0.12s ease, transform 0.12s ease;
      user-select: none;
    }
    #markedit-floating-annotate-btn:hover {
      background-color: rgba(35, 40, 52, 0.98);
      border-color: #eab308;
      transform: scale(1.04);
    }
  `;
  document.head.appendChild(styleEl);

  // Helper functions
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

  function getEditorView() {
    return (window.MarkEdit && window.MarkEdit.editorView) ||
           (window.editor && window.editor.editorView) ||
           window.editorView ||
           window.editor;
  }

  // Toast notification
  function showToast(text, duration = 2400) {
    const existing = document.getElementById("markedit-critic-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "markedit-critic-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "999999",
      padding: "8px 16px",
      borderRadius: "10px",
      backgroundColor: "rgba(24, 24, 27, 0.95)",
      color: "#ffffff",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
      fontSize: "13px",
      fontWeight: "500",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      transition: "opacity 0.15s ease, transform 0.15s ease",
      opacity: "0",
      transform: "translateY(8px)",
      pointerEvents: "none",
    });
    toast.textContent = text;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 180);
    }, duration);
  }

  // 2. Mouse Selection Floating Toolbar (划词自动浮现)
  let floatingBtn = document.getElementById("markedit-floating-annotate-btn");
  if (!floatingBtn) {
    floatingBtn = document.createElement("div");
    floatingBtn.id = "markedit-floating-annotate-btn";
    floatingBtn.innerHTML = `<span style="color:#eab308;font-size:13px;">📝</span><span>批注</span>`;
    document.body.appendChild(floatingBtn);
  }

  let activeDragText = "";

  function updateFloatingButton() {
    const view = getEditorView();
    let text = "";
    let rect = null;

    if (view && view.state && view.state.selection) {
      const mainSel = view.state.selection.main;
      if (!mainSel.empty) {
        text = view.state.sliceDoc(mainSel.from, mainSel.to).trim();
        try {
          const domSel = window.getSelection();
          if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
            rect = domSel.getRangeAt(0).getBoundingClientRect();
          }
        } catch {}
      }
    }

    if (!text) {
      const domSel = window.getSelection();
      if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
        text = domSel.toString().trim();
        rect = domSel.getRangeAt(0).getBoundingClientRect();
      }
    }

    if ((!rect || (rect.width === 0 && rect.height === 0)) && view && view.state && view.state.selection) {
      try {
        const coords = view.coordsAtPos(view.state.selection.main.from);
        if (coords) {
          rect = { top: coords.top, left: coords.left, width: 40, height: 18 };
        }
      } catch {}
    }

    if (!text || !rect) {
      floatingBtn.style.display = "none";
      activeDragText = "";
      return;
    }

    activeDragText = text;
    const top = Math.max(12, rect.top - 38);
    const left = Math.min(window.innerWidth - 90, Math.max(12, rect.left + (rect.width || 40) / 2 - 38));

    floatingBtn.style.top = `${top}px`;
    floatingBtn.style.left = `${left}px`;
    floatingBtn.style.display = "inline-flex";
  }

  floatingBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeDragText) {
      const txt = activeDragText;
      floatingBtn.style.display = "none";
      showAnnotationDialog(txt);
    }
  });

  document.addEventListener("mouseup", () => {
    setTimeout(updateFloatingButton, 60);
  });

  document.addEventListener("selectionchange", () => {
    setTimeout(updateFloatingButton, 80);
  });

  // 3. Inline Annotation Dialog (新建批注弹窗)
  function showAnnotationDialog(selectedText) {
    floatingBtn.style.display = "none";
    const existing = document.getElementById("markedit-critic-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "markedit-critic-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0, 0, 0, 0.48)",
      backdropFilter: "blur(6px)",
      webkitBackdropFilter: "blur(6px)",
      zIndex: "999998",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "420px",
      maxWidth: "92vw",
      backgroundColor: "rgba(26, 26, 32, 0.98)",
      border: "1px solid rgba(255, 255, 255, 0.22)",
      boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
      borderRadius: "14px",
      padding: "16px",
      color: "#ffffff",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });

    const title = document.createElement("div");
    title.style.fontSize = "13.5px";
    title.style.fontWeight = "600";
    title.innerHTML = `✍️ 添加划词批注`;

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    Object.assign(closeBtn.style, {
      background: "transparent",
      border: "none",
      color: "#9ca3af",
      fontSize: "14px",
      cursor: "pointer",
    });

    const closeModal = () => {
      overlay.remove();
      window.removeEventListener("keydown", onGlobalKey, true);
    };

    closeBtn.onclick = closeModal;

    header.appendChild(title);
    header.appendChild(closeBtn);

    const quoteBox = document.createElement("div");
    Object.assign(quoteBox.style, {
      padding: "8px 12px",
      borderRadius: "8px",
      backgroundColor: "rgba(234, 179, 8, 0.12)",
      borderLeft: "3px solid #eab308",
      color: "#f3f4f6",
      fontSize: "12.5px",
      lineHeight: "1.45",
      maxHeight: "90px",
      overflowY: "auto",
      wordBreak: "break-word",
    });
    quoteBox.textContent = `“${selectedText}”`;

    const textarea = document.createElement("textarea");
    Object.assign(textarea.style, {
      width: "100%",
      boxSizing: "border-box",
      height: "75px",
      padding: "9px 12px",
      borderRadius: "8px",
      backgroundColor: "rgba(0, 0, 0, 0.4)",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      color: "#ffffff",
      fontSize: "13px",
      lineHeight: "1.45",
      fontFamily: "inherit",
      resize: "none",
      outline: "none",
    });
    textarea.placeholder = "输入你的修改意见 / 批注内容 (按 ⌘+Enter 插入)...";

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "4px",
    });

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "取消 (Esc)";
    Object.assign(btnCancel.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "rgba(255, 255, 255, 0.1)",
      border: "none",
      color: "#ffffff",
      fontSize: "12px",
      cursor: "pointer",
    });
    btnCancel.onclick = closeModal;

    const btnSubmit = document.createElement("button");
    btnSubmit.innerHTML = `<span>✍️ 插入批注 (⌘↵)</span>`;
    Object.assign(btnSubmit.style, {
      height: "28px",
      padding: "0 14px",
      borderRadius: "6px",
      backgroundColor: "#eab308",
      border: "none",
      color: "#18181b",
      fontSize: "12.5px",
      fontWeight: "700",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(234, 179, 8, 0.35)",
    });

    const doSubmit = () => {
      const comment = textarea.value.trim();
      if (!comment) {
        showToast("请输入批注内容");
        textarea.focus();
        return;
      }
      closeModal();
      applyCriticMarkup(selectedText, comment);
    };

    btnSubmit.onclick = doSubmit;

    const onGlobalKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeModal();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        doSubmit();
      }
    };
    window.addEventListener("keydown", onGlobalKey, true);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    footer.appendChild(btnCancel);
    footer.appendChild(btnSubmit);

    card.appendChild(header);
    card.appendChild(quoteBox);
    card.appendChild(textarea);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    textarea.focus();
  }

  // Replace selection via CodeMirror 6 EditorView dispatch
  function applyCriticMarkup(text, comment) {
    const critic = `{==${text.trim()}==}{>>${comment.trim()}<<}`;
    const view = getEditorView();

    if (view && view.state && view.state.selection) {
      try {
        const mainSel = view.state.selection.main;
        view.dispatch({
          changes: { from: mainSel.from, to: mainSel.to, insert: critic },
          selection: { anchor: mainSel.from + critic.length },
        });

        // Trigger auto save if supported
        if (window.MarkEdit && typeof window.MarkEdit.saveDocument === "function") {
          try { window.MarkEdit.saveDocument(); } catch {}
        }

        showToast("✅ 已在文档原地插入批注！按 ⌘S 保存文件");
        triggerLiveDecoration();
        return;
      } catch (err) {
        console.warn("[MarkEdit Extension] view.dispatch error:", err);
      }
    }

    // Fallback: document.execCommand
    let replaced = false;
    try {
      replaced = document.execCommand("insertText", false, critic);
    } catch {}

    if (replaced) {
      showToast("✅ 已在文档原地插入批注！按 ⌘S 保存文件");
      triggerLiveDecoration();
      return;
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(critic).then(() => {
        showToast("⚠️ 已存入剪贴板，请按 ⌘V 粘贴到选区");
      });
    }
  }

  // Helper to update or delete annotation in document
  function updateAnnotationInDoc(originalText, oldComment, newCommentOrNull) {
    const view = getEditorView();
    if (!view || !view.state) return false;

    const fullDoc = view.state.doc.toString();
    const safeOrig = escapeRegExp(originalText.trim());
    const safeOldComm = escapeRegExp(oldComment.trim());

    // 1. Try exact/whitespace-flexible pattern: {==\s*original\s*==}{>>\s*oldComment\s*<<}
    let pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>\\s*${safeOldComm}\\s*<<\\}`, "g");
    let match = pattern.exec(fullDoc);

    // 2. If not matched, try matching {==\s*original\s*==}{>>[\s\S]*?<<}
    if (!match) {
      pattern = new RegExp(`\\{==\\s*${safeOrig}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
      match = pattern.exec(fullDoc);
    }

    // 3. If still not matched, try looser matching where originalText might have whitespace differences
    if (!match) {
      const looseOrigWords = originalText.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
      pattern = new RegExp(`\\{==\\s*${looseOrigWords}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
      match = pattern.exec(fullDoc);
    }

    if (match) {
      const from = match.index;
      const to = from + match[0].length;
      const replacement = newCommentOrNull === null
        ? originalText.trim()
        : `{==${originalText.trim()}==}{>>${newCommentOrNull.trim()}<<}`;

      view.dispatch({
        changes: { from, to, insert: replacement }
      });

      // Trigger auto save if supported
      if (window.MarkEdit && typeof window.MarkEdit.saveDocument === "function") {
        try { window.MarkEdit.saveDocument(); } catch {}
      }

      return true;
    }
    return false;
  }

  // 4. Badge Click Modal (查看/编辑/删除已有批注)
  function showBadgeManagementModal(originalText, comment) {
    const existing = document.getElementById("markedit-critic-detail-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "markedit-critic-detail-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0, 0, 0, 0.48)",
      backdropFilter: "blur(6px)",
      webkitBackdropFilter: "blur(6px)",
      zIndex: "999999",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "420px",
      maxWidth: "92vw",
      backgroundColor: "rgba(24, 24, 28, 0.98)",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      borderRadius: "14px",
      boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
      padding: "16px",
      color: "#ffffff",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    });

    const closeModal = () => {
      overlay.remove();
      window.removeEventListener("keydown", onModalKey, true);
    };

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });
    header.innerHTML = `
      <span style="font-size:13.5px;font-weight:600;">💬 批注详情</span>
      <button id="markedit-close-detail" style="background:transparent;border:none;color:#9ca3af;font-size:14px;cursor:pointer;">✕</button>
    `;

    // Quote Box
    const quoteBox = document.createElement("div");
    Object.assign(quoteBox.style, {
      padding: "8px 12px",
      borderRadius: "8px",
      backgroundColor: "rgba(234,179,8,0.12)",
      borderLeft: "3px solid #eab308",
      fontSize: "12.5px",
      color: "#e5e7eb",
      lineHeight: "1.45",
      maxHeight: "80px",
      overflowY: "auto",
      wordBreak: "break-word",
    });
    quoteBox.textContent = `“${originalText}”`;

    // Comment Textarea for viewing and editing
    const textarea = document.createElement("textarea");
    Object.assign(textarea.style, {
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
    textarea.value = comment;

    // Footer actions
    const footer = document.createElement("div");
    Object.assign(footer.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: "4px",
    });

    const btnDelete = document.createElement("button");
    btnDelete.innerHTML = `<span>🗑️ 删除批注</span>`;
    Object.assign(btnDelete.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "rgba(239, 68, 68, 0.18)",
      border: "1px solid rgba(239, 68, 68, 0.4)",
      color: "#f87171",
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
    });

    const rightBtns = document.createElement("div");
    Object.assign(rightBtns.style, { display: "flex", gap: "8px" });

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "取消 (Esc)";
    Object.assign(btnCancel.style, {
      height: "28px",
      padding: "0 12px",
      borderRadius: "6px",
      backgroundColor: "rgba(255, 255, 255, 0.1)",
      border: "none",
      color: "#ffffff",
      fontSize: "12px",
      cursor: "pointer",
    });

    const btnSave = document.createElement("button");
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

    // Delete handler
    btnDelete.onclick = (e) => {
      e.stopPropagation();
      closeModal();
      const success = updateAnnotationInDoc(originalText, comment, null);
      if (success) {
        showToast("✅ 已删除批注并还原原文！按 ⌘S 保存文件");
        triggerLiveDecoration();
      } else {
        showToast("未定位到底层批注位置");
      }
    };

    // Save edit handler
    btnSave.onclick = (e) => {
      e.stopPropagation();
      const newComment = textarea.value.trim();
      if (!newComment) {
        showToast("批注内容不能为空");
        textarea.focus();
        return;
      }
      closeModal();
      const success = updateAnnotationInDoc(originalText, comment, newComment);
      if (success) {
        showToast("✅ 批注已修改！按 ⌘S 保存文件");
        triggerLiveDecoration();
      } else {
        showToast("未定位到底层批注位置");
      }
    };

    btnCancel.onclick = (e) => {
      e.stopPropagation();
      closeModal();
    };

    header.querySelector("#markedit-close-detail").onclick = (e) => {
      e.stopPropagation();
      closeModal();
    };

    const onModalKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeModal();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.stopPropagation();
        btnSave.click();
      }
    };
    window.addEventListener("keydown", onModalKey, true);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    rightBtns.appendChild(btnCancel);
    rightBtns.appendChild(btnSave);
    footer.appendChild(btnDelete);
    footer.appendChild(rightBtns);

    card.appendChild(header);
    card.appendChild(quoteBox);
    card.appendChild(textarea);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    textarea.focus();
  }

  // 5. CodeMirror 6 Native Decoration Registration (原生高保真渲染)
  function initNativeCodeMirrorExtension() {
    if (window.__markeditCriticExtensionRegistered) return;

    const cmView = (window.MarkEdit && window.MarkEdit.codemirror && window.MarkEdit.codemirror.view) ||
                   (window.editor && window.editor.codemirror && window.editor.codemirror.view) ||
                   (window.require && window.require("@codemirror/view"));

    if (!cmView || !cmView.MatchDecorator || !cmView.ViewPlugin || !cmView.WidgetType) {
      return false;
    }

    const { WidgetType, Decoration, MatchDecorator, ViewPlugin } = cmView;

    class CriticBadgeWidget extends WidgetType {
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
          showBadgeManagementModal(this.original, this.comment);
        });
        return badge;
      }
      ignoreEvent(e) {
        if (e.type === "click" || e.type === "mousedown") return true;
        return false;
      }
    }

    const criticMatcher = new MatchDecorator({
      regexp: /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g,
      decorate: (add, from, to, match, view) => {
        if (!isFoldEnabled) return;
        const orig = match[1];
        const comm = match[2];
        const origStart = from + 3;
        const origEnd = origStart + orig.length;

        // 1. Hide {==
        add(from, origStart, Decoration.replace({}));
        // 2. Highlight original text
        add(origStart, origEnd, Decoration.mark({ class: "cm-critic-highlight" }));
        // 3. Replace ==}{>>comment<<} with badge widget
        add(origEnd, to, Decoration.replace({
          widget: new CriticBadgeWidget(orig, comm),
        }));
      },
    });

    const criticPlugin = ViewPlugin.define(
      (view) => ({
        decorations: criticMatcher.createDeco(view),
        update(u) {
          this.decorations = isFoldEnabled
            ? criticMatcher.updateDeco(u, this.decorations)
            : Decoration.none;
        },
      }),
      {
        decorations: (v) => v.decorations,
      }
    );

    const addExt = (window.MarkEdit && window.MarkEdit.addExtension) ||
                   (window.editor && window.editor.addExtension);

    if (typeof addExt === "function") {
      addExt(criticPlugin);
      window.__markeditCriticExtensionRegistered = true;
      console.log("[MarkEdit CriticMarkup] Native CodeMirror 6 extension registered successfully.");
      return true;
    }

    return false;
  }

  // 6. Live DOM Fallback Decorator (针对未被 CodeMirror 插件接管的行进行兜底渲染)
  function triggerLiveDecoration() {
    if (!isFoldEnabled) return;

    const lines = document.querySelectorAll(".cm-line");
    const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;

    lines.forEach((line) => {
      // If line already contains our native widget or is decorated, skip
      if (line.querySelector(".cm-critic-badge")) return;
      const text = line.textContent || "";
      if (!text.includes("{==") || !text.includes("<<}")) return;

      if (regex.test(text)) {
        regex.lastIndex = 0;
        let newHtml = "";
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          newHtml += escapeHtml(text.slice(lastIndex, match.index));
          const orig = match[1];
          const comm = match[2];
          newHtml += `<mark class="cm-critic-highlight">${escapeHtml(orig)}<span class="cm-critic-badge" data-original="${escapeHtml(orig)}" data-comment="${escapeHtml(comm)}" title="批注：${escapeHtml(comm)} (点击查看或删除)">💬 ${escapeHtml(comm)}</span></mark>`;
          lastIndex = regex.lastIndex;
        }
        newHtml += escapeHtml(text.slice(lastIndex));
        line.innerHTML = newHtml;

        // Bind click on badge to open management modal
        line.querySelectorAll(".cm-critic-badge").forEach((badge) => {
          badge.addEventListener("click", (e) => {
            e.stopPropagation();
            const orig = badge.getAttribute("data-original") || "";
            const comm = badge.getAttribute("data-comment") || "";
            showBadgeManagementModal(orig, comm);
          });
        });
      }
    });
  }

  // Try initializing native extension immediately
  initNativeCodeMirrorExtension();

  // Also hook into MarkEdit.onEditorReady
  if (window.MarkEdit && typeof window.MarkEdit.onEditorReady === "function") {
    window.MarkEdit.onEditorReady(() => {
      initNativeCodeMirrorExtension();
      triggerLiveDecoration();
    });
  }

  setInterval(triggerLiveDecoration, 1000);

  // 7. Extract all CriticMarkup annotations to clipboard (⌘ + Shift + E)
  function extractAllAnnotations() {
    const view = getEditorView();
    const fullText = view && view.state ? view.state.doc.toString() : document.body.innerText || "";

    const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}|\{>>([\s\S]*?)<<\}/g;
    const matches = [];
    let match;

    while ((match = regex.exec(fullText)) !== null) {
      if (match[1] && match[2]) {
        matches.push({ text: match[1].trim(), comment: match[2].trim() });
      } else if (match[3]) {
        matches.push({ text: "(上下文标记)", comment: match[3].trim() });
      }
    }

    if (matches.length === 0) {
      showToast("ℹ️ 当前文档暂无批注");
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

    if (navigator.clipboard) {
      navigator.clipboard.writeText(report).then(() => {
        showToast(`✅ 已将全部 ${matches.length} 条批注编译为 Agent 指令并复制！`);
      });
    }
  }

  // 8. Global Keyboard Listener
  window.addEventListener(
    "keydown",
    (e) => {
      const modifierKey = isMac ? e.metaKey : e.ctrlKey;

      if (modifierKey && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        e.stopPropagation();

        const view = getEditorView();
        let selectedText = "";

        if (view && view.state && view.state.selection) {
          const mainSel = view.state.selection.main;
          if (!mainSel.empty) {
            selectedText = view.state.sliceDoc(mainSel.from, mainSel.to).trim();
          }
        }

        if (!selectedText) {
          const domSel = window.getSelection();
          if (domSel && !domSel.isCollapsed) {
            selectedText = domSel.toString().trim();
          }
        }

        if (!selectedText) {
          showToast("请先用鼠标划选要批注的一段文字");
          return;
        }

        showAnnotationDialog(selectedText);
      }

      if (modifierKey && e.shiftKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        e.stopPropagation();
        extractAllAnnotations();
      }

      if (e.altKey && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        isFoldEnabled = !isFoldEnabled;
        showToast(isFoldEnabled ? "👁️ 已开启便签折叠预览视图" : "📝 已切换至纯文本源码视图");
        const view = getEditorView();
        if (view && typeof view.dispatch === "function") {
          view.dispatch({});
        }
        if (!isFoldEnabled) {
          document.querySelectorAll(".cm-critic-highlight").forEach((el) => {
            const parent = el.parentNode;
            if (parent) {
              const orig = el.textContent;
              // let CM redraw
            }
          });
        }
      }
    },
    true
  );

  console.log("[MarkEdit CriticMarkup Live Decorator] Active with mouse selection toolbar & badge click management.");
  setTimeout(() => {
    try {
      showToast("📝 批注插件已就绪 (划词浮现小胶囊，点击便签可编辑/删除)", 3000);
    } catch {}
  }, 600);
})();
