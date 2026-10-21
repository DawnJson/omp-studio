// omp `tools.approvalMode` 的取值（`omp config list` 里 enum 选项实测 18.12.5：always-ask|always-ask-cached|write|yolo）。
import type { ApprovalMode } from "./ipc.ts";

export const approvalModes: readonly ApprovalMode[] = ["always-ask", "always-ask-cached", "write", "yolo"];

/** omp 给的值是已知档位就返回它，否则 null（比如 omp 以后新增了档位）。 */
export function toApprovalMode(value: unknown): ApprovalMode | null {
  return approvalModes.find((mode) => mode === value) ?? null;
}
