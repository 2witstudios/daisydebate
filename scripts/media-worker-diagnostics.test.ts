import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  captureFailureExit,
  tagCaptureFailure,
} from '../apps/media-worker/src/capture-exit';
import { createAppError } from '@daisy/errors';
import { createCaptureProofDiagnostics } from './media-worker-diagnostics';
setupRitewayBun();
test('a failed hidden join reports only enumerated stage and exit evidence', () => {
  const diagnostics = createCaptureProofDiagnostics();
  diagnostics.observe(
    JSON.stringify({
      event: 'media.capture.failed',
      status: captureFailureExit(
        tagCaptureFailure('token', createAppError('INFRASTRUCTURE')),
      ),
      message: 'private transcript and secret',
    }),
  );
  diagnostics.observe(
    JSON.stringify({ event: 'server.shutdown', cause: 'postgres://secret' }),
  );
  diagnostics.observe('native raw secret');
  assert({
    given: 'a staged child failure and untrusted or malformed log text',
    should: 'name the failed stage and code without including raw text',
    actual: diagnostics.failure(1),
    expected:
      'Capture proof hidden-join failed: worker exit 1; capture token/INFRASTRUCTURE',
  });
});
