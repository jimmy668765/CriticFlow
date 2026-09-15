var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// CriticFlow/packages/obsidian/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CriticMarkupPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");

// CriticFlow/packages/obsidian/document-target.ts
var import_obsidian = require("obsidian");
var prose = (text) => text.replace(/\{>>[\s\S]*?<<\}/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}]/gu, "");
var markupPattern = () => /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;
var hasMarkers = (text) => /\{==|==\}|\{>>|<<\}/.test(text);
function resolveActiveContext(app) {
  const view = app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
  return { view, file: view == null ? void 0 : view.file, editor: (view == null ? void 0 : view.getMode()) === "source" ? view.editor : void 0 };
}
function owningView(app, node) {
  return app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v instanceof import_obsidian.MarkdownView && v.contentEl.contains(node));
}
function visibleText(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(".cm-critic-badge, script, style, [aria-hidden=true]").forEach((e) => e.remove());
  return prose(fragment.textContent || "");
}
function captureAddition(app) {
  const selection = window.getSelection();
  const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
  const view = range ? owningView(app, range.startContainer) : resolveActiveContext(app).view;
  if (!(view == null ? void 0 : view.file) || range && !view.contentEl.contains(range.endContainer)) return null;
  const file = view.file;
  if (view.getMode() === "source") {
    const editor = view.editor, raw = editor.getSelection(), text2 = raw.trim();
    if (!text2) return null;
    const from = editor.posToOffset(editor.getCursor("from")) + raw.indexOf(text2);
    return { text: text2, target: { file, path: file.path, view, editor, snapshot: editor.getValue(), from, to: from + text2.length } };
  }
  if (!range) return null;
  const parent = range.startContainer.parentElement;
  if (parent == null ? void 0 : parent.closest("pre, code, input, textarea, .cm-critic-badge, .criticflow-modal-overlay")) return null;
  const text = selection.toString().trim();
  const root = (parent == null ? void 0 : parent.closest(".markdown-preview-view")) || view.contentEl;
  if (!text || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return { text, target: {
    file,
    path: file.path,
    view,
    snapshot: app.vault.read(file).catch(() => null),
    before: visibleText(before).slice(-96),
    after: visibleText(after).slice(0, 96)
  } };
}
function targetForWidget(app, cm, badge) {
  const view = owningView(app, cm.dom);
  if (!(view == null ? void 0 : view.file)) return null;
  const snapshot = cm.state.doc.toString(), pos = cm.posAtDOM(badge);
  const match = [...snapshot.matchAll(markupPattern())].find((m) => pos >= m.index && pos < m.index + m[0].length);
  if (!match) return null;
  return { file: view.file, path: view.file.path, view, cm, snapshot, from: match.index, to: match.index + match[0].length };
}
function locate(snapshot, expected, target) {
  if (target.from !== void 0 && target.to !== void 0) {
    if (snapshot.slice(target.from, target.to) !== expected) throw new Error("\u6279\u6CE8\u4F4D\u7F6E\u6216\u539F\u6587\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u6279\u6CE8");
    if (!hasMarkers(expected) && [...snapshot.matchAll(markupPattern())].some((m) => target.from < m.index + m[0].length && target.to > m.index))
      throw new Error("\u9009\u533A\u4F4D\u4E8E\u5DF2\u6709\u6279\u6CE8\u4E2D\uFF0C\u8BF7\u70B9\u51FB\u6C14\u6CE1\u7F16\u8F91");
    return { from: target.from, to: target.to };
  }
  const occupied = [...snapshot.matchAll(markupPattern())].map((m) => [m.index, m.index + m[0].length]);
  const candidates = [];
  for (let at = snapshot.indexOf(expected); at >= 0; at = snapshot.indexOf(expected, at + 1)) {
    if (occupied.some(([from, to]) => at < to && at + expected.length > from)) continue;
    const before = (target.before || "").slice(-48), after = (target.after || "").slice(0, 48);
    if ((!before || prose(snapshot.slice(0, at)).endsWith(before)) && (!after || prose(snapshot.slice(at + expected.length)).startsWith(after))) candidates.push(at);
  }
  if (candidates.length !== 1) throw new Error("\u9009\u533A\u4E0E\u6E90\u6587\u4EF6\u65E0\u6CD5\u552F\u4E00\u5BF9\u5E94\uFF0C\u672A\u5199\u5165\uFF1B\u8BF7\u5728\u7F16\u8F91\u6A21\u5F0F\u6279\u6CE8");
  return { from: candidates[0], to: candidates[0] + expected.length };
}
async function replaceTarget(app, target, expected, replacement) {
  var _a;
  const snapshot = await target.snapshot;
  if (snapshot === null || target.file.path !== target.path) throw new Error("\u539F\u6587\u4EF6\u5DF2\u79FB\u52A8\u6216\u8BFB\u53D6\u5931\u8D25\uFF0C\u672A\u5199\u5165");
  const { from, to } = locate(snapshot, expected, target);
  if (target.cm || target.editor) {
    if (((_a = target.view) == null ? void 0 : _a.file) !== target.file || target.view.getMode() !== "source") throw new Error("\u539F\u7F16\u8F91\u5668\u5DF2\u5207\u6362\uFF0C\u672A\u5199\u5165");
    if (target.cm) {
      if (!target.cm.dom.isConnected || target.cm.state.doc.toString() !== snapshot) throw new Error("\u6587\u6863\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u6279\u6CE8");
      target.cm.dispatch({ changes: { from, to, insert: replacement } });
    } else {
      const editor = target.editor;
      if (editor !== target.view.editor || editor.getValue() !== snapshot) throw new Error("\u6587\u6863\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5212\u9009");
      editor.replaceRange(replacement, editor.offsetToPos(from), editor.offsetToPos(to));
    }
    return "editor";
  }
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof import_obsidian.MarkdownView && view.file === target.file && view.getMode() === "source" && view.editor.getValue() !== snapshot)
      throw new Error("\u8BE5\u6587\u4EF6\u6709\u672A\u540C\u6B65\u7684\u7F16\u8F91\u5185\u5BB9\uFF0C\u672A\u8986\u76D6");
  }
  await app.vault.process(target.file, (current) => {
    if (current !== snapshot) throw new Error("\u6587\u4EF6\u5DF2\u53D8\u5316\uFF0C\u672A\u8986\u76D6\uFF1B\u8BF7\u91CD\u65B0\u6253\u5F00\u6279\u6CE8");
    return current.slice(0, from) + replacement + current.slice(to);
  });
  return "file";
}

// CriticFlow/packages/obsidian/reading-renderer.ts
function renderReadingAnnotations(root, target, bounds, open) {
  var _a;
  const doc = root.ownerDocument;
  const nodes = [];
  let text = "";
  function visit(node) {
    if (node.nodeType === 3) {
      const value = node.nodeValue || "";
      nodes.push({ node, from: text.length, to: text.length + value.length });
      text += value;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.matches("pre, code, script, style, input, textarea, .cm-critic-badge, .criticflow-reading-mark")) {
      text += "\0";
      return;
    }
    if (el.tagName === "MARK") text += "==";
    for (const child of Array.from(el.childNodes)) visit(child);
    if (el.tagName === "MARK") text += "==";
  }
  visit(root);
  const raw = [...target.snapshot.matchAll(markupPattern())].filter((m) => !bounds || m.index >= bounds.from && m.index + m[0].length <= bounds.to);
  const visible = [...text.matchAll(/\{==([^\0]*?)==\}\{>>([^\0]*?)<<\}/g)];
  const key = (orig, comment) => JSON.stringify([prose(orig), prose(comment)]);
  const consumed = /* @__PURE__ */ new Set();
  const plans = visible.map((m) => {
    const id = key(m[1], m[2]), candidates = raw.filter((r) => key(r[1], r[2]) === id);
    const count = visible.filter((v) => key(v[1], v[2]) === id).length;
    if (candidates.length !== count || !bounds && count !== 1) return null;
    const source = candidates.find((r) => !consumed.has(r.index));
    if (!source) return null;
    consumed.add(source.index);
    return { m, source };
  });
  for (const plan of plans.reverse()) {
    if (!plan) continue;
    const { m, source } = plan, start = m.index, end = start + m[0].length;
    const first = nodes.find((n) => n.from <= start && n.to > start), last = nodes.find((n) => n.from < end && n.to >= end);
    if (!first || !last) continue;
    const blocks = "p, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, blockquote, section, article, div";
    const block = (_a = first.node.parentElement) == null ? void 0 : _a.closest(blocks);
    if (nodes.some((n) => {
      var _a2;
      return n.to > start && n.from < end && ((_a2 = n.node.parentElement) == null ? void 0 : _a2.closest(blocks)) !== block;
    })) continue;
    const wrapper = doc.createElement("span");
    wrapper.className = "criticflow-reading-mark";
    const highlight = doc.createElement("span");
    highlight.className = "cm-critic-highlight";
    highlight.textContent = source[1];
    const badge = doc.createElement("span");
    badge.className = "cm-critic-badge";
    badge.textContent = "\u{1F4AC} " + (source[2].length > 36 || source[2].includes("\n") ? "\u67E5\u770B\u6279\u6CE8" : source[2]);
    badge.title = source[2];
    const bound = { ...target, from: source.index, to: source.index + source[0].length };
    let lastOpen = 0;
    const onOpen = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - lastOpen < 350) return;
      lastOpen = Date.now();
      open(source[1], source[2], bound);
    };
    badge.addEventListener("click", onOpen);
    badge.addEventListener("touchend", onOpen);
    wrapper.append(highlight, badge);
    const range = doc.createRange();
    range.setStart(first.node, start - first.from);
    range.setEnd(last.node, end - last.from);
    const insertion = range.cloneRange();
    insertion.collapse(true);
    range.deleteContents();
    insertion.insertNode(wrapper);
  }
}

// CriticFlow/packages/obsidian/main.ts
var DEFAULT_SETTINGS = {
  foldEnabled: true
};
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
var activePluginInstance = null;
var lastActionTimestamp = 0;
function isMobileDevice() {
  return window.innerWidth <= 768 || "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
function safeRunAction(action) {
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
function openAddAnnotationModal(app, selectedText, target) {
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
  const title = document.createElement("div");
  title.style.cssText = "font-size: 16px; font-weight: 700; color: #f4f4f5; display: flex; align-items: center; gap: 6px;";
  title.innerHTML = `<span>\u270D\uFE0F</span><span>\u6DFB\u52A0\u5212\u8BCD\u6279\u6CE8</span>`;
  modal.appendChild(title);
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
  quoteBox.textContent = `\u201C${selectedText}\u201D`;
  modal.appendChild(quoteBox);
  const textarea = document.createElement("textarea");
  textarea.placeholder = "\u8F93\u5165\u4FEE\u6539\u5EFA\u8BAE\u6216\u6279\u6CE8\u5185\u5BB9 (\u6309 \u2318+Enter \u63D2\u5165)...";
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
  const footer = document.createElement("div");
  footer.style.cssText = "display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "\u53D6\u6D88";
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
    activePluginInstance == null ? void 0 : activePluginInstance.resetSelectionState();
  };
  const submitBtn = document.createElement("button");
  submitBtn.textContent = "\u270D\uFE0F \u63D2\u5165\u6279\u6CE8";
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
      new import_obsidian2.Notice("\u8BF7\u8F93\u5165\u6279\u6CE8\u5185\u5BB9");
      return;
    }
    if (hasMarkers(selectedText + comment)) {
      new import_obsidian2.Notice("\u4E0D\u652F\u6301\u5D4C\u5957\u6279\u6CE8\u6216 CriticMarkup \u5206\u9694\u7B26");
      return;
    }
    saving = true;
    submitBtn.disabled = true;
    try {
      const result = await replaceTarget(app, target, selectedText, `{==${selectedText}==}{>>${comment}<<}`);
      new import_obsidian2.Notice(result === "file" ? "\u2705 \u5DF2\u4FDD\u5B58\u5230\u539F\u6587\u4EF6" : "\u2705 \u5DF2\u5199\u5165\u539F\u7F16\u8F91\u5668\uFF0C\u7531 Obsidian \u81EA\u52A8\u4FDD\u5B58");
      overlay.remove();
      activePluginInstance == null ? void 0 : activePluginInstance.resetSelectionState();
    } catch (err) {
      new import_obsidian2.Notice("\u274C \u672A\u4FDD\u5B58\uFF1A" + String(err));
    } finally {
      saving = false;
      submitBtn.disabled = false;
    }
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
      activePluginInstance == null ? void 0 : activePluginInstance.resetSelectionState();
    }
  });
  textarea.addEventListener("keydown", (e) => {
    if (!e.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void doSubmit();
    }
    if (e.key === "Escape") {
      overlay.remove();
      activePluginInstance == null ? void 0 : activePluginInstance.resetSelectionState();
    }
  });
  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 80);
}
function openAnnotationManageModal(app, originalText, comment, target) {
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
  const title = document.createElement("div");
  title.style.cssText = "font-size: 16px; font-weight: 700; color: #f4f4f5; display: flex; align-items: center; gap: 6px;";
  title.innerHTML = `<span>\u{1F4AC}</span><span>\u6279\u6CE8\u8BE6\u60C5</span>`;
  modal.appendChild(title);
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
  quoteBox.textContent = `\u201C${originalText}\u201D`;
  modal.appendChild(quoteBox);
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
  const footer = document.createElement("div");
  footer.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-top: 4px; gap: 8px;";
  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "\u{1F5D1}\uFE0F \u5220\u9664\u6B64\u6279\u6CE8";
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
  cancelBtn.textContent = "\u53D6\u6D88";
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
  saveBtn.textContent = "\u4FDD\u5B58\u4FEE\u6539";
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
  const updateDoc = async (newCommentOrNull) => {
    if (saving) return;
    if (newCommentOrNull !== null && hasMarkers(newCommentOrNull)) {
      new import_obsidian2.Notice("\u6279\u6CE8\u5185\u5BB9\u4E0D\u80FD\u542B CriticMarkup \u5206\u9694\u7B26");
      return;
    }
    saving = true;
    saveBtn.disabled = deleteBtn.disabled = true;
    try {
      const expected = `{==${originalText}==}{>>${comment}<<}`;
      const replacement = newCommentOrNull === null ? originalText : `{==${originalText}==}{>>${newCommentOrNull.trim()}<<}`;
      const result = await replaceTarget(app, target, expected, replacement);
      overlay.remove();
      new import_obsidian2.Notice(result === "file" ? "\u2705 \u5DF2\u4FDD\u5B58\u5230\u539F\u6587\u4EF6" : "\u2705 \u5DF2\u66F4\u65B0\u539F\u7F16\u8F91\u5668\uFF0C\u7531 Obsidian \u81EA\u52A8\u4FDD\u5B58");
    } catch (err) {
      new import_obsidian2.Notice("\u274C \u672A\u4FDD\u5B58\uFF1A" + String(err));
    } finally {
      saving = false;
      saveBtn.disabled = deleteBtn.disabled = false;
    }
  };
  deleteBtn.onclick = () => safeRunAction(() => updateDoc(null));
  saveBtn.onclick = () => {
    const val = textarea.value.trim();
    if (!val) {
      new import_obsidian2.Notice("\u6279\u6CE8\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
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
var CriticBadgeWidget = class extends import_view.WidgetType {
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
    badge.innerHTML = `\u{1F4AC} <span>${escapeHtml(this.comment.length > 36 || this.comment.includes("\n") ? "\u67E5\u770B\u6279\u6CE8" : this.comment)}</span>`;
    badge.title = `\u6279\u6CE8\uFF1A${this.comment} (\u70B9\u51FB\u67E5\u770B\u6216\u5220\u9664)`;
    const handleOpen = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (activePluginInstance) {
        safeRunAction(() => {
          const app = activePluginInstance.app;
          const target = targetForWidget(app, view, badge);
          if (!target) {
            new import_obsidian2.Notice("\u65E0\u6CD5\u5B9A\u4F4D\u5F53\u524D\u6279\u6CE8\uFF0C\u672A\u4FEE\u6539");
            return;
          }
          openAnnotationManageModal(app, this.original, this.comment, target);
        });
      }
    };
    badge.addEventListener("click", handleOpen);
    badge.addEventListener("touchend", handleOpen);
    return badge;
  }
  ignoreEvent(e) {
    return e.type === "click" || e.type === "touchend" || e.type === "mousedown";
  }
};
var CriticMarkupPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.floatingBtn = null;
    this.activeSelectedText = "";
    this.savedAddition = null;
    this.updatePending = false;
  }
  async onload() {
    activePluginInstance = this;
    await this.loadSettings();
    this.registerEditorExtension(this.buildEditorExtension());
    this.registerReadingViewProcessor();
    this.setupFloatingToolbar();
    this.registerPluginCommands();
  }
  resetSelectionState() {
    this.activeSelectedText = "";
    this.savedAddition = null;
    if (this.floatingBtn) {
      this.floatingBtn.style.display = "none";
    }
  }
  buildEditorExtension() {
    const decorate = (text) => {
      if (!this.settings.foldEnabled) return import_view.Decoration.none;
      const ranges = [];
      for (const match of text.matchAll(markupPattern())) {
        const from = match.index, origEnd = from + 3 + match[1].length;
        ranges.push(import_view.Decoration.replace({}).range(from, from + 3));
        if (origEnd > from + 3) ranges.push(import_view.Decoration.mark({ class: "cm-critic-highlight" }).range(from + 3, origEnd));
        ranges.push(import_view.Decoration.replace({ widget: new CriticBadgeWidget(match[1], match[2]) }).range(origEnd, from + match[0].length));
      }
      return import_view.Decoration.set(ranges, true);
    };
    return import_state.StateField.define({
      create: (state) => decorate(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged || transaction.reconfigured ? decorate(transaction.state.doc.toString()) : value,
      provide: (field) => import_view.EditorView.decorations.from(field)
    });
  }
  registerReadingViewProcessor() {
    this.registerMarkdownPostProcessor(async (element, context) => {
      if (!this.settings.foldEnabled) return;
      const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
      if (!(file instanceof import_obsidian2.TFile)) return;
      try {
        const section = context.getSectionInfo(element);
        const snapshot = await this.app.vault.read(file);
        if (activePluginInstance !== this || !this.settings.foldEnabled) return;
        let bounds = null;
        if (section) {
          const lines = snapshot.split("\n");
          const offset = (line) => lines.slice(0, line).reduce((sum, s) => sum + s.length + 1, 0);
          bounds = { from: offset(section.lineStart), to: Math.min(snapshot.length, offset(section.lineEnd + 1)) };
        }
        renderReadingAnnotations(
          element,
          { file, path: file.path, snapshot },
          bounds,
          (original, comment, target) => openAnnotationManageModal(this.app, original, comment, target)
        );
      } catch (err) {
        console.warn("CriticFlow reading renderer:", err);
      }
    });
  }
  setupFloatingToolbar() {
    this.floatingBtn = document.createElement("div");
    this.floatingBtn.id = "obsidian-floating-annotate-btn";
    this.floatingBtn.innerHTML = `<span style="color:#eab308;font-size:15px;">\u270D\uFE0F</span><span>\u6DFB\u52A0\u5212\u8BCD\u6279\u6CE8</span>`;
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
    const triggerAnnotation = (e) => {
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
  updateFloatingButton() {
    var _a;
    if (document.querySelector(".criticflow-modal-overlay")) return;
    this.savedAddition = captureAddition(this.app);
    const text = ((_a = this.savedAddition) == null ? void 0 : _a.text) || "";
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
            this.floatingBtn.classList.add("is-mobile-dock");
            this.floatingBtn.style.top = "";
            this.floatingBtn.style.left = "";
          } else {
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
  hideFloatingBtn() {
    if (this.floatingBtn) {
      this.floatingBtn.style.display = "none";
    }
  }
  registerPluginCommands() {
    this.addCommand({
      id: "criticmarkup-add-annotation",
      name: "\u6DFB\u52A0\u5212\u8BCD\u6279\u6CE8 (Add Annotation)",
      callback: () => {
        const addition = captureAddition(this.app);
        if (!addition) {
          new import_obsidian2.Notice("\u8BF7\u5148\u5728\u76EE\u6807\u6587\u6863\u5212\u9009\u8981\u6279\u6CE8\u7684\u6587\u5B57");
          return;
        }
        openAddAnnotationModal(this.app, addition.text, addition.target);
      },
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "c" }]
    });
    this.addCommand({
      id: "criticmarkup-extract-annotations",
      name: "\u4E00\u952E\u63D0\u53D6\u5168\u6587\u6863\u6279\u6CE8\u4E3A Agent \u6307\u4EE4 (Extract for Agent)",
      callback: async () => {
        const ctx = resolveActiveContext(this.app);
        let content = "";
        if (ctx.editor) {
          content = ctx.editor.getValue();
        } else if (ctx.file) {
          content = await this.app.vault.read(ctx.file);
        }
        if (!content) {
          new import_obsidian2.Notice("\u5F53\u524D\u6587\u6863\u4E3A\u7A7A");
          return;
        }
        const regex = /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}|\{>>([\s\S]*?)<<\}/g;
        const matches = [];
        let match;
        while ((match = regex.exec(content)) !== null) {
          if (match[1] && match[2]) {
            matches.push({ text: match[1].trim(), comment: match[2].trim() });
          } else if (match[3]) {
            matches.push({ text: "(\u4E0A\u4E0B\u6587)", comment: match[3].trim() });
          }
        }
        if (matches.length === 0) {
          new import_obsidian2.Notice("\u2139\uFE0F \u5F53\u524D\u6587\u6863\u6682\u65E0\u6279\u6CE8");
          return;
        }
        let report = `# \u6587\u6863\u5BA1\u9605\u4E0E\u4FEE\u6539\u8981\u6C42 (\u6765\u81EA\u6279\u6CE8)

`;
        report += `\u672C\u6587\u6863\u5171\u5305\u542B **${matches.length}** \u6761\u5BA1\u9605\u4FEE\u6539\u610F\u89C1\uFF1A

`;
        matches.forEach((item, index) => {
          report += `### \u6279\u6CE8 ${index + 1}
`;
          report += `- **\u539F\u6587\u4F4D\u7F6E**\uFF1A\`${item.text}\`
`;
          report += `- **\u4FEE\u6539\u6279\u6CE8**\uFF1A${item.comment}

`;
        });
        report += `\u8BF7\u4E25\u683C\u6839\u636E\u4E0A\u8FF0\u6279\u6CE8\u4FEE\u6539\u5BF9\u5E94\u6587\u4EF6\u5E76\u4FDD\u5B58\uFF0C\u4FDD\u6301\u5176\u4ED6\u65E0\u5173\u5185\u5BB9\u4E0D\u53D8\u3002
`;
        await navigator.clipboard.writeText(report);
        new import_obsidian2.Notice(`\u2705 \u5DF2\u5C06\u5168\u90E8 ${matches.length} \u6761\u6279\u6CE8\u590D\u5236\u5230\u526A\u8D34\u677F\uFF01\u53EF\u4EE5\u76F4\u63A5\u53D1\u7ED9 AI Agent\u3002`);
      },
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "e" }]
    });
    this.addCommand({
      id: "criticmarkup-toggle-fold",
      name: "\u5207\u6362\u4FBF\u7B7E\u6298\u53E0\u89C6\u56FE / \u6E90\u7801\u89C6\u56FE (Toggle View)",
      callback: () => {
        this.settings.foldEnabled = !this.settings.foldEnabled;
        this.saveSettings();
        new import_obsidian2.Notice(
          this.settings.foldEnabled ? "\u{1F441}\uFE0F \u5DF2\u5F00\u542F\u4FBF\u7B7E\u6298\u53E0\u9884\u89C8" : "\u{1F4DD} \u5DF2\u5207\u6362\u81F3\u7EAF\u6587\u672C\u6E90\u7801\u89C6\u56FE"
        );
        this.app.workspace.updateOptions();
      },
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "c" }]
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
};
