import { assert, setupRitewayBun, test } from 'riteway/bun';
import { projectLeagueCalendar } from './league-calendar';
setupRitewayBun();
test('automatic membership calendar uses admitted event times', () => {
  const startsAt = new Date('2027-03-06T09:30:00.000Z');
  const actual = projectLeagueCalendar(
    {
      calendar: [],
      events: [],
      automaticCalendar: [
        {
          lobby: {
            id: 'actual-lobby',
            handle: 'actual-event',
            name: 'Actual tournament',
          },
          event: { id: 'event' },
          templateId: 'varsity',
          startsAt,
          certifiedAt: '2027-03-06T12:00:00.000Z',
        },
        {
          lobby: { id: 'other', handle: 'other', name: 'Other series' },
          event: { id: 'other-event' },
          templateId: 'other-template',
          startsAt,
          certifiedAt: null,
        },
      ],
    } as never,
    'varsity',
  );
  assert({
    given:
      'actual automatically admitted membership events with the stored first-slot time',
    should:
      'include only the selected series with its actual address/time and no fabricated sanction',
    actual,
    expected: [
      {
        lobbyId: 'actual-lobby',
        handle: 'actual-event',
        name: 'Actual tournament',
        when: { precision: 'day', startsAt: '2027-03-06T09:30:00.000Z' },
        completed: true,
        sanction: null,
      },
    ],
  });
});
