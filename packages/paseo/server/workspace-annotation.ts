import * as path from "node:path";
import { processAnnotation, type AnnotationInput, type AnnotationResult } from "./annotation-store.ts";

type Workspace = { workspaceId: string; cwd: string; archivedAt?: string | null };

/** Resolve only against the selected document's workspace; never search other files or roots. */
export function processWorkspaceAnnotation(
  input: AnnotationInput & { workspaceId: string }, workspaces: Workspace[], backupDir?: string,
): AnnotationResult {
  const workspace = workspaces.find(w => w.workspaceId === input.workspaceId && !w.archivedAt);
  if (!workspace || !path.isAbsolute(workspace.cwd)) return {
    success: false, savedPath: null, fullPath: null, error: "当前文档所属工作区不可用，请重新打开文档",
  };
  const filePath = path.resolve(workspace.cwd, input.filePath);
  return processAnnotation({ ...input, filePath }, [workspace.cwd], backupDir);
}
