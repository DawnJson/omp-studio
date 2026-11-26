/** `deepseek/deepseek-v4-flash` → `deepseek-v4-flash`（完整名放悬停提示）。 */
export function shortModel(model: string): string {
  return model.slice(model.lastIndexOf("/") + 1);
}
