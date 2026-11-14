import { linkTo, sampleAction, type TabAction } from '../action';
import { tabRoutes } from '../routes';
import type { AttentionRoom, RunningRound } from '../tab-round';
import { eventSwitch } from './event-switch';
import { AUTUMN, IMPROMPTU, reached } from './moment';
import type { SampleScene } from './scene';

const room = (
  title: string,
  detail: string,
  action: TabAction,
): AttentionRoom => ({ title, detail, action });

const result = sampleAction('Result');

const sectionsFinished: readonly AttentionRoom[] = [
  room(
    'Section E',
    'Room 29 · Judges N. Varga and B. Achebe · 1st Hana Kim · 2nd Tomas Ruiz · 3rd Noor Aziz',
    result,
  ),
  room(
    'Section F',
    'Room 30 · five speakers · Judges C. Moreau and I. Tanaka · 1st Sam Ortega · 2nd Ivy Lund · 3rd Kofi Mensah',
    result,
  ),
];

/** A speech event's round: sections of speakers ranked by two judges. */
export function speechRound(
  round: string,
  scene: SampleScene,
): RunningRound | null {
  if (round !== '3' || !reached(scene, 'prelims')) return null;
  const running = !reached(scene, 'break');
  return {
    event: eventSwitch(scene, IMPROMPTU),
    title: 'Round 3',
    lede: running
      ? '6 sections · 35 speakers · started 13:40 · running 10 minutes late'
      : '6 sections · 35 speakers · started 13:40 · every ballot is in',
    participantView: linkTo(
      'View as participant',
      tabRoutes.tournament(AUTUMN),
    ),
    next: sampleAction("Open the final's draw", true),
    groups: running
      ? [
          {
            attention: 'needs_you',
            count: null,
            rooms: [
              room(
                'Section D',
                'Room 28 · all six have spoken · Judge K. Osei has not opened the ballot · 12 minutes overdue',
                sampleAction('Replace judge', true),
              ),
              room(
                'Section B',
                'Dana Abara asked to let Leo Brandt speak again after his connection dropped. He is from her school, so a second person confirms.',
                sampleAction('Review and confirm', true),
              ),
            ],
            more: null,
          },
          {
            attention: 'live',
            count: null,
            rooms: [
              room(
                'Section A',
                'Room 25 · Judges R. Lindqvist and D. Marsh · Priya Nair speaking, 4th of 6',
                sampleAction('Watch'),
              ),
            ],
            more: null,
          },
          {
            attention: 'judging',
            count: null,
            rooms: [
              room(
                'Section C',
                'Room 27 · Judges H. Okonkwo and J. Pruitt · 1 of 2 ballots in · open 5 minutes',
                sampleAction('Open room'),
              ),
            ],
            more: null,
          },
          {
            attention: 'finished',
            count: 2,
            rooms: sectionsFinished,
            more: null,
          },
        ]
      : [
          {
            attention: 'finished',
            count: 6,
            rooms: sectionsFinished,
            more: sampleAction('Show 4 more'),
          },
        ],
  };
}
