import Link from 'next/link';
import type { SupportTopic } from '@daisy/protocol/support-message';
import { supportTopicNote } from '../../features/support/topic-note';

/** The note under the topic choice: nothing, the Report pointer, or the Settings link. */
export function SupportTopicNoteText({
  topic,
}: {
  readonly topic: SupportTopic;
}) {
  const note = supportTopicNote(topic);
  switch (note.kind) {
    case 'none':
      return null;
    case 'report':
      return <p>{note.text}</p>;
    case 'settings':
      return (
        <p>
          {note.text} <Link href={note.link.href}>{note.link.label}</Link>.
        </p>
      );
  }
}
