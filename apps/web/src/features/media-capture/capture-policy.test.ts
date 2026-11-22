import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureAdmissionPolicy } from './capture-policy';

setupRitewayBun();

test('capture admission preserves strict capture time and inclusive receipt lag', () => {
  const closedAt = new Date('2026-11-02T10:00:01.000Z');
  const session = {
    endedAt: closedAt,
    unsafeAt: null,
    deletionRequestedAt: null,
  };
  const admits = (captureOffset: number, receiptOffset: number) =>
    captureAdmissionPolicy.sessionAdmits(session, {
      capturedUntil: new Date(closedAt.getTime() + captureOffset),
      receivedAt: new Date(closedAt.getTime() + receiptOffset),
      sttLagMs: 100,
    });
  assert({
    given: 'audio at the close boundary and receipts at the lag boundary',
    should:
      'require audio strictly before close and accept receipt exactly at lag end',
    actual: [admits(-1, 100), admits(0, 100), admits(-1, 101)],
    expected: [true, false, false],
  });
});
