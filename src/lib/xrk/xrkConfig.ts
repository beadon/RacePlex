// Pinned configuration for the AiM .xrk/.xrz importer (libxrk + Pyodide).
//
// Why everything is pinned: the libxrk wheel is a Rust/Cython extension
// cross-compiled for one specific Pyodide/Emscripten ABI. A wheel built for the
// Pyodide 0.27 ABI (`pyodide_2024_0_wasm32`) will NOT load in another Pyodide
// release — so the Pyodide runtime version, the package set, and the wheel ABI
// must all move together. See `scripts/build-xrk-wheel.sh` and the README
// "AiM .xrk / .xrz import" section before bumping any of these.

/** Pyodide runtime version. MUST match the ABI the wheel was built against. */
export const XRK_PYODIDE_VERSION = "0.27.3";

/**
 * Where the Pyodide runtime (interpreter wasm + stdlib + numpy/pyarrow packages)
 * is loaded from. This is a *runtime* network dependency — unlike the rest of the
 * app, importing a `.xrk`/`.xrz` is online-only (the accepted offline-first
 * exception, like weather and satellite tiles). The libxrk wheel itself is
 * self-hosted (see `XRK_WHEEL_PATH`).
 */
export const XRK_PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${XRK_PYODIDE_VERSION}/full/`;

/**
 * Pyodide packages loaded via `loadPackage` before the libxrk wheel. libxrk
 * returns PyArrow tables (and uses numpy internally), so both must be present;
 * `micropip` installs the self-hosted wheel.
 */
export const XRK_PYODIDE_PACKAGES = ["numpy", "pyarrow", "micropip"] as const;

/**
 * Filename of the self-hosted libxrk wheel under `public/xrk/`. Built by
 * `scripts/build-xrk-wheel.sh` (mirrors libxrk's own `pyodide.yml` CI). The
 * `pyodide_2024_0_wasm32` platform tag is the Pyodide 0.27 ABI.
 */
export const XRK_WHEEL_FILENAME =
  "libxrk-0.12.0-cp312-cp312-pyodide_2024_0_wasm32.whl";

/** Relative URL the wheel is served from (resolved against the app origin). */
export const XRK_WHEEL_PATH = `/xrk/${XRK_WHEEL_FILENAME}`;

/** Extensions handled by the XRK importer. */
export const XRK_EXTENSIONS = [".xrk", ".xrz"] as const;
