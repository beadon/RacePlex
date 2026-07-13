// Shared progress shape for the slow, async importers.
//
// Two formats can't be parsed in a tick — AiM XRK (libxrk wasm in a worker) and
// GoPro MP4 (GPMF extraction reads the whole video). Both stream phase messages
// while they work, and both feed the same consumer: `parseDatalogFile`, which
// pipes `message` into the <FileLoadingOverlay>. This is the type they agree on.
//
// `phase` is deliberately a plain string: each importer names its own phases
// (see `XrkPhase`, `GoProPhase`) and nothing outside them reads it — the UI only
// ever shows `message`.

export interface ImportProgress {
  /** Importer-specific phase id (informational). */
  phase: string;
  /** Human-readable status shown under the loading spinner. */
  message: string;
  /** 0..1 when a meaningful fraction is known, else undefined (indeterminate). */
  ratio?: number;
}

export type ImportProgressCallback = (progress: ImportProgress) => void;
