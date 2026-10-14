import { z } from "zod";

export const changeClassSchema = z.enum([
  "renderer-copy",
  "renderer-behavior",
  "main-preload",
  "gateway-auth-security",
  "deployment-data-access",
]);
export type ChangeClass = z.infer<typeof changeClassSchema>;

export const selfUpdateStateSchema = z.enum([
  "awaiting-approval",
  "approved",
  "promotion-requested",
  "verifying",
  "deployed",
  "rolled-back",
  "failed",
  "cancelled",
]);
export type SelfUpdateState = z.infer<typeof selfUpdateStateSchema>;

export const selfUpdateRecordSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1).max(100),
  targetRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  targetBranch: z.string().min(1).max(200),
  baselineCommit: z.string().regex(/^[0-9a-f]{7,64}$/i),
  candidateCommit: z.string().regex(/^[0-9a-f]{7,64}$/i),
  changedFiles: z.array(z.string().max(1000)).max(1000),
  prompt: z.string().min(1).max(20000),
  changeClass: changeClassSchema,
  state: selfUpdateStateSchema,
  approval: z.object({
    required: z.literal(true),
    approved: z.boolean(),
    actor: z.string().max(200).optional(),
    approvedAt: z.string().optional(),
  }),
  promotion: z.object({
    provider: z.string().min(1).max(100),
    operationId: z.string().max(500).optional(),
    runUrl: z.string().url().optional(),
    requestedAt: z.string().optional(),
    verifiedAt: z.string().optional(),
  }),
  healthUrl: z.string().url().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().max(4000).optional(),
});
export type SelfUpdateRecord = z.infer<typeof selfUpdateRecordSchema>;

export type ApprovalPolicy = {
  autoApply: false;
  requiresSecurityReview: boolean;
  requiresExplicitPromotion: true;
};

export function classifyChange(
  changedFiles: string[],
  prompt: string,
): ChangeClass {
  const values = [...changedFiles, prompt].map((value) => value.toLowerCase());
  if (
    values.some((value) =>
      /(secret|token|credential|auth|permission|access|gateway|security|cookie)/.test(
        value,
      ),
    )
  )
    return "gateway-auth-security";
  if (
    values.some((value) =>
      /(deploy|deployment|workflow|cloudflare|dns|production|database|delete|migration)/.test(
        value,
      ),
    )
  )
    return "deployment-data-access";
  if (values.some((value) => /(^|[/\\])(main|preload)([/\\]|\.|$)/.test(value)))
    return "main-preload";
  if (
    values.every(
      (value) =>
        /\.(md|txt|json)$/.test(value) || /copy|label|text/.test(value),
    )
  )
    return "renderer-copy";
  return "renderer-behavior";
}

export function approvalPolicy(changeClass: ChangeClass): ApprovalPolicy {
  return {
    autoApply: false,
    requiresSecurityReview:
      changeClass === "gateway-auth-security" ||
      changeClass === "deployment-data-access",
    requiresExplicitPromotion: true,
  };
}

export function isSafeHealthUrl(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost"
  );
}
