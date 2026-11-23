import type { Article, Collection } from '../article';

export const judgingCollection: Collection = {
  home: 'guides',
  slug: 'judging',
  title: 'Judging and ballots',
  summary:
    'Take a judge seat, follow the round, and submit a ballot the debaters can learn from.',
};

const base = { home: 'guides', collection: 'judging' } as const;
const updated = '2026-11-23';

const roomSources = [
  'docs/domains/rooms.md',
  'apps/web/src/features/judge/get-assigned.ts',
  'apps/web/src/ui/judge/judge-hub/judge-hub.tsx',
] as const;

const ballotSources = [
  'packages/protocol/src/ballot.ts',
  'packages/protocol/src/ballot-definition.ts',
  'packages/protocol/src/ballot-rubrics.ts',
  'apps/web/src/features/judge/ballot-rules.ts',
  'apps/web/src/ui/judge/ballot-page/ballot-page.tsx',
] as const;

export const judgingArticles: readonly Article[] = [
  {
    ...base,
    slug: 'judging-on-daisy',
    title: 'Judging on Daisy',
    summary:
      'What a judge does on Daisy, from taking the seat to the ballot the debaters read.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Every judged round on Daisy ends with a ballot: who won, why, and how each debater did. You watch the round live, then fill in the ballot once the speeches are over. Both debaters read your decision and your reason, so a good ballot is one they can learn from.',
      },
      { kind: 'heading', id: 'the-journey', text: 'The journey' },
      {
        kind: 'steps',
        items: [
          'Take a judge seat in a room, or accept a host’s invitation to judge. See [Getting a judge seat](/guides/judging/getting-assigned).',
          'Check the room before it starts: the format, the resolution and the ballot. See [Before the round](/guides/judging/before-the-round).',
          'Follow every speech from your judge view. See [During the round](/guides/judging/during-the-round).',
          'Fill in and submit your ballot within 30 minutes of the last speech. See [Submitting your ballot](/guides/judging/submitting-your-ballot).',
        ],
      },
      { kind: 'heading', id: 'who-can-judge', text: 'Who can judge' },
      {
        kind: 'paragraph',
        text: 'Any member can take a judge seat. Students under 18 can judge rounds in the Open lobby, and adults can judge rounds in the Youth lobby. Your name is never shown on your ballot: debaters see that a person judged, not who.',
      },
      { kind: 'heading', id: 'ai-judges', text: 'AI judges' },
      {
        kind: 'paragraph',
        text: 'A room can seat an AI judge instead of a person, so a round never waits for one. The AI judge fills in the same ballot you do. It is free on ranked rounds; on casual rounds it is part of Premium.',
      },
      {
        kind: 'note',
        text: 'Your assigned rounds are on [Judge](/judge). Each one has a link to follow it live and a link to its ballot.',
      },
    ],
    related: [
      'guides/judging/understanding-a-ballot',
      'learn/judging-and-feedback/making-a-decision',
    ],
    sources: [...roomSources, 'apps/web/src/features/help/topics.ts'],
  },
  {
    ...base,
    slug: 'getting-assigned',
    title: 'Getting a judge seat',
    summary:
      'The ways a round becomes yours to judge, and where it appears once it does.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'A round is yours to judge when you hold its judge seat. There are three ways to get one.',
      },
      {
        kind: 'terms',
        items: [
          {
            term: 'Take the seat',
            detail:
              'Open a room from [Play](/lobby) and take its judge seat while it is free.',
          },
          {
            term: 'Accept an invitation',
            detail:
              'A host can invite you to judge by your username. You are told in the app, and by email unless you turned that off. The seat is held for you for 24 hours, or until the room starts. Take the seat to accept, or decline the invitation.',
          },
          {
            term: 'Be seated by the host',
            detail:
              'A host can put you straight into the judge seat of their room.',
          },
        ],
      },
      { kind: 'heading', id: 'where-it-appears', text: 'Where it appears' },
      {
        kind: 'paragraph',
        text: '[Judge](/judge) lists every round you hold a judge seat in. Each one shows where it stands, a Follow link to watch it live, and a link to its ballot. When you have none, Judge offers Find a Room.',
      },
      {
        kind: 'note',
        text: 'Opening the room of a round you judge takes you to your judge view.',
      },
    ],
    related: [
      'guides/judging/before-the-round',
      'guides/judging/judging-on-daisy',
    ],
    sources: roomSources,
  },
  {
    ...base,
    slug: 'before-the-round',
    title: 'Before the round',
    summary:
      'What to check in the room before you press Ready, so nothing in the round surprises you.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'A round starts when every seat is filled and every person in it, judges included, has pressed Ready. Use the time before then to check what you are about to judge.',
      },
      {
        kind: 'list',
        items: [
          'The format: its speeches, their times and each side’s prep. The room’s setup lists them.',
          'Who is debating, and which side each debater argues.',
          'The resolution. If the room strikes its resolution, the debaters choose it once the round starts, and you see it when they finish.',
        ],
      },
      {
        kind: 'paragraph',
        text: 'If the host changes the settings or the seats, everyone’s Ready is cleared, you included, so nobody judges or debates under rules they did not see. Check the room again and press Ready once more.',
      },
      { kind: 'heading', id: 'know-the-ballot', text: 'Know the ballot' },
      {
        kind: 'paragraph',
        text: 'The ballot is fixed when the round starts. Once it starts, Preview your ballot in your judge view shows it, so you know what you will score while you listen. [Understanding a Daisy ballot](/guides/judging/understanding-a-ballot) explains each part.',
      },
    ],
    related: [
      'guides/judging/during-the-round',
      'guides/judging/understanding-a-ballot',
    ],
    sources: [
      'docs/domains/rooms.md',
      'apps/web/src/ui/judging-room/live-judge-room.tsx',
    ],
  },
  {
    ...base,
    slug: 'during-the-round',
    title: 'During the round',
    summary:
      'Following the speeches from your judge view, taking notes, and what to do when something goes wrong.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Once the round starts, the room opens your judge view: “You’re judging this round”. It shows the resolution, who has the floor and the time left, each side’s prep, the speech order and the recorded transcript.',
      },
      { kind: 'heading', id: 'notes', text: 'Take your own notes' },
      {
        kind: 'paragraph',
        text: 'Keep a flow on paper or in a document of your own: each argument, and how the other side answered it. The transcript is recorded and is on your ballot page afterwards, so you can check a quote, but your notes are what let you follow the clash as it happens.',
      },
      {
        kind: 'paragraph',
        text: '[Making a decision](/learn/judging-and-feedback/making-a-decision) describes what to track and how to weigh it.',
      },
      { kind: 'heading', id: 'problems', text: 'When something goes wrong' },
      {
        kind: 'terms',
        items: [
          {
            term: 'A debater does not speak',
            detail:
              'A debater who misses their speech while their opponent is there forfeits the round. If both are missing, the round is abandoned. A media or transcript failure is never counted as absence.',
          },
          {
            term: 'You lose your connection',
            detail:
              'The round carries on without you. Open [Judge](/judge) and choose Follow to return to it.',
          },
          {
            term: 'The page falls behind',
            detail:
              'Your judge view says “Reconnecting to the round. What you see may be out of date.” and catches up when the connection returns.',
          },
        ],
      },
      {
        kind: 'paragraph',
        text: 'When the last speech ends, your judge view offers Open your ballot.',
      },
    ],
    related: [
      'guides/judging/submitting-your-ballot',
      'learn/judging-and-feedback/making-a-decision',
    ],
    sources: [
      'docs/domains/rooms.md',
      'apps/web/src/ui/judging-room/live-judge-room.tsx',
      'apps/web/src/features/judge/judge-room-stage.ts',
    ],
  },
  {
    ...base,
    slug: 'understanding-a-ballot',
    title: 'Understanding a Daisy ballot',
    summary:
      'What each part of the ballot means, how the decision and the scores relate, and who reads what.',
    updated,
    blocks: [
      {
        kind: 'paragraph',
        text: 'Every ballot has a decision, scores and a written reason. The ballot page lists the rules for the ballot in front of you; this is Daisy’s standard ballot.',
      },
      { kind: 'heading', id: 'decision', text: 'The decision' },
      {
        kind: 'paragraph',
        text: 'Pick one winner. There are no draws.',
      },
      { kind: 'heading', id: 'scores', text: 'The scores' },
      {
        kind: 'paragraph',
        text: 'Score each debater from 1 to 5 in ten categories, for a total out of 50. Every score starts at 3. Under each category, its anchors say what a 1, a 3 and a 5 look like; 2 and 4 sit between them.',
      },
      {
        kind: 'terms',
        items: [
          {
            term: 'Case',
            detail:
              'Thesis (one clear answer to the resolution), Burdens (set what must be true, and won it), Warrants (each burden backed by reasons) and Coherence (consistent with its own thesis).',
          },
          {
            term: 'Clash',
            detail:
              'Refutation (attacked what the other case depends on) and Weighing (compared what still stands).',
          },
          {
            term: 'Cross-ex',
            detail:
              'Questioning (won concessions on their burdens) and Answering (direct, and kept the case intact).',
          },
          {
            term: 'Presentation',
            detail:
              'Organization (case structure easy to follow) and Delivery (clear, paced, persuasive).',
          },
        ],
      },
      {
        kind: 'heading',
        id: 'decision-and-scores',
        text: 'How the decision and the scores relate',
      },
      {
        kind: 'paragraph',
        text: 'The decision is who won the round; the scores are how well each debater debated. They usually agree, but they need not: a debater can win the round on fewer points. When your winner has the lower total, the ballot asks you to confirm that before you submit, so it is a choice and never a slip.',
      },
      { kind: 'heading', id: 'written', text: 'The written parts' },
      {
        kind: 'terms',
        items: [
          {
            term: 'Reason for decision',
            detail:
              'Required, up to 600 characters. Both debaters read it. See [Writing a clear reason for decision](/learn/judging-and-feedback/writing-a-reason-for-decision).',
          },
          {
            term: 'Feedback',
            detail:
              'Optional, up to 280 characters for each debater. Each debater reads only their own. See [Writing useful feedback](/learn/judging-and-feedback/writing-useful-feedback).',
          },
        ],
      },
      { kind: 'heading', id: 'who-reads', text: 'Who reads your ballot' },
      {
        kind: 'list',
        items: [
          'Both debaters read your decision, your scores and your reason. Each reads only the feedback written to them.',
          'Your name is never shown. A ballot says only whether a person or an AI judged.',
          'A host who is not debating reads it, and so does every judge of the round once it is over.',
          'On a ranked round, the audience sees the winner, the scores and the reason on the round’s timeline, after the broadcast delay. Feedback is never shown to an audience. A casual round’s audience sees no ballot.',
          'A debater can report feedback written to them as abusive.',
        ],
      },
    ],
    related: [
      'guides/judging/submitting-your-ballot',
      'learn/judging-and-feedback/writing-a-reason-for-decision',
      'learn/judging-and-feedback/writing-useful-feedback',
    ],
    sources: [...ballotSources, 'docs/domains/rooms.md'],
  },
  {
    ...base,
    slug: 'submitting-your-ballot',
    title: 'Submitting your ballot',
    summary:
      'When the ballot opens, how long you have, what happens after you submit, and why it cannot be changed.',
    updated,
    blocks: [
      { kind: 'heading', id: 'when', text: 'When it opens' },
      {
        kind: 'paragraph',
        text: 'Your ballot opens when the round’s recorded transcript is frozen, shortly after the last speech. Until then the ballot page says “Your ballot opens when the recorded transcript is frozen.”',
      },
      { kind: 'heading', id: 'deadline', text: 'The deadline' },
      {
        kind: 'paragraph',
        text: 'You have 30 minutes from when the ballot opens. The page shows the time left to submit. When time runs out, the ballots already submitted decide the round. If none were submitted, the round ends with no result.',
      },
      {
        kind: 'paragraph',
        text: 'When a round has several judges, the side most judges picked wins. If the judges are split evenly, there is no result.',
      },
      { kind: 'heading', id: 'checking', text: 'Before you submit' },
      {
        kind: 'list',
        items: [
          'Read the transcript on the ballot page to check anything you are unsure of. If part of it is missing, the page says so: judge only the evidence available.',
          'Your entries are kept if you reload the page in the same tab.',
          'Keep contact details out of your reason and feedback.',
        ],
      },
      { kind: 'heading', id: 'after', text: 'After you submit' },
      {
        kind: 'paragraph',
        text: 'The page shows “Ballot submitted” with your recorded ballot and scores. The result is recorded once any other ballots are in and attendance for the last speeches has settled; the page then shows the round’s outcome.',
      },
      {
        kind: 'paragraph',
        text: 'If the host turned on post-round feedback, the ballot page offers Join the post-round call: a live call with the debaters, where they see and hear you, shown as “Judge” and never by name. It is not recorded, and it closes 30 minutes after the round ends.',
      },
      { kind: 'heading', id: 'corrections', text: 'Corrections' },
      {
        kind: 'paragraph',
        text: 'A submitted ballot is final: it cannot be edited or submitted again. Take a moment over the decision and the reason before you press submit.',
      },
    ],
    related: [
      'guides/judging/understanding-a-ballot',
      'learn/judging-and-feedback/writing-a-reason-for-decision',
    ],
    sources: [
      'packages/protocol/src/judging-policy.ts',
      'apps/web/src/features/round-ballots/form.ts',
      'apps/web/src/features/judge/ballot-draft.ts',
      'apps/web/src/ui/judge/ballot-page/ballot-entry.tsx',
      'apps/web/src/ui/judge/ballot-page/ballot-evidence.tsx',
      'docs/domains/rooms.md',
    ],
  },
];
