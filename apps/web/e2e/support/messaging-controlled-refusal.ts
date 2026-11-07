import type { Route, TestInfo } from '@playwright/test';
import { boundedStep } from './bounded-step';
import { advisedRecoveryResponse } from './messaging-refusal-flight';

/** Read exactly one real authorized Flight; callers own when its exact bytes are released. */
export async function readControlledRefusal(
  route: Route,
  info: TestInfo,
  budget: number,
) {
  if (budget <= 0)
    throw new Error(
      'Controlled recovery delivery exceeded its existing budget',
    );
  return boundedStep(
    'the actual controlled refusal read',
    async () => {
      const response = await route.fetch({
        timeout: budget,
        maxRetries: 0,
        maxRedirects: 0,
      });
      const advice = advisedRecoveryResponse({
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        payload: await response.text(),
      });
      await info.attach('controlled-refusal-response-safe', {
        contentType: 'application/json',
        body: JSON.stringify({
          outerStatus: response.status(),
          advisedFlight: advice !== null,
        }),
      });
      if (advice === null)
        throw new Error(
          'Controlled recovery did not receive an advised Flight response',
        );
      return { response, advice };
    },
    budget,
  );
}
