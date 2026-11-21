type NamedLobby = {
  readonly name: string;
  readonly handle: string;
};

export function standingLobbyLabels<Lobby extends NamedLobby>(
  lobbies: readonly Lobby[],
): readonly Lobby[] {
  const counts = new Map<string, number>();
  for (const { name } of lobbies) {
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return lobbies.map((lobby) =>
    counts.get(lobby.name.toLowerCase()) === 1
      ? lobby
      : { ...lobby, name: `${lobby.name} (${lobby.handle})` },
  );
}
