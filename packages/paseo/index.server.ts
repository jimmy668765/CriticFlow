import type { PluginServerContext } from "@getpaseo/plugin/server";
import { annotateDocumentRpc } from "./shared/rpc";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

const WORKSPACE_ROOT =
  process.env.PASEO_WORKSPACE ||
  "/Users/jermy/Desktop/shuijing/14.paseo纯对话";

const ANNOTATE_HTTP_PORT = 29789;

/**
 * Locate target Markdown file containing the original text in the workspace.
 */
function findMarkdownFileWithText(baseDir: string, textToFind: string): string | null {
  const cleanText = textToFind.trim();
  if (!cleanText) return null;

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });

    // Priority 1: Check demo-review.md first
    const demoPath = path.join(baseDir, "demo-review.md");
    if (fs.existsSync(demoPath)) {
      try {
        if (fs.readFileSync(demoPath, "utf-8").includes(cleanText)) {
          return demoPath;
        }
      } catch {}
    }

    // Priority 2: Check other .md files in workspace root
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "demo-review.md") {
        const fullPath = path.join(baseDir, entry.name);
        try {
          if (fs.readFileSync(fullPath, "utf-8").includes(cleanText)) {
            return fullPath;
          }
        } catch {}
      }
    }

    // Priority 3: Check immediate subdirectories (excluding node_modules / .git)
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        const subDir = path.join(baseDir, entry.name);
        try {
          const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile() && sub.name.endsWith(".md")) {
              const subPath = path.join(subDir, sub.name);
              if (fs.readFileSync(subPath, "utf-8").includes(cleanText)) {
                return subPath;
              }
            }
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error("[quote-selection server] readdir error:", err);
  }

  return null;
}

function processAnnotation(input: {
  filePath?: string;
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

  const workspaceDir = WORKSPACE_ROOT;
  let targetFile = input.filePath;

  if (!targetFile || !fs.existsSync(targetFile)) {
    targetFile = findMarkdownFileWithText(workspaceDir, textToAnnotate) || undefined;
  }

  if (!targetFile) {
    const demoPath = path.join(workspaceDir, "demo-review.md");
    if (fs.existsSync(demoPath)) {
      targetFile = demoPath;
    }
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    return {
      success: false,
      savedPath: null,
      error: "未在工作区找到对应的 Markdown 文件",
    };
  }

  try {
    const fileContent = fs.readFileSync(targetFile, "utf-8");
    let updatedContent = fileContent;

    if (action === "delete") {
      // Revert {==text==}{>>comment<<} back to text
      const criticTarget = `{==${textToAnnotate}==}{>>${cleanComment}<<}`;
      if (fileContent.includes(criticTarget)) {
        updatedContent = fileContent.replace(criticTarget, textToAnnotate);
      } else {
        // Loose regex match if whitespace varied
        const looseRegex = new RegExp(`\\{==\\s*${escapeRegExp(textToAnnotate)}\\s*==\\}\\{>>[\\s\\S]*?<<\\}`, "g");
        updatedContent = fileContent.replace(looseRegex, textToAnnotate);
      }
      fs.writeFileSync(targetFile, updatedContent, "utf-8");
      console.log(`[quote-selection server] Reverted annotation in: ${targetFile}`);
      return { success: true, savedPath: path.basename(targetFile), error: null };
    }

    if (action === "edit" && input.newComment) {
      const criticOld = `{==${textToAnnotate}==}{>>${cleanComment}<<}`;
      const criticNew = `{==${textToAnnotate}==}{>>${input.newComment.trim()}<<}`;
      if (fileContent.includes(criticOld)) {
        updatedContent = fileContent.replace(criticOld, criticNew);
      }
      fs.writeFileSync(targetFile, updatedContent, "utf-8");
      console.log(`[quote-selection server] Edited annotation in: ${targetFile}`);
      return { success: true, savedPath: path.basename(targetFile), error: null };
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

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function contribute(server: PluginServerContext) {
  // 1. Register Paseo native RPC
  server.handle(annotateDocumentRpc, async (input) => {
    return processAnnotation(input);
  });

  // 2. Start lightweight local HTTP bridge for bulletproof zero-delay IPC from webview
  let httpServer: http.Server | null = null;
  try {
    httpServer = http.createServer((req: any, res: any) => {
      // CORS headers
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
    console.warn("[quote-selection server] Could not bind HTTP port, relying on native RPC:", e);
  }

  return () => {
    if (httpServer) {
      httpServer.close();
    }
  };
}
