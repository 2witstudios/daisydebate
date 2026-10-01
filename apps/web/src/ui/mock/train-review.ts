import type { ReviewCard } from '../../features/train/review';

/** Sample saved arguments, due today in this order. */
export const sampleReviewCards: readonly ReviewCard[] = [
  {
    id: 'transit-access',
    motion: 'Cities should fund public transit before roads.',
    claim: 'Access comes before any one budget line.',
    warrant: 'Clinics, schools and jobs only serve people who can reach them.',
    impact: 'Households with no car lose the most when they cannot.',
  },
  {
    id: 'phones-attention',
    motion: 'Schools should ban phones in class.',
    claim: 'A phone in the room takes attention from everyone.',
    warrant: 'Notifications interrupt work even when a student does not look.',
    impact:
      'Lost attention adds up to lost learning, most for students who are already behind.',
  },
  {
    id: 'voting-voice',
    motion: 'Voting should be compulsory.',
    claim: 'Compulsory voting raises the voice of people now left out.',
    warrant:
      'Turnout is lowest among those with the least time and flexibility.',
    impact:
      'Policy then answers to a wider group, not only those who already vote.',
  },
  {
    id: 'transit-budget',
    motion: 'Cities should fund public transit before roads.',
    claim: 'A fixed budget forces a real choice.',
    warrant:
      'Dollars spent on roads are not available for buses and rail in the same year.',
    impact:
      'Choosing roads first means transit riders wait, and they are the ones with the fewest options.',
  },
  {
    id: 'phones-ban',
    motion: 'Schools should ban phones in class.',
    claim: 'A ban is easier to keep than a limit.',
    warrant:
      'A limit needs a judgment call every time, and judgment calls become arguments.',
    impact: 'Teachers spend their time teaching instead of policing.',
  },
  {
    id: 'voting-conscience',
    motion: 'Voting should be compulsory.',
    claim: 'Compulsory voting does not force a choice.',
    warrant:
      'A blank or a none-of-the-above vote is allowed in most systems that require turnout.',
    impact:
      'Attendance is required, but conscience is not, which protects free expression.',
  },
];
