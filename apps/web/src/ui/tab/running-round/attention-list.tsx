import type {
  AttentionGroup,
  RoomAttention,
} from '../../../features/tab/tab-round';

const labels: Readonly<Record<RoomAttention, string>> = {
  needs_you: 'Needs you',
  waiting: 'Waiting',
  live: 'Live now',
  judging: 'Judging',
  finished: 'Finished',
};

/** The heading of one attention group, with its count where the list is cut. */
export const attentionHeading = (group: AttentionGroup): string =>
  group.count === null
    ? labels[group.attention]
    : `${labels[group.attention]} · ${group.count}`;
