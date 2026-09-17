export type TextAnchor = { before: string; after: string; occurrence: number; total: number };

// Compare prose, not Markdown decoration or generated annotation badges.
export function prose(text: string): string {
  return text.replace(/\{>>[\s\S]*?<<\}/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, "")
    .replace(/&#(?:x[0-9a-f]+|\d+);/gi, entity => {
      const name = entity.slice(1, -1);
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return ""; }
    })
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Map rendered prose back to source offsets without selecting link targets or comments. */
export function sourceProse(source: string) {
  const hidden = new Uint8Array(source.length);
  const hide = (from: number, to: number) => hidden.fill(1, from, to);
  for (const re of [/\{>>[\s\S]*?<<\}/g, /<[^>]*>/g])
    for (const m of source.matchAll(re)) hide(m.index!, m.index! + m[0].length);
  for (const m of source.matchAll(/!?\[([^\]]*)\]\([^)]*\)/g)) {
    const label = m.index! + m[0].indexOf("[") + 1;
    hide(m.index!, label); hide(label + m[1].length, m.index! + m[0].length);
  }
  for (const m of source.matchAll(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g)) {
    const label = m.index! + (m[2] === undefined ? 2 : m[0].indexOf("|") + 1);
    const value = m[2] ?? m[1];
    hide(m.index!, label); hide(label + value.length, m.index! + m[0].length);
  }
  const entity = (value: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    const name = value.slice(1, -1);
    if (name in named) return named[name];
    if (/^#x[0-9a-f]+$/i.test(name)) {
      try { return String.fromCodePoint(parseInt(name.slice(2), 16)); } catch { return value; }
    }
    if (/^#\d+$/.test(name)) {
      try { return String.fromCodePoint(parseInt(name.slice(1), 10)); } catch { return value; }
    }
    return value;
  };
  const entities = new Map<number, string>();
  for (const match of source.matchAll(/&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi)) {
    if (!hidden[match.index!]) entities.set(match.index!, match[0]);
  }
  const chars: string[] = [], starts: number[] = [], ends: number[] = [];
  for (let at = 0; at < source.length;) {
    const raw = entities.get(at) ?? String.fromCodePoint(source.codePointAt(at)!);
    const value = entities.has(at) ? entity(raw) : raw;
    if (!hidden[at]) for (const char of value) if (/[\p{L}\p{N}]/u.test(char)) {
      chars.push(char); starts.push(at); ends.push(at + raw.length);
    }
    at += raw.length;
  }
  return { text: chars.join(""), starts, ends };
}

export function projectedOccurrences(source: string, needle: string): { from: number; to: number }[] {
  const wanted = prose(needle), projection = sourceProse(source), result: { from: number; to: number }[] = [];
  if (!wanted) return result;
  for (let at = projection.text.indexOf(wanted); at >= 0; at = projection.text.indexOf(wanted, at + 1)) {
    result.push({ from: projection.starts[at], to: projection.ends[at + wanted.length - 1] });
  }
  return result;
}

export function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) found.push(i);
  return found;
}
