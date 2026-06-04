/// <reference lib="webworker" />
// Web Worker: parses AiM .xrk/.xrz entirely in-browser via Pyodide + libxrk.
//
// Runs off the main thread so a large session never freezes the UI. The flow:
//   1. lazily load the Pyodide runtime (CDN) + numpy/pyarrow/micropip,
//   2. micropip-install the self-hosted libxrk wasm wheel,
//   3. write the uploaded bytes to Pyodide's virtual FS,
//   4. run libxrk, resample to the GPS timebase, and ship channels back as
//      transferable Float64 buffers.
//
// All steps emit `progress` messages; any failure becomes a single `error`
// message (the page must never crash on a bad file).

import type {
  XrkParseRequest,
  XrkProgress,
  XrkRawResult,
  XrkWorkerMessage,
} from "./xrkTypes";

declare const self: DedicatedWorkerGlobalScope;

// Minimal shape of the bits of the Pyodide API we use (avoids a build-time dep
// on @pyodide/* types; the runtime is loaded dynamically from the CDN).
interface PyodideApi {
  loadPackage(names: readonly string[] | string): Promise<void>;
  pyimport(name: string): { install(url: string): Promise<void> };
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void };
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
}

let pyodidePromise: Promise<PyodideApi> | null = null;

function post(message: XrkWorkerMessage, transfer?: Transferable[]) {
  self.postMessage(message, transfer ?? []);
}

function progress(progress: XrkProgress) {
  post({ type: "progress", progress });
}

/**
 * Boot Pyodide + packages + the libxrk wheel exactly once per worker. The worker
 * is short-lived (spawned per import, terminated after), but guarding the promise
 * keeps a retry within the same worker cheap.
 */
async function getPyodide(indexUrl: string, wheelUrl: string): Promise<PyodideApi> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    progress({ phase: "boot", message: "Loading Python runtime…" });
    // The Pyodide ESM entry self-resolves its other assets from indexURL.
    const mod = (await import(/* @vite-ignore */ `${indexUrl}pyodide.mjs`)) as {
      loadPyodide(opts: { indexURL: string }): Promise<PyodideApi>;
    };
    const pyodide = await mod.loadPyodide({ indexURL: indexUrl });

    progress({ phase: "packages", message: "Loading numpy + pyarrow…" });
    await pyodide.loadPackage(["numpy", "pyarrow", "micropip"]);

    progress({ phase: "wheel", message: "Loading AiM XRK parser…" });
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(wheelUrl);

    return pyodide;
  })();
  return pyodidePromise;
}

// Python that runs libxrk and flattens the result into plain numpy arrays.
// Resampling to a GPS channel gives one row per GPS fix (matching the app's
// GpsSample model) and keeps the sample count sane. `XRK_PATH` is injected from
// JS. The returned dict is converted to JS typed arrays via `.toJs()`.
const PARSE_PY = `
import numpy as np
from libxrk import aim_xrk, ChannelMetadata

log = aim_xrk(XRK_PATH)

# Prefer a GPS channel as the shared timebase so every row is one GPS fix.
base = None
for cand in ("GPS Latitude", "GPS Longitude", "GPS Speed"):
    if cand in log.channels:
        base = cand
        break

src = log.resample_to_channel(base) if base else log
merged = src.get_channels_as_table()

names = [n for n in merged.column_names if n != "timecodes"]
timecodes = np.ascontiguousarray(
    np.asarray(merged.column("timecodes").to_numpy(zero_copy_only=False), dtype=np.float64)
)

columns = []
units = []
for n in names:
    arr = np.asarray(merged.column(n).to_numpy(zero_copy_only=False), dtype=np.float64)
    columns.append(np.ascontiguousarray(arr))
    units.append(ChannelMetadata.from_field(merged.schema.field(n)).units or "")

def _prim(v):
    return v if isinstance(v, (int, float, str)) else str(v)

metadata = {str(k): _prim(v) for k, v in (log.metadata or {}).items()}

if log.laps is not None and log.laps.num_rows:
    laps = {
        "num": [int(x) for x in log.laps.column("num").to_pylist()],
        "start": [int(x) for x in log.laps.column("start_time").to_pylist()],
        "end": [int(x) for x in log.laps.column("end_time").to_pylist()],
    }
else:
    laps = {"num": [], "start": [], "end": []}

{"timecodes": timecodes, "names": names, "units": units,
 "columns": columns, "metadata": metadata, "laps": laps}
`;

interface PyResult {
  timecodes: Float64Array;
  names: string[];
  units: string[];
  columns: Float64Array[];
  metadata: Record<string, string | number>;
  laps: { num: number[]; start: number[]; end: number[] };
}

async function parse(req: XrkParseRequest): Promise<void> {
  const pyodide = await getPyodide(req.indexUrl, req.wheelUrl);

  // Honor the real extension so libxrk's .xrz (zlib) path triggers correctly.
  const ext = /\.xrz$/i.test(req.fileName) ? "xrz" : "xrk";
  const path = `/session.${ext}`;
  pyodide.FS.writeFile(path, new Uint8Array(req.buffer));

  try {
    progress({ phase: "parse", message: "Parsing telemetry…" });
    pyodide.globals.set("XRK_PATH", path);
    const proxy = (await pyodide.runPythonAsync(PARSE_PY)) as {
      toJs(opts: { dict_converter: (entries: Iterable<[unknown, unknown]>) => unknown }): PyResult;
      destroy(): void;
    };

    progress({ phase: "extract", message: "Extracting channels…" });
    const obj = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();

    const channels = obj.names.map((name, i) => ({
      name,
      unit: obj.units[i] ?? "",
      values: obj.columns[i],
    }));

    const result: XrkRawResult = {
      timecodes: obj.timecodes,
      channels,
      metadata: obj.metadata,
      laps: obj.laps,
    };

    // Transfer every channel buffer + the timecodes buffer (zero-copy hand-off).
    const transfer: Transferable[] = [result.timecodes.buffer, ...channels.map((c) => c.values.buffer)];
    progress({ phase: "done", message: "Done" });
    post({ type: "result", result }, transfer);
  } finally {
    try {
      pyodide.FS.unlink(path);
    } catch {
      /* best-effort cleanup */
    }
  }
}

self.onmessage = (event: MessageEvent<XrkParseRequest>) => {
  const req = event.data;
  if (req?.type !== "parse") return;
  parse(req).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", message });
  });
};
