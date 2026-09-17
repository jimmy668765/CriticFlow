/** Locate rendered prose without serializing or discarding the original Markdown. */
export function sourceProjection(source: string) {
  const hidden = new Uint8Array(source.length);
  const wrappers: { from: number; to: number; contentFrom: number; contentTo: number }[] = [];
  const hide = (from: number, to: number) => hidden.fill(1, from, to);
  for (const re of [/\{>>[\s\S]*?<<\}/g, /<\/?[a-z][^>]*>/gi]) {
    for (const m of source.matchAll(re)) hide(m.index!, m.index! + m[0].length);
  }
  for (const m of source.matchAll(/!?\[([^\]]*)\]\([^)]*\)/g)) {
    const label = m.index! + m[0].indexOf("[") + 1;
    hide(m.index!, label); hide(label + m[1].length, m.index! + m[0].length);
    wrappers.push({ from: m.index!, to: m.index! + m[0].length, contentFrom: label, contentTo: label + m[1].length });
  }
  for (const m of source.matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g)) {
    const label = m.index! + (m[2] === undefined ? 2 : m[0].indexOf("|") + 1), value = m[2] ?? m[1];
    hide(m.index!, label); hide(label + value.length, m.index! + m[0].length);
    wrappers.push({ from: m.index!, to: m.index! + m[0].length, contentFrom: label, contentTo: label + value.length });
  }
  // Delimiter runs use a stack so *** closes an inner * before its outer **.
  const stack: { token: string; from: number; end: number }[] = [];
  for (const m of source.matchAll(/\\[\s\S]|`+|\*+|_+|~{2}|={2}/g)) {
    const run = m[0], at = m.index!;
    if (run[0] === "\\" || hidden[at]) continue;
    const previous = source[at - 1] || " ", next = source[at + run.length] || " ";
    if (run[0] === "_" && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next)) continue;
    const code = stack[stack.length - 1];
    if (code?.token[0] === "`" && run !== code.token) continue;
    let used = 0;
    while (used < run.length) {
      const top = stack[stack.length - 1];
      if (top && (run[0] === "`" || !/\s/.test(previous)) && run.slice(used).startsWith(top.token) &&
          (run[0] !== "`" || top.token === run)) {
        const end = at + used + top.token.length;
        wrappers.push({ from: top.from, to: end, contentFrom: top.end, contentTo: at + used });
        stack.pop(); used += top.token.length;
      } else if (run[0] === "`" || !/\s/.test(next)) {
        const size = run[0] === "`" ? run.length : Math.min(2, run.length - used);
        const token = run.slice(used, used + size);
        stack.push({ token, from: at + used, end: at + used + size }); used += size;
      } else break;
    }
  }
  const html: { name: string; from: number; end: number }[] = [];
  for (const m of source.matchAll(/<(\/?)([a-z][\w:-]*)\b[^>]*>/gi)) {
    const name = m[2].toLowerCase();
    if (!["a", "strong", "b", "em", "i", "span", "mark", "s", "del", "u", "code"].includes(name)) continue;
    if (!m[1]) html.push({ name, from: m.index!, end: m.index! + m[0].length });
    else if (html[html.length - 1]?.name === name) {
      const opening = html.pop()!;
      wrappers.push({ from: opening.from, to: m.index! + m[0].length, contentFrom: opening.end, contentTo: m.index! });
    }
  }
  const entities = new Map<number, { value: string; length: number }>();
  for (const m of source.matchAll(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi)) {
    if (hidden[m.index!]) continue;
    // Only the restricted entity token enters this detached decoder, never user HTML.
    const decoder = document.createElement("textarea"); decoder.innerHTML = m[0];
    if (decoder.value !== m[0]) entities.set(m.index!, { value: decoder.value, length: m[0].length });
  }
  const from: number[] = [], to: number[] = [];
  let text = "";
  for (let at = 0; at < source.length;) {
    const entity = entities.get(at), char = String.fromCodePoint(source.codePointAt(at)!);
    const length = entity?.length ?? char.length, value = entity?.value ?? char;
    if (!hidden[at]) for (const rendered of value) {
      if (!/[\p{L}\p{N}]/u.test(rendered)) continue;
      text += rendered;
      // One rendered Unicode code point equals one projection position;
      // never duplicate astral characters by their UTF-16 surrogate length.
      from.push(at); to.push(at + length);
    }
    at += length;
  }
  function expand(start: number, end: number) {
    // Never leave one side of an inline syntax pair inside the CriticMarkup wrapper.
    // Crossing only part of a formatted token expands to that complete token.
    let changed: boolean;
    do {
      changed = false;
      for (const w of wrappers) {
        if (end <= w.contentFrom || start >= w.contentTo) continue;
        const coversContent = start <= w.contentFrom && end >= w.contentTo;
        const crossesOpening = start < w.contentFrom && end > w.contentFrom;
        const crossesClosing = start < w.contentTo && end > w.contentTo;
        if (!(coversContent || crossesOpening || crossesClosing)) continue;
        const nextStart = Math.min(start, w.from), nextEnd = Math.max(end, w.to);
        if (nextStart !== start || nextEnd !== end) { start = nextStart; end = nextEnd; changed = true; }
      }
    } while (changed);
    return { from: start, to: end };
  }
  return { text, from, to, expand };
}
