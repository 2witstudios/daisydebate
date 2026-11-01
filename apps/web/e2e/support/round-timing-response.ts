type ActionResponse = {
  request(): {
    method(): string;
    headers(): Record<string, string>;
  };
  text(): Promise<string>;
};

/** Identify a fresh clock-bearing Round action independently of transcript replies. */
export async function isRoundClockResponse(
  response: ActionResponse,
  expectedActionId: string,
): Promise<boolean> {
  if (
    !expectedActionId ||
    response.request().method() !== 'POST' ||
    response.request().headers()['next-action'] !== expectedActionId
  )
    return false;
  return (await response.text()).includes('serverNowMs');
}
