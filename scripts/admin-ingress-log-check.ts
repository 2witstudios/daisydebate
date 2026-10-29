/** Refuse sensitive daemon diagnostics without echoing either captured stream. */
export function assertPrivateIngressLogs(logs: {
  readonly stdout: string;
  readonly stderr: string;
}): void {
  if (
    /login\.tailscale|https:\/\/.*\/a\//i.test(`${logs.stdout}\n${logs.stderr}`)
  )
    throw new Error('Ingress logged an authentication URL');
}
