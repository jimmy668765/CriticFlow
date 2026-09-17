import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { occurrences, projectedOccurrences, prose, type TextAnchor } from "../shared/text-anchor.ts";

export type AnnotationInput = {
  filePath: string;
  originalText: string;
  comment: string;
  action?: "annotate" | "edit" | "delete";
  newComment?: string;
  anchor?: TextAnchor;
};
export type AnnotationResult = {
  success: boolean; savedPath: string | null; fullPath: string | null; error: string | null;
};
const fail = (error: string): AnnotationResult => ({ success: false, savedPath: null, fullPath: null, error });
const delimiters = /\{==|==\}|\{>>|<<\}/;
const MAX_BYTES = 8 * 1024 * 1024;

function inside(file: string, root: string) {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** No text search across the filesystem. The caller must name the document. */
export function validateDocument(filePath: string, roots: string[]): string {
  if (!path.isAbsolute(filePath)) throw new Error("请指定 Markdown 文件的绝对路径");
  const realFile = fs.realpathSync(filePath);
  if (!/\.(md|markdown)$/i.test(realFile)) throw new Error("仅允许批注 Markdown 文件");
  const allowed = roots.some(root => {
    try { return inside(realFile, fs.realpathSync(root)); } catch { return false; }
  });
  if (!allowed) throw new Error("文件不在已注册的 Paseo 工作区内");
  const stat = fs.statSync(realFile);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error("文件类型、硬链接或大小不符合安全写入要求");
  return realFile;
}

/** Exact basename discovery only, returned for visible confirmation before mutation. */
export function locateDocument(hint: string, roots: string[]): AnnotationResult {
  try {
    const name = hint.trim();
    if (path.isAbsolute(name)) {
      const fullPath = validateDocument(name, roots);
      return { success: true, savedPath: path.basename(fullPath), fullPath, error: null };
    }
    if (!/^[^/\\]+\.(md|markdown)$/i.test(name)) return fail("无法识别当前文件，请粘贴完整的 Markdown 文件路径");
    const matches = new Set<string>();
    const seen = new Set<string>();
    let visited = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > 20) throw new Error("目录过深，请直接填写文件绝对路径");
      const real = fs.realpathSync(dir);
      if (seen.has(real)) return;
      seen.add(real);
      if (++visited > 20000) throw new Error("目录过大，请直接填写文件绝对路径");
      for (const entry of fs.readdirSync(real, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || ["node_modules", "dist", "build"].includes(entry.name)) continue;
        const full = path.join(real, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile() && entry.name === name) matches.add(validateDocument(full, roots));
      }
    };
    for (const root of roots) if (fs.existsSync(root)) walk(root, 0);
    if (matches.size !== 1) return fail(matches.size ? "存在多个同名文件，请填写目标文件绝对路径" : "未找到该文件，请填写目标文件绝对路径");
    const fullPath = [...matches][0];
    return { success: true, savedPath: path.basename(fullPath), fullPath, error: null };
  } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
}

export function processAnnotation(input: AnnotationInput, roots: string[], backupDir?: string): AnnotationResult {
  let temp: string | undefined;
  try {
    const target = validateDocument(input.filePath, roots);
    const action = input.action ?? "annotate";
    const text = action === "annotate" ? input.originalText.trim() : input.originalText;
    const comment = action === "annotate" ? input.comment.trim() : input.comment;
    if (!["annotate", "edit", "delete"].includes(action)) throw new Error("未知批注操作");
    if (!text || !comment) throw new Error("原文和批注不能为空");
    if (delimiters.test(text) || delimiters.test(comment) || delimiters.test(input.newComment ?? "")) throw new Error("选区或批注包含 CriticMarkup 分隔符，暂不支持嵌套批注");
    if (action === "edit" && !input.newComment?.trim()) throw new Error("修改后的批注不能为空");
    const before = fs.readFileSync(target, "utf8");
    const oldMarkup = `{==${text}==}{>>${comment}<<}`;
    const needle = action === "annotate" ? text : oldMarkup;
    const comments = [...before.matchAll(/\{>>[\s\S]*?<<\}/g)];
    const inComment = (i: number) => comments.some(m => i >= m.index! && i < m.index! + m[0].length);
    type Candidate = { from: number; to: number };
    const exact: Candidate[] = occurrences(before, needle)
      .filter(i => !inComment(i)).map(from => ({ from, to: from + needle.length }));
    // Reading-mode DOM returns rendered text, not the Markdown bytes. Keep source
    // offsets so formatting/soft-line-break differences do not turn a valid unique
    // selection into "old annotation changed".
    const projected: Candidate[] = action === "annotate"
      ? projectedOccurrences(before, text).filter(c => !inComment(c.from))
      : [];
    const candidates: Candidate[] = [...new Map([...exact, ...projected].map(c => [c.from, c])).values()];
    let selected: Candidate | undefined = candidates.length === 1 ? candidates[0] : undefined;
    if (!candidates.length) throw new Error("原文或旧批注已变化；请重新打开文档（未写入）");
    if (input.anchor) {
      const anchor = input.anchor;
      const left = anchor.before.slice(-24), right = anchor.after.slice(0, 24);
      const contextual = candidates.filter(c => {
        const prefix = prose(before.slice(0, c.from));
        const suffix = prose(before.slice(c.to));
        return (left ? prefix.endsWith(left) : !prefix) && (right ? suffix.startsWith(right) : !suffix);
      });
      // Identical text is distinguished by rendered ordinal only when counts agree.
      const visible = [...new Map<number, Candidate>([
        ...occurrences(before, text).filter(i => !inComment(i)).map(from => [from, { from, to: from + text.length }] as [number, Candidate]),
        ...projected.map(candidate => [candidate.from, candidate] as [number, Candidate]),
      ]).values()].sort((a, b) => a.from - b.from);
      const expected = visible.length === anchor.total ? visible[anchor.occurrence] : undefined;
      const anchored = expected && contextual.find(c => c.from === expected.from);
      selected = anchored ?? (contextual.length === 1 ? contextual[0] : selected);
    }
    if (!selected) throw new Error("选区位置与当前文件不一致，未写入；请重新打开文档后再批注");
    const index = selected.from;
    const sourceLength = selected.to - selected.from;
    if (action === "annotate") {
      // Reject an overlap with any existing annotation, including partial selection of its comment.
      for (const match of before.matchAll(/\{==[\s\S]*?==\}\{>>[\s\S]*?<<\}/g)) {
        if (index < match.index! + match[0].length && selected.to > match.index!) throw new Error("选区与已有批注重叠，请编辑原批注");
      }
    }
    const original = action === "annotate" ? before.slice(index, selected.to) : text;
    const replacement = action === "delete" ? original : `{==${original}==}{>>${action === "edit" ? input.newComment!.trim() : comment}<<}`;
    // Slicing, not String.replace: user text containing $&, $', $` is always literal.
    const after = before.slice(0, index) + replacement + before.slice(index + sourceLength);
    if (after !== before) {
      if (backupDir) {
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const key = createHash("sha256").update(target).update("\0").update(before).digest("hex");
        const backup = path.join(backupDir, `${key}.md`);
        try { fs.writeFileSync(backup, before, { flag: "wx", mode: 0o600 }); }
        catch (error: any) { if (error.code !== "EEXIST") throw error; }
      }
      const stat = fs.statSync(target);
      temp = path.join(path.dirname(target), `.criticflow-${randomUUID()}.tmp`);
      const fd = fs.openSync(temp, "wx", stat.mode & 0o777);
      try { fs.writeFileSync(fd, after, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // Detect observed external changes during preparation. This is NOT an OS-level
      // compare-and-swap: a non-cooperating editor can still write between check and rename.
      if (fs.readFileSync(target, "utf8") !== before || fs.statSync(target).ino !== stat.ino) throw new Error("保存期间文件发生变化，请刷新后重试");
      fs.renameSync(temp, target);
      temp = undefined;
    }
    return { success: true, savedPath: path.basename(target), fullPath: target, error: null };
  } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
  finally { if (temp) { try { fs.unlinkSync(temp); } catch {} } }
}
