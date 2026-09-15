import { markupPattern, prose, type Target } from "./document-target";

/** Render section-scoped annotations without guessing a file from the active tab. */
export function renderReadingAnnotations(root: HTMLElement, target: Target & { snapshot: string }, bounds: { from: number; to: number } | null, open: (original: string, comment: string, target: Target) => void) {
  const doc = root.ownerDocument;
  const nodes: { node: Text; from: number; to: number }[] = [];
  let text = "";
  function visit(node: Node) {
    if (node.nodeType === 3) {
      const value = node.nodeValue || "";
      nodes.push({ node: node as Text, from: text.length, to: text.length + value.length }); text += value; return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.matches("pre, code, script, style, input, textarea, .cm-critic-badge, .criticflow-reading-mark")) { text += "\0"; return; }
    // Obsidian may already have rendered ==original== as native <mark>.
    if (el.tagName === "MARK") text += "==";
    for (const child of Array.from(el.childNodes)) visit(child);
    if (el.tagName === "MARK") text += "==";
  }
  visit(root);
  const raw = [...target.snapshot.matchAll(markupPattern())].filter(m => !bounds || (m.index! >= bounds.from && m.index! + m[0].length <= bounds.to));
  const visible = [...text.matchAll(/\{==([^\0]*?)==\}\{>>([^\0]*?)<<\}/g)];
  const key = (orig: string, comment: string) => JSON.stringify([prose(orig), prose(comment)]);
  const consumed = new Set<number>();
  const plans = visible.map(m => {
    const id = key(m[1], m[2]), candidates = raw.filter(r => key(r[1], r[2]) === id);
    const count = visible.filter(v => key(v[1], v[2]) === id).length;
    // Ordinals are safe only when the complete source section and DOM agree.
    if (candidates.length !== count || (!bounds && count !== 1)) return null;
    const source = candidates.find(r => !consumed.has(r.index!));
    if (!source) return null;
    consumed.add(source.index!); return { m, source };
  });
  for (const plan of plans.reverse()) {
    if (!plan) continue;
    const { m, source } = plan, start = m.index!, end = start + m[0].length;
    const first = nodes.find(n => n.from <= start && n.to > start), last = nodes.find(n => n.from < end && n.to >= end);
    if (!first || !last) continue;
    const blocks = 'p, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, blockquote, section, article, div';
    const block = first.node.parentElement?.closest(blocks);
    if (nodes.some(n => n.to > start && n.from < end && n.node.parentElement?.closest(blocks) !== block)) continue;
    const wrapper = doc.createElement("span"); wrapper.className = "criticflow-reading-mark";
    const highlight = doc.createElement("span"); highlight.className = "cm-critic-highlight"; highlight.textContent = source[1];
    const badge = doc.createElement("span"); badge.className = "cm-critic-badge";
    badge.textContent = "💬 " + (source[2].length > 36 || source[2].includes("\n") ? "查看批注" : source[2]);
    badge.title = source[2];
    const bound = { ...target, from: source.index!, to: source.index! + source[0].length };
    let lastOpen = 0;
    const onOpen = (e: Event) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - lastOpen < 350) return; lastOpen = Date.now(); open(source[1], source[2], bound); };
    badge.addEventListener("click", onOpen); badge.addEventListener("touchend", onOpen);
    wrapper.append(highlight, badge);
    const range = doc.createRange(); range.setStart(first.node, start - first.from); range.setEnd(last.node, end - last.from);
    const insertion = range.cloneRange(); insertion.collapse(true);
    range.deleteContents(); insertion.insertNode(wrapper);
  }
}
