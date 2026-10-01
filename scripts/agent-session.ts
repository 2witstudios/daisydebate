/** Whether this process is a fully autonomous agent run (DAISY_AUTONOMOUS=1). */
export const sessionIsAgent = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env.DAISY_AUTONOMOUS === '1';
