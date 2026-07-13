/**
 * Vitest global setup — runs before any test imports.
 *
 * Polyfills browser globals that protocol code touches but Node doesn't ship:
 *   - requestAnimationFrame / cancelAnimationFrame (used by BLE downloadFile
 *     and downloadTrackFile to throttle progress callbacks)
 *   - FileReader (JSZip's browser build reads a Blob only through FileReader;
 *     see below)
 *
 * These are minimal shims — they just schedule via setTimeout(0). Tests that
 * care about timing should use vi.useFakeTimers() and drive the clock
 * explicitly; tests that don't care don't need to.
 */

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  };
}

// Node has Blob but not FileReader. JSZip ships a browser build that sniffs for
// FileReader to decide whether it can read a Blob at all (utils.js), so without
// this it rejects a perfectly valid Blob ("Can't read the data of '…'") — which
// is what the data export/import round-trip tests feed it.
//
// JSZip resolves with `e.target.result` and rejects with `e.target.error`, so
// the handler must receive an event whose `target` is the reader. Event.target
// is read-only and only set by real dispatch, so hand the callback a plain
// object rather than a DOM Event. Blob.arrayBuffer() does the actual reading.
if (typeof globalThis.FileReader === "undefined") {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    error: unknown = null;
    onload: ((ev: { target: NodeFileReader }) => unknown) | null = null;
    onerror: ((ev: { target: NodeFileReader }) => unknown) | null = null;

    #read(blob: Blob, as: "arrayBuffer" | "text"): void {
      const work = as === "text" ? blob.text() : blob.arrayBuffer();
      work.then(
        (result) => {
          this.result = result;
          this.onload?.({ target: this });
        },
        (err: unknown) => {
          this.error = err;
          this.onerror?.({ target: this });
        },
      );
    }

    readAsArrayBuffer(blob: Blob): void {
      this.#read(blob, "arrayBuffer");
    }
    readAsText(blob: Blob): void {
      this.#read(blob, "text");
    }
  }
  globalThis.FileReader = NodeFileReader as unknown as typeof FileReader;
}
