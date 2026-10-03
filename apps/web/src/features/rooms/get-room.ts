import { sampleRooms } from '../../ui/mock/rooms';
import { presetIds } from './state';
import { presetFor } from './state';
import type { RoomInfo } from './view';

const presetInfo: Readonly<
  Record<(typeof presetIds)[number], Omit<RoomInfo, 'id' | 'judge'>>
> = {
  created: { title: 'Your practice room', mode: 'practice', hostHandle: 'you' },
  'created-ai': {
    title: 'Your practice room',
    mode: 'practice',
    hostHandle: 'you',
  },
  'needs-judge': {
    title: 'Looking for a judge',
    mode: 'practice',
    hostHandle: 'host-two',
  },
  'ai-judge': {
    title: 'A quick round with the AI judge',
    mode: 'practice',
    hostHandle: 'host-four',
  },
  rematch: { title: 'Rematch table', mode: 'practice', hostHandle: 'host-two' },
  started: {
    title: 'Evening round, under way',
    mode: 'practice',
    hostHandle: 'host-two',
  },
  closed: {
    title: 'Saturday warm-up',
    mode: 'practice',
    hostHandle: 'host-two',
  },
  private: { title: 'Private room', mode: 'practice', hostHandle: 'host-two' },
};

const isPreset = (id: string): id is (typeof presetIds)[number] =>
  (presetIds as readonly string[]).includes(id);

/**
 * The room page's one data seam: what a room is called, what kind it is and
 * who hosts it. Today it knows the sample rooms (the lobby's open tables and
 * the demo rooms); the backend read replaces this function and nothing else.
 * An unknown id is not a room.
 */
export function getRoomInfo(id: string, now: string): RoomInfo | null {
  if (isPreset(id))
    return { id, ...presetInfo[id], judge: presetFor(id).judgeKind };
  const room = sampleRooms(now).find(
    (candidate) => candidate.id === id && candidate.status === 'open',
  );
  return room === undefined
    ? null
    : {
        id,
        title: room.name,
        mode: room.mode === 'ranked' ? 'ranked' : 'practice',
        hostHandle: room.host.handle,
        judge: room.judge,
      };
}
