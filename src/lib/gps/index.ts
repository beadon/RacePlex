// Custom GPS capture layer for the phone-as-datalogger pipeline.
// Data model + pure derivation (gpsFix) and the stateful source (customGps).
// No lap-timing logic lives here — this is the capture layer only.

export * from './gpsFix';
export * from './customGps';
