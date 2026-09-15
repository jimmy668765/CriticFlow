import type { PluginServerContext } from "@getpaseo/plugin/server";
import { annotateDocumentRpc, readDocumentAnnotationsRpc } from "./shared/rpc";
import { validateDocument } from "./server/annotation-store";
import { processWorkspaceAnnotation } from "./server/workspace-annotation";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const paseoHome = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");

export default function contribute(server: PluginServerContext) {
  server.handle(readDocumentAnnotationsRpc, input => {
    const registry = JSON.parse(fs.readFileSync(path.join(paseoHome, "projects", "workspaces.json"), "utf8"));
    const workspace = Array.isArray(registry) && registry.find(w => w.workspaceId === input.workspaceId && !w.archivedAt);
    if (!workspace || !path.isAbsolute(workspace.cwd)) throw new Error("文档所属工作区不可用");
    const target = validateDocument(path.resolve(workspace.cwd, input.filePath), [workspace.cwd]);
    const contents = fs.readFileSync(target, "utf8");
    return { annotations: [...contents.matchAll(/\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g)]
      .map(match => ({ originalText: match[1], comment: match[2] })) };
  });
  server.handle(annotateDocumentRpc, input => {
    try {
      const registry = JSON.parse(fs.readFileSync(path.join(paseoHome, "projects", "workspaces.json"), "utf8"));
      if (!Array.isArray(registry)) throw new Error("Invalid workspace registry");
      return processWorkspaceAnnotation(input, registry, path.join(paseoHome, "plugin-state", "quote-selection", "backups"));
    } catch {
      return { success: false, savedPath: null, fullPath: null, error: "无法读取当前工作区信息，未保存" };
    }
  });
  console.log("[quote-selection] RPC ready; current-document/workspace binding enabled");
  return () => {};
}
