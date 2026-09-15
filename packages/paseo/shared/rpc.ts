import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const result = z.object({
  success: z.boolean(),
  savedPath: z.string().nullable(),
  fullPath: z.string().nullable(),
  error: z.string().nullable(),
});

export const readDocumentAnnotationsRpc = defineRpc({
  name: "read-document-annotations",
  input: z.object({ filePath: z.string().min(1).max(4096), workspaceId: z.string().regex(/^wks_[a-zA-Z0-9_-]+$/) }),
  output: z.object({ annotations: z.array(z.object({ originalText: z.string(), comment: z.string() })) }),
});

export const annotateDocumentRpc = defineRpc({
  name: "annotate-document",
  input: z.object({
    filePath: z.string().min(1).max(4096),
    workspaceId: z.string().regex(/^wks_[a-zA-Z0-9_-]+$/),
    originalText: z.string().min(1).max(100000),
    comment: z.string().min(1).max(20000),
    action: z.enum(["annotate", "edit", "delete"]).optional(),
    newComment: z.string().max(20000).optional(),
    anchor: z.object({
      before: z.string().max(96), after: z.string().max(96),
      occurrence: z.number().int().nonnegative(), total: z.number().int().positive(),
    }).optional(),
  }),
  output: result,
});
