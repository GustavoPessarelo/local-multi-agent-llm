export type ExecutionRequest = { command: string[]; cwd: string; network: boolean };

/**
 * Security boundary for the future sandbox runner. This server deliberately
 * does not expose arbitrary command execution until a sandbox and user
 * approval flow are connected.
 */
export function validateExecution(request: ExecutionRequest) {
  if (!request.command.length) return { allowed: false, reason: "Nenhum comando foi informado." };
  if (request.network) return { allowed: false, reason: "Acesso à rede exige aprovação explícita." };
  return { allowed: false, reason: "Executor isolado ainda não foi configurado." };
}
