export interface PaidOrderLike {
  id: number;
  status: string;
}

export interface PaidOrderDiffResult {
  newPaidOrderIds: number[];
  nextPaidIds: Set<number>;
  nextHasLoadedOnce: boolean;
}

/**
 * Computes newly arrived PAID order IDs across polling cycles.
 *
 * On the initial load (`hasLoadedOnce === false`), records pre-existing PAID
 * orders and sets `nextHasLoadedOnce = true` without reporting them as new so
 * opening `/staff` does not ring for backlog orders.
 *
 * On every subsequent poll (`hasLoadedOnce === true`), any PAID order ID not
 * present in `prevPaidIds` is returned in `newPaidOrderIds`, even when the
 * previous queue had zero PAID orders (`prevPaidIds.size === 0`).
 */
export function findNewPaidOrderIds(
  orders: PaidOrderLike[],
  prevPaidIds: Set<number>,
  hasLoadedOnce: boolean,
): PaidOrderDiffResult {
  const nextPaidIds = new Set(
    orders.filter((o) => o.status === "PAID").map((o) => o.id),
  );

  if (!hasLoadedOnce) {
    return {
      newPaidOrderIds: [],
      nextPaidIds,
      nextHasLoadedOnce: true,
    };
  }

  const newPaidOrderIds: number[] = [];
  for (const id of nextPaidIds) {
    if (!prevPaidIds.has(id)) {
      newPaidOrderIds.push(id);
    }
  }

  return {
    newPaidOrderIds,
    nextPaidIds,
    nextHasLoadedOnce: true,
  };
}

export function playWebAudioChime(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // 2-tone coffee bar chime (E5 -> B5)
    const freqs = [659.25, 987.77];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.18, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.46);
    });
  } catch {
    // Ignore audio context block if user hasn't interacted yet
  }
}
