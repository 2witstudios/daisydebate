import type { RoomTemplate } from '../../rooms/read-catalog';

/** The topic a challenge room opens with; the host edits it on the room page. */
const CHALLENGE_TOPIC = 'Open topic: agree on a resolution in the room';

/**
 * The room a Challenge creates (ADR 0072): unlisted, so only its invite
 * link reaches it, on the catalog's first template with that template's
 * own defaults, named for the two members.
 */
export function challengeRoomForm({
  viewer,
  friend,
  template,
  commandId,
}: {
  readonly viewer: string;
  readonly friend: string;
  readonly template: RoomTemplate;
  readonly commandId: string;
}): FormData {
  const form = new FormData();
  form.set('commandId', commandId);
  form.set('title', `@${viewer} vs @${friend}`);
  form.set('topic', CHALLENGE_TOPIC);
  form.set('visibility', 'unlisted');
  form.set(
    'selection',
    JSON.stringify({
      kind: 'catalog',
      formatId: template.formatId,
      formatVersion: template.formatVersion,
      competitionType: 'casual',
      config: template.defaultConfig,
    }),
  );
  return form;
}
