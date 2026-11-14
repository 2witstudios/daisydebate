/**
 * Maximum-weight matching on a general graph, Edmonds' blossom algorithm
 * with dual variables (Galil, "Efficient algorithms for finding maximum
 * matching in graphs", 1986), O(n³). Among the matchings of maximum
 * cardinality it returns one of maximum weight, so a caller who wants a
 * minimum-cost perfect matching passes `big - cost` and checks the result
 * is perfect. Weights are integers as `bigint`, doubled inside so every dual
 * stays integral.
 */
export type WeightedEdge = readonly [number, number, bigint];

const at = <T>(items: readonly T[], index: number) =>
  items[((index % items.length) + items.length) % items.length]!;

const rotate = <T>(items: readonly T[], from: number) => [
  ...items.slice(from),
  ...items.slice(0, from),
];

/** `mate[v]` is v's partner, or -1. */
const maximumWeightMatching = (
  vertexCount: number,
  input: readonly WeightedEdge[],
): number[] => {
  const n = vertexCount;
  const edges = input.map(([i, j, w]) => [i, j, w * 2n] as const);
  if (edges.length === 0) return Array.from({ length: n }, () => -1);
  const maxWeight = edges.reduce((m, [, , w]) => (w > m ? w : m), 0n);
  const endpoint = edges.flatMap(([i, j]) => [i, j]);
  const neighbend: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([i, j], k) => {
    neighbend[i]!.push(2 * k + 1);
    neighbend[j]!.push(2 * k);
  });
  const mate = Array.from({ length: n }, () => -1);
  const label = Array.from({ length: 2 * n }, () => 0);
  const labelend = Array.from({ length: 2 * n }, () => -1);
  const inblossom = Array.from({ length: n }, (_, v) => v);
  const blossomparent = Array.from({ length: 2 * n }, () => -1);
  const blossomchilds: (number[] | null)[] = Array.from(
    { length: 2 * n },
    () => null,
  );
  const blossombase = Array.from({ length: 2 * n }, (_, b) => (b < n ? b : -1));
  const blossomendps: (number[] | null)[] = Array.from(
    { length: 2 * n },
    () => null,
  );
  const bestedge = Array.from({ length: 2 * n }, () => -1);
  const blossombestedges: (number[] | null)[] = Array.from(
    { length: 2 * n },
    () => null,
  );
  const unusedblossoms = Array.from({ length: n }, (_, i) => n + i);
  const dualvar: bigint[] = Array.from({ length: 2 * n }, (_, i) =>
    i < n ? maxWeight : 0n,
  );
  const allowedge = Array.from({ length: edges.length }, () => false);
  let queue: number[] = [];

  const slack = (k: number) => {
    const [i, j, w] = edges[k]!;
    return dualvar[i]! + dualvar[j]! - 2n * w;
  };
  const leaves = (b: number): number[] =>
    b < n ? [b] : blossomchilds[b]!.flatMap((child) => leaves(child));

  const assignLabel = (w: number, t: number, p: number): void => {
    const b = inblossom[w]!;
    label[w] = label[b] = t;
    labelend[w] = labelend[b] = p;
    bestedge[w] = bestedge[b] = -1;
    if (t === 1) queue.push(...leaves(b));
    else if (t === 2) {
      const base = blossombase[b]!;
      assignLabel(endpoint[mate[base]!]!, 1, mate[base]! ^ 1);
    }
  };

  const scanBlossom = (start: number, other: number) => {
    const path: number[] = [];
    let base = -1;
    let v = start;
    let w = other;
    while (v !== -1 || w !== -1) {
      let b = inblossom[v]!;
      if (label[b]! & 4) {
        base = blossombase[b]!;
        break;
      }
      path.push(b);
      label[b] = 5;
      if (labelend[b] === -1) v = -1;
      else {
        v = endpoint[labelend[b]!]!;
        b = inblossom[v]!;
        v = endpoint[labelend[b]!]!;
      }
      if (w !== -1) [v, w] = [w, v];
    }
    for (const b of path) label[b] = 1;
    return base;
  };

  const addBlossom = (base: number, k: number) => {
    let [v, w] = edges[k]!;
    const bb = inblossom[base]!;
    let bv = inblossom[v]!;
    let bw = inblossom[w]!;
    const b = unusedblossoms.pop()!;
    blossombase[b] = base;
    blossomparent[b] = -1;
    blossomparent[bb] = b;
    const path: number[] = [];
    const endps: number[] = [];
    while (bv !== bb) {
      blossomparent[bv] = b;
      path.push(bv);
      endps.push(labelend[bv]!);
      v = endpoint[labelend[bv]!]!;
      bv = inblossom[v]!;
    }
    path.push(bb);
    path.reverse();
    endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomparent[bw] = b;
      path.push(bw);
      endps.push(labelend[bw]! ^ 1);
      w = endpoint[labelend[bw]!]!;
      bw = inblossom[w]!;
    }
    label[b] = 1;
    labelend[b] = labelend[bb]!;
    dualvar[b] = 0n;
    blossomchilds[b] = path;
    blossomendps[b] = endps;
    for (const leaf of leaves(b)) {
      if (label[inblossom[leaf]!] === 2) queue.push(leaf);
      inblossom[leaf] = b;
    }
    const bestedgeto = Array.from({ length: 2 * n }, () => -1);
    for (const child of path) {
      const lists =
        blossombestedges[child] === null
          ? leaves(child).map((leaf) => neighbend[leaf]!.map((p) => p >> 1))
          : [blossombestedges[child]!];
      for (const list of lists)
        for (const edge of list) {
          let [i, j] = edges[edge]!;
          if (inblossom[j] === b) [i, j] = [j, i];
          const bj = inblossom[j]!;
          if (
            bj !== b &&
            label[bj] === 1 &&
            (bestedgeto[bj] === -1 || slack(edge) < slack(bestedgeto[bj]!))
          )
            bestedgeto[bj] = edge;
        }
      blossombestedges[child] = null;
      bestedge[child] = -1;
    }
    blossombestedges[b] = bestedgeto.filter((edge) => edge !== -1);
    bestedge[b] = -1;
    for (const edge of blossombestedges[b]!)
      if (bestedge[b] === -1 || slack(edge) < slack(bestedge[b]!))
        bestedge[b] = edge;
  };

  const expandBlossom = (b: number, endstage: boolean): void => {
    for (const s of blossomchilds[b]!) {
      blossomparent[s] = -1;
      if (s < n) inblossom[s] = s;
      else if (endstage && dualvar[s] === 0n) expandBlossom(s, endstage);
      else for (const leaf of leaves(s)) inblossom[leaf] = s;
    }
    if (!endstage && label[b] === 2) {
      const childs = blossomchilds[b]!;
      const endps = blossomendps[b]!;
      const entrychild = inblossom[endpoint[labelend[b]! ^ 1]!]!;
      let j = childs.indexOf(entrychild);
      let jstep: number;
      let endptrick: number;
      if (j & 1) {
        j -= childs.length;
        jstep = 1;
        endptrick = 0;
      } else {
        jstep = -1;
        endptrick = 1;
      }
      let p = labelend[b]!;
      while (j !== 0) {
        label[endpoint[p ^ 1]!] = 0;
        label[endpoint[at(endps, j - endptrick) ^ endptrick ^ 1]!] = 0;
        assignLabel(endpoint[p ^ 1]!, 2, p);
        allowedge[at(endps, j - endptrick) >> 1] = true;
        j += jstep;
        p = at(endps, j - endptrick) ^ endptrick;
        allowedge[p >> 1] = true;
        j += jstep;
      }
      const bv = at(childs, j);
      label[endpoint[p ^ 1]!] = label[bv] = 2;
      labelend[endpoint[p ^ 1]!] = labelend[bv] = p;
      bestedge[bv] = -1;
      j += jstep;
      while (at(childs, j) !== entrychild) {
        const child = at(childs, j);
        if (label[child] === 1) {
          j += jstep;
          continue;
        }
        const labelled = leaves(child).find((leaf) => label[leaf] !== 0);
        if (labelled !== undefined) {
          label[labelled] = 0;
          label[endpoint[mate[blossombase[child]!]!]!] = 0;
          assignLabel(labelled, 2, labelend[labelled]!);
        }
        j += jstep;
      }
    }
    label[b] = labelend[b] = -1;
    blossomchilds[b] = blossomendps[b] = null;
    blossombase[b] = -1;
    blossombestedges[b] = null;
    bestedge[b] = -1;
    unusedblossoms.push(b);
  };

  const augmentBlossom = (b: number, v: number): void => {
    let t = v;
    while (blossomparent[t] !== b) t = blossomparent[t]!;
    if (t >= n) augmentBlossom(t, v);
    const childs = blossomchilds[b]!;
    const endps = blossomendps[b]!;
    const i = childs.indexOf(t);
    let j = i;
    let jstep: number;
    let endptrick: number;
    if (i & 1) {
      j -= childs.length;
      jstep = 1;
      endptrick = 0;
    } else {
      jstep = -1;
      endptrick = 1;
    }
    while (j !== 0) {
      j += jstep;
      t = at(childs, j);
      const p = at(endps, j - endptrick) ^ endptrick;
      if (t >= n) augmentBlossom(t, endpoint[p]!);
      j += jstep;
      t = at(childs, j);
      if (t >= n) augmentBlossom(t, endpoint[p ^ 1]!);
      mate[endpoint[p]!] = p ^ 1;
      mate[endpoint[p ^ 1]!] = p;
    }
    blossomchilds[b] = rotate(childs, i);
    blossomendps[b] = rotate(endps, i);
    blossombase[b] = blossombase[blossomchilds[b]![0]!]!;
  };

  const augmentMatching = (k: number) => {
    const [v, w] = edges[k]!;
    for (const [start, startP] of [
      [v, 2 * k + 1],
      [w, 2 * k],
    ] as const) {
      let s = start;
      let p = startP;
      for (;;) {
        const bs = inblossom[s]!;
        if (bs >= n) augmentBlossom(bs, s);
        mate[s] = p;
        if (labelend[bs] === -1) break;
        const t = endpoint[labelend[bs]!]!;
        const bt = inblossom[t]!;
        s = endpoint[labelend[bt]!]!;
        const j = endpoint[labelend[bt]! ^ 1]!;
        if (bt >= n) augmentBlossom(bt, j);
        mate[j] = labelend[bt]!;
        p = labelend[bt]! ^ 1;
      }
    }
  };

  for (let stage = 0; stage < n; stage += 1) {
    label.fill(0);
    bestedge.fill(-1);
    for (let b = n; b < 2 * n; b += 1) blossombestedges[b] = null;
    allowedge.fill(false);
    queue = [];
    for (let v = 0; v < n; v += 1)
      if (mate[v] === -1 && label[inblossom[v]!] === 0) assignLabel(v, 1, -1);
    let augmented = false;
    for (;;) {
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!;
        for (const p of neighbend[v]!) {
          const k = p >> 1;
          const w = endpoint[p]!;
          if (inblossom[v] === inblossom[w]) continue;
          let kslack = 0n;
          if (!allowedge[k]) {
            kslack = slack(k);
            if (kslack <= 0n) allowedge[k] = true;
          }
          if (allowedge[k]) {
            if (label[inblossom[w]!] === 0) assignLabel(w, 2, p ^ 1);
            else if (label[inblossom[w]!] === 1) {
              const base = scanBlossom(v, w);
              if (base >= 0) addBlossom(base, k);
              else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (label[w] === 0) {
              label[w] = 2;
              labelend[w] = p ^ 1;
            }
          } else if (label[inblossom[w]!] === 1) {
            const b = inblossom[v]!;
            if (bestedge[b] === -1 || kslack < slack(bestedge[b]!))
              bestedge[b] = k;
          } else if (label[w] === 0) {
            if (bestedge[w] === -1 || kslack < slack(bestedge[w]!))
              bestedge[w] = k;
          }
        }
      }
      if (augmented) break;
      let deltatype = -1;
      let delta = 0n;
      let deltaedge = -1;
      let deltablossom = -1;
      for (let v = 0; v < n; v += 1)
        if (label[inblossom[v]!] === 0 && bestedge[v] !== -1) {
          const d = slack(bestedge[v]!);
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 2;
            deltaedge = bestedge[v]!;
          }
        }
      for (let b = 0; b < 2 * n; b += 1)
        if (blossomparent[b] === -1 && label[b] === 1 && bestedge[b] !== -1) {
          const kslack = slack(bestedge[b]!);
          const d = kslack / 2n;
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 3;
            deltaedge = bestedge[b]!;
          }
        }
      for (let b = n; b < 2 * n; b += 1)
        if (
          blossombase[b]! >= 0 &&
          blossomparent[b] === -1 &&
          label[b] === 2 &&
          (deltatype === -1 || dualvar[b]! < delta)
        ) {
          delta = dualvar[b]!;
          deltatype = 4;
          deltablossom = b;
        }
      if (deltatype === -1) {
        deltatype = 1;
        const least = dualvar.slice(0, n).reduce((m, d) => (d < m ? d : m));
        delta = least > 0n ? least : 0n;
      }
      for (let v = 0; v < n; v += 1) {
        const l = label[inblossom[v]!];
        if (l === 1) dualvar[v] = dualvar[v]! - delta;
        else if (l === 2) dualvar[v] = dualvar[v]! + delta;
      }
      for (let b = n; b < 2 * n; b += 1)
        if (blossombase[b]! >= 0 && blossomparent[b] === -1) {
          if (label[b] === 1) dualvar[b] = dualvar[b]! + delta;
          else if (label[b] === 2) dualvar[b] = dualvar[b]! - delta;
        }
      if (deltatype === 1) break;
      if (deltatype === 2) {
        allowedge[deltaedge] = true;
        let [i, j] = edges[deltaedge]!;
        if (label[inblossom[i]!] === 0) [i, j] = [j, i];
        queue.push(i);
      } else if (deltatype === 3) {
        allowedge[deltaedge] = true;
        queue.push(edges[deltaedge]![0]);
      } else expandBlossom(deltablossom, false);
    }
    if (!augmented) break;
    for (let b = n; b < 2 * n; b += 1)
      if (
        blossomparent[b] === -1 &&
        blossombase[b]! >= 0 &&
        label[b] === 1 &&
        dualvar[b] === 0n
      )
        expandBlossom(b, true);
  }
  return mate.map((p) => (p >= 0 ? endpoint[p]! : -1));
};

/**
 * The minimum-cost perfect matching, or null when the graph has none.
 * Costs are non-negative integers; a missing edge is a forbidden pair.
 */
export const minimumCostPerfectMatching = (
  vertexCount: number,
  edges: readonly WeightedEdge[],
): number[] | null => {
  if (vertexCount % 2 === 1) return null;
  if (vertexCount === 0) return [];
  const ceiling = edges.reduce((m, [, , c]) => (c > m ? c : m), 0n) + 1n;
  const mate = maximumWeightMatching(
    vertexCount,
    edges.map(([i, j, c]) => [i, j, ceiling - c] as const),
  );
  return mate.every((partner) => partner >= 0) ? mate : null;
};
