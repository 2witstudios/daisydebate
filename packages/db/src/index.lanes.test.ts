import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isCapacityRefusal } from './capacity';
import { WORKLOAD_PROFILES, createDatabase } from './index';
import { fakeSql } from './index.test-support';

setupRitewayBun();

const { audience: _taken, ...withoutAudience } = WORKLOAD_PROFILES.web.lanes;
/** With no audience lane, an operation on it refuses and any other reaches the client. */
const database = createDatabase({
  url: 'postgres://daisy:test@localhost:5432/daisy_test',
  client: fakeSql([]).client,
  nextActorId: () => 'a'.repeat(24),
  profile: { ...WORKLOAD_PROFILES.web, lanes: withoutAudience },
});
const clock = { now: '2026-11-03T00:00:00.000Z', rankedDelaySeconds: 60 };
const id = 'a'.repeat(24);
const refusedByLane = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch (error) {
    return isCapacityRefusal(error);
  }
};

test('every read a viewer polls is on the audience lane', async () => {
  assert({
    given: 'the timeline, chat and reactions, on-air, link and Live reads',
    should: 'each refuse when the audience lane is gone',
    actual: await Promise.all(
      [
        () =>
          database.readSpectatorTimeline({
            roundId: id,
            horizonOf: () => null,
          }),
        () => database.readAudienceSnapshot({ roundId: id }),
        () => database.readOnAirAudience({ roundId: id }),
        () => database.readRoundAudienceLink(id),
        () => database.readLiveRoomStanding({ roundId: id, actorId: id }),
        () => database.countLiveBroadcasts({ clock }),
        () =>
          database.listLiveBroadcasts({
            filter: { mode: 'any', q: '' },
            before: '',
            clock,
            limit: 1,
          }),
      ].map(refusedByLane),
    ),
    expected: Array(7).fill(true),
  });
});

test('nothing a Room or its host needs waits on the audience lane', async () => {
  assert({
    given:
      'a Room view’s Watch link, the format reads a Room makes, and a host’s link',
    should: 'never be refused by the audience lane',
    actual: await Promise.all(
      [
        () => database.readWatchableRoundOfRoom(id, clock),
        () => database.getFormat(id),
        () => database.readHostedRoundAudienceLink(id),
        () => database.setRoundAudienceLink({ roundId: id, hash: 'h' }),
      ].map(refusedByLane),
    ),
    expected: Array(4).fill(false),
  });
});
