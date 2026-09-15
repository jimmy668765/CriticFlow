import { prose } from "../shared/text-anchor.ts";
export type StoredAnnotation = { originalText: string; comment: string };

/** Markdown splits multiline comments across blocks: scan a single document, not individual Text nodes. */
export function renderAnnotations(root: Element, stored: StoredAnnotation[], makeMark: (item: StoredAnnotation, source: HTMLElement) => HTMLElement) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "", current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    if (!parent || parent.closest('pre, code, textarea, input, [contenteditable="true"], .cm-editor, .monaco-editor, .paseo-critic-mark, [aria-hidden="true"]')) {
      text += "\0"; continue;
    }
    const value = current.nodeValue || "";
    nodes.push({ node: current as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  const matches = [...text.matchAll(/\{==([^\0]*?)==\}\{>>([^\0]*?)<<\}/g)];
  // Reverse order keeps offsets in surviving Text nodes stable.
  for (const match of matches.reverse()) {
    const original = prose(match[1]), comment = prose(match[2]);
    const candidates = stored.filter(a => prose(a.originalText) === original && prose(a.comment) === comment);
    const item = candidates[0];
    if (!item || candidates.some(a => a.originalText !== item.originalText || a.comment !== item.comment)) continue; // Lossy normalization must not choose between distinct source annotations.
    const start = match.index!, end = start + match[0].length;
    const first = nodes.find(n => n.start <= start && n.end > start);
    const last = nodes.find(n => n.start < end && n.end >= end);
    if (!first?.node.isConnected || !last?.node.isConnected || !first.node.parentElement) continue;
    // Never delete across Markdown block boundaries. Leave unsupported markup
    // visible until a structure-preserving cross-block renderer is available.
    const blocks = 'p, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, blockquote, section, article, div';
    const block = first.node.parentElement.closest(blocks);
    if (nodes.some(n => n.end > start && n.start < end && n.node.parentElement?.closest(blocks) !== block)) continue;
    const mark = makeMark(item, first.node.parentElement);
    // All participating text nodes belong to the same block.
    const insertion = doc.createRange();
    insertion.setStart(first.node, start - first.start);
    insertion.collapse(true);
    const range = doc.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    range.deleteContents();
    insertion.insertNode(mark);
  }
}
