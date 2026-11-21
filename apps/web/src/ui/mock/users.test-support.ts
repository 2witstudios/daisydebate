export type MockUser = {
  readonly name: string;
  readonly rating: number;
};

export const users: readonly MockUser[] = [
  { name: 'Alex Chen', rating: 1820 },
  { name: 'Maya Singh', rating: 1810 },
  { name: 'Daniel Kim', rating: 1762 },
  { name: 'Sophia Lee', rating: 1921 },
  { name: 'Marcus Bell', rating: 1887 },
  { name: 'Priya Shah', rating: 1804 },
];
