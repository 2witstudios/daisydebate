import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { notificationWords } from './notification-words';
setupRitewayBun();
describe('tournament notification words', () => {
  test('affected people have useful destinations without private results', () => {
    const subject = {
      handle: 'spring',
      eventId: 'event',
      tabRoundId: 'round',
      roomId: 'room',
    };
    assert({
      given: 'a tournament assignment, change, Room or released result',
      should:
        'name the change and link to its protected destination without an outcome',
      actual: [
        'judge_assigned',
        'judge_replaced',
        'judge_unassigned',
        'tournament_draw_changed',
        'tournament_room_ready',
        'tournament_results_released',
      ].map((kind) => notificationWords({ ...subject, kind } as never)),
      expected: [
        {
          text: 'You have been assigned to judge.',
          href: '/tournaments/spring/events/event/rounds/round',
        },
        {
          text: 'Your judging assignment has been replaced.',
          href: '/tournaments/spring',
        },
        {
          text: 'You have been unassigned from judging.',
          href: '/tournaments/spring',
        },
        {
          text: 'Your tournament draw has changed.',
          href: '/tournaments/spring/events/event/rounds/round',
        },
        { text: 'Your tournament Room is ready.', href: '/rooms/room' },
        {
          text: 'Your tournament results have been released.',
          href: '/tournaments/spring/standings?event=event',
        },
      ],
    });
  });
});
