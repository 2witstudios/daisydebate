import type { ReactNode } from 'react';

/**
 * Wording counsel has not approved yet (PYL-8): shown as the board drafts
 * it, behind the youth-publishing flag, which stays closed in production
 * until counsel answers.
 */
export function Counsel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="rounded-badge bg-gold-soft px-1 font-strong text-gold">
      [COUNSEL: {children}]
    </span>
  );
}

const card =
  'overflow-hidden rounded-lg border border-border bg-surface-raised';

function TermList({
  items,
}: {
  readonly items: readonly {
    readonly title: string;
    readonly body: ReactNode;
  }[];
}) {
  return (
    <ul className={card}>
      {items.map((item, index) => (
        <li
          key={item.title}
          className={`flex flex-col gap-1 px-4 py-3 ${index === 0 ? '' : 'border-t border-border'}`}
        >
          <strong className="font-strong">{item.title}</strong>
          <span className="text-sm text-ink-muted">{item.body}</span>
        </li>
      ))}
    </ul>
  );
}

/** "What you agree to": the release, item by item, for one minor. */
export function ReleaseTerms({ minor }: { readonly minor: string }) {
  const who = `@${minor}`;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">What you agree to</h2>
      <TermList
        items={[
          {
            title: `Daisy may publish ${who}’s ranked Youth Rounds`,
            body: 'Video, voice, username and result, on daisydebate.com, once every Youth debater in that Round has a release.',
          },
          {
            title: 'Daisy may make and share clips',
            body: `On Daisy and on Daisy’s social media accounts. Clips never show ${who}’s full name, school or location unless they show them on camera.`,
          },
          {
            title: `You or ${who} can ask for anything to come down`,
            body: (
              <>
                Any Round or clip, any time. We take it down within{' '}
                <Counsel>takedown period</Counsel>.
              </>
            ),
          },
          {
            title: `When ${who} turns 18`,
            body: (
              <Counsel>
                whether earlier content stays published or needs their own
                consent
              </Counsel>
            ),
          },
          {
            title: 'How long this lasts',
            body: (
              <>
                Until you withdraw it. <Counsel>maximum term, if any</Counsel>
              </>
            ),
          },
        ]}
      />
      <details className="group">
        <summary className="inline-flex min-h-release-target cursor-pointer items-center rounded-sm border border-border-strong px-5 font-strong text-ink">
          Read the full release
        </summary>
        <div className="mt-3 flex flex-col gap-3 text-sm text-ink">
          <p>
            You, as {who}’s parent or legal guardian, allow Daisy Debate to
            record, publish and share {who}’s ranked Youth Rounds on Daisy
            Debate, including their video, voice, username and result, once
            every Youth debater in a Round holds a release.
          </p>
          <p>
            You allow Daisy Debate to make clips of those Rounds and share them
            on Daisy Debate and on Daisy Debate’s social media accounts. Clips
            never show {who}’s full name, school or location unless they show
            them on camera.
          </p>
          <p>
            You or {who} may ask for any Round or clip to be taken down at any
            time, and Daisy Debate takes it down within{' '}
            <Counsel>takedown period</Counsel>. You may withdraw this release at
            any time from the link Daisy Debate emails you; withdrawing stops
            anything new being published.
          </p>
          <p>
            Using clips in paid advertising is a separate choice and is not
            allowed unless you tick it.{' '}
            <Counsel>ad-use terms and any compensation</Counsel>
          </p>
          <p>
            <Counsel>
              what happens when {who} turns 18, any maximum term, and the
              signature and attestation wording
            </Counsel>
          </p>
        </div>
      </details>
    </section>
  );
}

/** "What doesn't change". */
export function ReleaseUnchanged({ minor }: { readonly minor: string }) {
  const who = `@${minor}`;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">What doesn’t change</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-muted">
        <li>
          {who} can still play ranked without a release; their Rounds just stay
          private.
        </li>
        <li>Daisy never sells {who}’s recordings or data.</li>
        <li>Bot Rounds and practice are never published.</li>
      </ul>
    </section>
  );
}
