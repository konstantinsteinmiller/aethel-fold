/**
 * ─── Every game's voice lines, for the tooling ──────────────────────────────
 *
 * The runtime registers lines whenever the module that owns them is imported.
 * The voice-over tools (`scripts/lib/voiceLines.ts`) run outside the app, so
 * they import *this* module, and this module imports every module that calls
 * `registerVoiceLines`. Add a side-effect import here when a game gains lines:
 *
 *   import '@/fold/voiceLines'
 *
 * Empty today — no shipped game has spoken lines yet.
 */

export {}
