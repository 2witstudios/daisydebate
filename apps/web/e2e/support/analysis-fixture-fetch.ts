import { OPENROUTER_E2E_PLACEHOLDER } from '@daisy/ai-voice/testing';
import { sampleRoundAnalysisReport } from '@daisy/protocol/round-analysis-testing';

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
/** Only the named browser fixture model is answered locally; production fetch stays unchanged. */
export function withAnalysisFixture(
  apiKey: string | undefined,
  fetch: Fetch,
): Fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (
      apiKey === OPENROUTER_E2E_PLACEHOLDER &&
      url === 'https://openrouter.ai/api/v1/chat/completions' &&
      typeof init?.body === 'string'
    ) {
      const body = JSON.parse(init.body) as { model?: string };
      if (body.model === 'e2e/round-analysis')
        return Response.json({
          choices: [
            {
              message: { content: JSON.stringify(sampleRoundAnalysisReport) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
    }
    return fetch(input, init);
  };
}
