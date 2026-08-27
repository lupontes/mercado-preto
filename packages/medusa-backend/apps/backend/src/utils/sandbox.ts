export function isSandboxMode(): boolean {
  return process.env.MARKETPLACE_SANDBOX !== "false"
}
