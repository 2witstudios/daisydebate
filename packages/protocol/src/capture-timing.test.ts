import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  CAPTURE_STT_LAG_MS,
  TRANSCRIPT_ADMISSION_WINDOW_MS,
} from './capture-timing';
setupRitewayBun();
test('the transcript cutoff covers the derived speech-to-text lag', () => {
  assert({
    given: "the worker's per-clip deadlines",
    should:
      'derive a 66.5 s lag that the transcript admission window never undercuts',
    actual: [
      CAPTURE_STT_LAG_MS,
      TRANSCRIPT_ADMISSION_WINDOW_MS >= CAPTURE_STT_LAG_MS,
    ],
    expected: [66_500, true],
  });
});
