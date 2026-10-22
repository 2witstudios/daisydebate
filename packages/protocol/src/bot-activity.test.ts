import { assert, setupRitewayBun, test } from 'riteway/bun';
import { botActivityBatchSchema, botActivityRelaySchema } from './bot-activity';
import { botActivityFixture } from './bot-activity.test-support';
setupRitewayBun();
test('activity transport bounds original frames and rejects body authority or unpaired windows', () => {
  const batch = botActivityFixture(
    'abcdefghijklmnopqrstuvwx',
    'mnopqrstuvwxabcdefghijkl',
  );
  const frame = batch.frames[0]!;
  assert({
    given:
      'one valid original160-sample raw frame and authentic receipt envelope',
    should: 'accept the bounded JSON contract',
    actual: botActivityBatchSchema.safeParse(batch).success,
    expected: true,
  });
  const invalid = [
    { ...batch, frames: Array(21).fill(frame) },
    { ...batch, frames: [{ ...frame, pcm: [0] }] },
    { ...batch, frames: [{ ...frame, pcm: Array(160).fill(32768) }] },
    { ...batch, frames: [{ ...frame, afterMs: 9 }] },
    {
      ...batch,
      frames: [
        {
          ...frame,
          serverWindow: {
            before: frame.receivedAt,
            after: frame.serverWindow.before,
          },
        },
      ],
    },
    { ...batch, frames: [{ ...frame, serviceId: 'claimed-authority' }] },
    { ...batch, token: 'secret' },
    { ...batch, frames: [] },
  ];
  assert({
    given: 'oversized, malformed or body-authority activity',
    should: 'refuse every variation before routing',
    actual: invalid.map(
      (value) => botActivityBatchSchema.safeParse(value).success,
    ),
    expected: Array(invalid.length).fill(false),
  });
});
test('relay ingress carries only original frames, never a receipt or Round claim', () => {
  const { roundParticipantId, frames } = botActivityFixture(
    'abcdefghijklmnopqrstuvwx',
    'mnopqrstuvwxabcdefghijkl',
  );
  const { receivedAt, ...original } = frames[0]!;
  const relay = {
    version: 1,
    roundParticipantId,
    segmentId: 'qrstuvwxabcdefghijklmnop',
    frames: [original],
  };
  assert({
    given: 'a signed worker body with original brackets and calibrated bounds',
    should: 'accept it for server-side receipt attachment',
    actual: botActivityRelaySchema.safeParse(relay).success,
    expected: true,
  });
  const invalid = [
    { ...relay, frames: [{ ...original, receivedAt }] },
    { ...relay, roundId: 'abcdefghijklmnopqrstuvwx' },
    { ...relay, frames: [{ ...original, beforeMs: 12 }] },
    { ...relay, frames: Array(21).fill(original) },
    { ...relay, segmentId: undefined },
  ];
  assert({
    given:
      'a body-supplied receipt, Round claim, inverted bracket, oversize or no segment',
    should: 'refuse each before admission',
    actual: invalid.map(
      (value) => botActivityRelaySchema.safeParse(value).success,
    ),
    expected: Array(invalid.length).fill(false),
  });
});
