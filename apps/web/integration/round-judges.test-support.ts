import type { withRoomRuntime } from './room-runtime.test-support';

/** Actual custom Room admission shared by human and bot judge finalization proofs. */
export async function assembleJudgedRoom(
  fixture: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  judges: number,
) {
  const choice = await fixture.foundation();
  return fixture.assemble({
    selection: {
      kind: 'custom',
      definition: {
        ...choice.definition,
        seats: { ...choice.definition.seats, judge: judges },
      },
      config: choice.preset.config,
      competitionType: 'casual',
    },
  });
}
