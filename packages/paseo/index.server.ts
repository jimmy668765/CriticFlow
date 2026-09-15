import type { PluginServerContext } from "@getpaseo/plugin/server";
import { annotateDocumentRpc } from "./shared/rpc";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

const ANNOTATE_HTTP_PORT = 29789;

/**
 * Collect all registered project roots and workspaces dynamically from ~/.paseo
 */
function getAllWorkspaceRoots(): string[] {
  const roots = new Set<string>();
  
  if (process.env.PASEO_WORKSPACE) {
    roots.add(process.env.PASEO_WORKSPACE);
  }
  
  const homeDir = process.env.HOME || "/Users/jermy";
  const paseoDir = path.join(homeDir, ".paseo");

  // Read all projects from Paseo
  const projectsJson = path.join(paseoDir, "projects", "projects.json");
  if (fs.existsSync(projectsJson)) {
    try {
      const projects = JSON.parse(fs.readFileSync(projectsJson, "utf-8"));
      if (Array.isArray(projects)) {
        for (const p of projects) {
          if (p.rootPath && fs.existsSync(p.rootPath)) {
            roots.add(p.rootPath);
          }
        }
      }
    } catch {}
  }

  // Read all workspaces from Paseo
  const workspacesJson = path.join(paseoDir, "projects", "workspaces.json");
  if (fs.existsSync(workspacesJson)) {
    try {
      const workspaces = JSON.parse(fs.readFileSync(workspacesJson, "utf-8"));
      if (Array.isArray(workspaces)) {
        for (const w of workspaces) {
          if (w.cwd && fs.existsSync(w.cwd)) {
            roots.add(w.cwd);
          }
        }
      }
    } catch {}
  }

  roots.add(path.join(homeDir, "Desktop", "shuijing"));
  roots.add(path.join(homeDir, "Desktop", "03_公司主体与合同"));
  return Array.from(roots);
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate target Markdown file containing the original text across all workspaces.
 */
function findMarkdownFileWithText(textToFind: string, fileHint?: string): string | null {
  const cleanText = textToFind.trim();
  if (!cleanText) return null;

  const roots = getAllWorkspaceRoots();
  const visitedDirs = new Set<string>();

  function collectMdFiles(dir: string, depth = 0, maxDepth = 6): string[] {
    if (depth > maxDepth || visitedDirs.has(dir)) return [];
    visitedDirs.add(dir);

    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".markdown"))) {
          files.push(full);
        } else if (entry.isDirectory()) {
          files.push(...collectMdFiles(full, depth + 1, maxDepth));
        }
      }
    } catch {}
    return files;
  }

  const allFiles: string[] = [];
  for (const root of roots) {
    allFiles.push(...collectMdFiles(root));
  }

  // 1. If fileHint provided, prioritize matching files
  const hint = fileHint ? path.basename(fileHint).replace(/\.\.\.$/, "").trim() : "";
  if (hint) {
    for (const file of allFiles) {
      if (path.basename(file) === "demo-review.md") continue;
      const bname = path.basename(file);
      if (bname.includes(hint) || hint.includes(bname.replace(/\.md$/, ""))) {
        try {
          if (fs.readFileSync(file, "utf-8").includes(cleanText)) {
            return file;
          }
        } catch {}
      }
    }
  }

  // 2. Scan all markdown files for text match
  for (const file of allFiles) {
    if (path.basename(file) === "demo-review.md") continue;
    try {
      if (fs.readFileSync(file, "utf-8").includes(cleanText)) {
        return file;
      }
    } catch {}
  }

  return null;
}

function processAnnotation(input: {
  filePath?: string;
  fileHint?: string;
  originalText: string;
  comment: string;
  action?: "annotate" | "delete" | "edit";
  newComment?: string;
}) {
  const textToAnnotate = input.originalText.trim();
  const cleanComment = input.comment.trim();
  const action = input.action || "annotate";

  if (!textToAnnotate) {
    return { success: false, savedPath: null, error: "缺少原文内容" };
  }

  let targetFile = input.filePath;

  if (!targetFile || !fs.existsSync(targetFile)) {
    targetFile = findMarkdownFileWithText(textToAnnotate, input.fileHint) || undefined;
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    return {
      success: false,
      savedPath: null,
      error: "未在任何已注册的工作区中找到包含该选区文本的 Markdown 文件",
    };
  }

  try {
    const fileContent = fs.readFileSync(targetFile, "utf-8");
    let updatedContent = fileContent;

    if (action === "delete") {
      const criticTarget = `{==${textToAnnotate}==}{>>${cleanComment}<<}`;
      if (fileContent.includes(criticTarget)) {
        updatedContent = fileContent.replace(criticTarget, textToAnnotate);
      } else {
        const looseRegex = new RegExp(`\\{==\\s*${escapeRegExp(textToAnnotate)}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
        updatedContent = fileContent.replace(looseRegex, textToAnnotate);
      }
      fs.writeFileSync(targetFile, updatedContent, "utf-8");
      console.log(`[quote-selection server] Reverted annotation in: ${targetFile}`);
      return { success: true, savedPath: path.basename(targetFile), fullPath: targetFile, error: null };
    }

    if (action === "edit" && input.newComment) {
      const criticOld = `{==${textToAnnotate}==}{>>${cleanComment}<<}`;
      const criticNew = `{==${textToAnnotate}==}{>>${input.newComment.trim()}<<}`;
      if (fileContent.includes(criticOld)) {
        updatedContent = fileContent.replace(criticOld, criticNew);
      }
      fs.writeFileSync(targetFile, updatedContent, "utf-8");
      console.log(`[quote-selection server] Edited annotation in: ${targetFile}`);
      return { success: true, savedPath: path.basename(targetFile), fullPath: targetFile, error: null };
    }

    // Default: Add annotation
    const criticReplacement = `{==${textToAnnotate}==}{>>${cleanComment}<<}`;
    if (fileContent.includes(textToAnnotate)) {
      updatedContent = fileContent.replace(textToAnnotate, criticReplacement);
    } else {
      updatedContent = `${fileContent}\n\n${criticReplacement}\n`;
    }

    fs.writeFileSync(targetFile, updatedContent, "utf-8");
    const fileName = path.basename(targetFile);
    console.log(`[quote-selection server] Wrote annotation into: ${targetFile}`);

    return {
      success: true,
      savedPath: fileName,
      fullPath: targetFile,
      error: null,
    };
  } catch (err: any) {
    console.error("[quote-selection server] file write error:", err);
    return {
      success: false,
      savedPath: null,
      error: err?.message || String(err),
    };
  }
}

export default function contribute(server: PluginServerContext) {
  server.handle(annotateDocumentRpc, async (input) => {
    return processAnnotation(input);
  });

  let httpServer: http.Server | null = null;
  try {
    httpServer = http.createServer((req: any, res: any) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/annotate") {
        let body = "";
        req.on("data", (chunk: any) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const result = processAnnotation(data);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (e: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: e?.message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    httpServer.listen(ANNOTATE_HTTP_PORT, "127.0.0.1", () => {
      console.log(`[quote-selection server] Local HTTP bridge listening on 127.0.0.1:${ANNOTATE_HTTP_PORT}`);
    });
  } catch (e) {
    console.warn("[quote-selection server] Could not bind HTTP port:", e);
  }

  return () => {
    if (httpServer) {
      httpServer.close();
    }
  };
}
