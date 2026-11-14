/**
 * Maximum flow (Dinic 1970). Used to decide exactly whether a slot's panels
 * can all be seated, and which fixtures cannot.
 */
export type FlowNetwork = {
  readonly nodes: number;
  readonly arcs: readonly {
    readonly from: number;
    readonly to: number;
    readonly capacity: number;
  }[];
};

export type FlowAnswer = {
  readonly value: number;
  /** Flow on each arc, in the order given. */
  readonly flow: readonly number[];
  /** Nodes still reachable from the source in the residual graph: the source side of a minimum cut. */
  readonly reachable: readonly boolean[];
};

export const maximumFlow = (
  network: FlowNetwork,
  source: number,
  sink: number,
): FlowAnswer => {
  const head: number[][] = Array.from({ length: network.nodes }, () => []);
  const to: number[] = [];
  const capacity: number[] = [];
  for (const arc of network.arcs) {
    head[arc.from]!.push(to.length);
    to.push(arc.to);
    capacity.push(arc.capacity);
    head[arc.to]!.push(to.length);
    to.push(arc.from);
    capacity.push(0);
  }
  const level = Array.from({ length: network.nodes }, () => -1);
  const next = Array.from({ length: network.nodes }, () => 0);
  const bfs = () => {
    level.fill(-1);
    level[source] = 0;
    const queue = [source];
    for (let q = 0; q < queue.length; q += 1) {
      const v = queue[q]!;
      for (const e of head[v]!)
        if (capacity[e]! > 0 && level[to[e]!] === -1) {
          level[to[e]!] = level[v]! + 1;
          queue.push(to[e]!);
        }
    }
    return level[sink] !== -1;
  };
  const push = (v: number, limit: number): number => {
    if (v === sink) return limit;
    for (; next[v]! < head[v]!.length; next[v] = next[v]! + 1) {
      const e = head[v]![next[v]!]!;
      const w = to[e]!;
      if (capacity[e]! > 0 && level[w] === level[v]! + 1) {
        const pushed = push(w, Math.min(limit, capacity[e]!));
        if (pushed > 0) {
          capacity[e] = capacity[e]! - pushed;
          capacity[e ^ 1] = capacity[e ^ 1]! + pushed;
          return pushed;
        }
      }
    }
    return 0;
  };
  let value = 0;
  while (bfs()) {
    next.fill(0);
    for (
      let pushed = push(source, Infinity);
      pushed > 0;
      pushed = push(source, Infinity)
    )
      value += pushed;
  }
  bfs();
  return {
    value,
    flow: network.arcs.map((_, k) => capacity[2 * k + 1]!),
    reachable: level.map((l) => l !== -1),
  };
};
