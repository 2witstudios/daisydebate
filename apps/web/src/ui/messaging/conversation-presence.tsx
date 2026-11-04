'use client';
import { Avatar } from '../components/avatar/avatar';
import { statusLabels } from '../components/presence-dot/status-labels';
import { useOptionalPeople } from '../people/people-provider';

/** The person from the People list, or nothing known about them. */
const usePerson = (username: string | null) =>
  useOptionalPeople()?.list.people.find(
    (person) => person.username === username,
  );

/** A conversation's avatar. Someone not in the loaded People list is unknown, not offline. */
export function ConversationAvatar({
  name,
  username,
}: {
  readonly name: string;
  readonly username: string | null;
}) {
  const person = usePerson(username);
  return (
    <Avatar
      name={name}
      nameVisible
      {...(person ? { presence: person.status } : {})}
    />
  );
}

/** The line under a conversation's name: what is known of them right now. */
export function ConversationStatus({
  username,
}: {
  readonly username: string | null;
}) {
  const person = usePerson(username);
  return person ? <>{statusLabels[person.status]}</> : null;
}
