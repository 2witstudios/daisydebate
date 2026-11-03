import type { MediaEffect } from './media-effects';
import type { MediaEvent } from './media-events';
import {
  admissionReconnects,
  type MediaLink,
  type MediaState,
  type SourceState,
} from './media-state';

const sourceShape = (source: SourceState) => {
  if (source.phase === 'capturing' && source.waiting)
    return 'capturing(past patience)';
  if (source.phase === 'failed' && source.removingSinceMs !== null)
    return 'failed(removing)';
  if (source.phase === 'published' && source.swapped)
    return 'published(swapped)';
  if (
    (source.phase === 'publishing' || source.phase === 'unpublishing') &&
    source.stuck
  )
    return `${source.phase}(stuck)`;
  if (source.phase === 'unpublishing' && source.keepWarm)
    return 'unpublishing(to warm)';
  return source.phase;
};

const linkShape = (link: MediaLink): string => {
  switch (link.phase) {
    case 'waiting':
      return `waiting(${link.tab})`;
    case 'released':
      return `released(${link.why})`;
    case 'ended':
      return 'ended';
    case 'connecting':
      return link.reconnecting ? 'connecting(again)' : 'connecting';
    case 'admitting':
      return `admitting(${admissionReconnects(link) ? 'again' : 'first'}${
        link.ownRetry ? `,try${link.ownRetry.attempt}` : ''
      }${link.ownRetry?.pausing ? ',pausing' : ''})`;
    case 'live': {
      const { establishment, reads, apply, sources } = link;
      const freshness =
        establishment.stage === 'establishing'
          ? 'establishing'
          : establishment.freshness.status === 'stale'
            ? establishment.freshness.cause === 'definite'
              ? 'stale-definite'
              : establishment.freshness.wakeArmed
                ? 'stale-wake'
                : 'stale'
            : establishment.freshness.status;
      return [
        `live(${freshness})`,
        `cam:${sourceShape(sources.camera)}`,
        `mic:${sourceShape(sources.microphone)}`,
        `read:${reads.flight?.stage ?? 'none'}`,
        `next:${reads.next}`,
        `apply:${apply ? (apply.next ? 'queued' : 'running') : 'none'}`,
        ...(link.changingMicrophone ? ['muting'] : []),
        ...(link.transport === 'resuming' ? ['resuming'] : []),
      ].join(' ');
    }
  }
};

const effectShape = (effect: MediaEffect): string => {
  if (effect.type === 'schedule' || effect.type === 'cancel')
    return `${effect.type}:${effect.timer}`;
  if ('source' in effect) return `${effect.type}:${effect.source}`;
  return effect.type;
};

const EVERY_TIMER_CANCELLED = [
  'cancel:admission-retry',
  'cancel:read-retry',
  'cancel:read-budget',
  'cancel:read-let-finish',
  'cancel:capture-patience',
  'cancel:recovery',
].join(', ');

/** One transition as the table states it: where it leads, and what it asks of the world. */
export const transitionShape = (
  next: MediaState,
  effects: readonly MediaEffect[],
) => {
  const asked = effects
    .map(effectShape)
    .join(', ')
    .replace(EVERY_TIMER_CANCELLED, 'cancel:all');
  return asked === ''
    ? linkShape(next.link)
    : `${linkShape(next.link)} | ${asked}`;
};

/** A name for one event, unique across the table's events. */
export const eventName = (event: MediaEvent): string => {
  const detail = [
    'owns' in event ? (event.owns ?? 'unknown') : undefined,
    'source' in event ? event.source : undefined,
    'failure' in event ? event.failure : undefined,
    'timer' in event ? event.timer : undefined,
    'kind' in event ? event.kind : undefined,
    'checked' in event ? (event.checked ? 'checked' : undefined) : undefined,
    'read' in event ? event.read.kind : undefined,
    'answer' in event ? event.answer.state : undefined,
  ].filter((part) => part !== undefined);
  return [event.type, ...detail].join(' ');
};
