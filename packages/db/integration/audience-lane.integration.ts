import { createFormatsStore } from '../src/stores/formats';
import { createSpectatingStore } from '../src/stores/spectating';
import { WORKLOAD_PROFILES, openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isCapacityRefusal } from '../src/capacity';
import { requireTestServices } from '@daisy/config';
import { afterAll } from 'bun:test';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (options: Parameters<typeof openDatabaseResources>[0]) => {
  const resources = openDatabaseResources(options);
  return {
    ...createFormatsStore(resources),
    ...createSpectatingStore(resources),
    close: resources.close,
  };
};

setupRitewayBun();

/** With no audience lane, an operation on it refuses and any other reaches the client. */
const database = openStores({
  waits: hostWaits,
  url: requireTestServices(process.env).databaseUrl,
  profile: {
    ...WORKLOAD_PROFILES.web,
    lanes: Object.fromEntries(
      Object.entries(WORKLOAD_PROFILES.web.lanes).filter(
        ([name]) => name !== 'audience',
      ),
    ),
  },
});
afterAll(() => database.close());
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
    should: 'use their own lanes even with no audience lane',
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
