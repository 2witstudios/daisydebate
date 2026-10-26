import { assert, setupRitewayBun, test } from 'riteway/bun';
import { commandRunAuthority } from './round-write-authority';

setupRitewayBun();

const run = {
  id: 'run',
  participantId: 'seat',
  serviceId: 'svc',
  active: true,
};
const unboundWorker = {
  principal: { kind: 'human' as const, actorId: 'actor' },
  claim: null,
  kind: null,
  configuration: null,
  round: { id: 'round', status: 'active' as const, segments: [] },
  now: '2026-10-22T12:00:00.000Z',
};

test('only a command run depends on its live worker binding', () => {
  assert({
    given: 'no run, a ballot run and a command run without a bound worker',
    should:
      'pass the absent and ballot runs through and deactivate the command run',
    actual: [
      commandRunAuthority(null, 'command', unboundWorker),
      commandRunAuthority(run, 'ballot', unboundWorker),
      commandRunAuthority(run, 'command', unboundWorker),
    ],
    expected: [null, run, { ...run, active: false }],
  });
});
