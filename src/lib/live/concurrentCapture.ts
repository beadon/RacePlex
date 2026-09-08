/**
 * Pairing two independent live BLE sources into one timeline (issue #58) —
 * e.g. a primary GPS device (RaceBox/Dragy) recording alongside a VESC.
 *
 * Neither source shares a clock with the other, and Web Bluetooth gives no
 * on-the-wire timestamp worth trusting anyway (VESC's `COMM_GET_VALUES` has
 * none at all; RaceBox/Dragy's onboard clocks aren't synced to each other or
 * to the phone's). The only timestamp that means anything across two
 * independent streams is **when this device received each sample**
 * (`performance.timeOrigin + performance.now()` via `Date.now()`-equivalent
 * capture at the moment the BLE notification fires) — so that's what this
 * merges on, explicitly, rather than trusting either device's own clock.
 *
 * A merged sample pairs each primary-source sample with the most recently
 * received secondary-source sample. BLE/radio conditions mean that pairing
 * can be stale by anywhere from a few ms to (if the secondary briefly drops)
 * seconds — silently accepting a stale pairing as if it were simultaneous is
 * exactly the kind of undetected error that erodes trust in the data. So a
 * pairing older than `maxAgeMs` is flagged `suspect: true` rather than
 * presented as clean, and the actual age rides along for anyone who wants to
 * threshold differently downstream.
 */

export interface TimestampedSample<T> {
  /** This device's receipt time (`Date.now()`), not anything from the source's own clock. */
  receivedAt: number;
  data: T;
}

export interface MergedSample<P, S> {
  /** The primary sample's receipt time — the timeline a merged stream is keyed on. */
  receivedAt: number;
  primary: P;
  /** The most recently received secondary sample, or null if none has arrived yet. */
  secondary: S | null;
  /**
   * `secondary` is present but was received more than `maxAgeMs` away
   * (either stale or, less commonly, ahead) from `receivedAt`. Always false
   * when `secondary` is null — "no data yet" and "stale data" are different
   * things a consumer should be able to tell apart.
   */
  suspect: boolean;
  /** primary.receivedAt − secondary.receivedAt, ms. Positive = secondary is older. Null if no secondary yet. */
  secondaryAgeMs: number | null;
}

export interface ConcurrentMergeOptions {
  /** A pairing older (or younger) than this by more than this many ms is flagged suspect. Default 250. */
  maxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 250;

/**
 * Feed primary and secondary samples in as they arrive (in true receipt
 * order — call `addSecondary` the instant that source's own notification
 * fires, not batched). Every `addPrimary` call returns the merged row for
 * that instant.
 */
export class ConcurrentSourceMerger<P, S> {
  private readonly maxAgeMs: number;
  private latestSecondary: TimestampedSample<S> | null = null;

  constructor(options: ConcurrentMergeOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  /** Record the latest secondary-source sample. Overwrites whatever was pending. */
  addSecondary(sample: TimestampedSample<S>): void {
    this.latestSecondary = sample;
  }

  /** True once at least one secondary sample has ever arrived. */
  get hasSecondary(): boolean {
    return this.latestSecondary !== null;
  }

  /** Pair a primary-source sample with the latest known secondary at this instant. */
  addPrimary(sample: TimestampedSample<P>): MergedSample<P, S> {
    if (!this.latestSecondary) {
      return {
        receivedAt: sample.receivedAt,
        primary: sample.data,
        secondary: null,
        suspect: false,
        secondaryAgeMs: null,
      };
    }
    const age = sample.receivedAt - this.latestSecondary.receivedAt;
    return {
      receivedAt: sample.receivedAt,
      primary: sample.data,
      secondary: this.latestSecondary.data,
      suspect: Math.abs(age) > this.maxAgeMs,
      secondaryAgeMs: age,
    };
  }

  /** Drop any buffered secondary sample — e.g. after the secondary disconnects. */
  reset(): void {
    this.latestSecondary = null;
  }
}
