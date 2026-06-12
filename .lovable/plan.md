# Read-Aloud: 3-Tier Cascading TTS

## Goal
Rebuild the read-aloud engine layer so every device hears audio. Keep all UI (buttons, voice dropdown) and all LLM chat logic exactly as-is. Only the engine beneath the existing `ttsService` / `useKokoroTTS` hook changes.

## Architecture

```text
              ┌────────── Device detect (once) ──────────┐
              │  desktop → start Tier 1                  │
              │  mobile/tablet → start Tier 2            │
              └──────────────────┬───────────────────────┘
                                 │
   load+warm fails / 45s timeout │ falls down automatically
                                 ▼
   Tier 1 Kokoro (kokoro-js, ~86MB, WAV)
        │ fail ▼
   Tier 2 Kitten (KittenML/KittenTTS via @huggingface/transformers, ~25MB, WAV)
        │ fail ▼
   Tier 3 window.speechSynthesis (zero download, always works)
```

Every tier feeds the same shared playback layer so the per-message button states (idle/generating/playing/stop) and the existing voice dropdown keep working unchanged.

## Files

**New**
- `src/lib/ttsTier.ts` — device detection + `activeTier` state + cascade orchestrator. Exports `ttsEngine.speak/stop/preload`, `subscribe`, voice catalog for the active tier.
- `src/workers/kokoro.worker.ts` — renamed/cleaned existing worker, single-thread WASM, WebGPU-if-available, 45s load+warm timeout, "ready" only after silent `"ok"` warm-up succeeds, `TTS_CACHE_VERSION = "v1"`.
- `src/workers/kitten.worker.ts` — new worker using `@huggingface/transformers` (onnxruntime-web, WASM, `numThreads = 1`) running KittenML/KittenTTS pipeline (phonemize → ONNX → 24kHz WAV blob). Same timeout + warm-up gate.
- `src/lib/audioPlayback.ts` — singleton `AudioContext`, `unlockAudio()` (sync silent-buffer + resume — must be called inside the click gesture), `playPcmBlob(blob)` using `decodeAudioData` promise-or-callback, module-level `currentSource` for stop().

**Edited**
- `src/lib/ttsService.ts` — becomes a thin adapter delegating to `ttsTier.ts`; preserves the public API (`subscribe`, `getState`, `speak`, `stop`, `preload`, `warm`) the hook & Chat page already consume.
- `src/hooks/useKokoroTTS.ts` — unchanged public API; `useVoiceCatalog()` now returns voices for the active tier (Kokoro 11 voices / Kitten 8 voices labeled F/M / speechSynthesis voices grouped by lang).
- `package.json` — add `@huggingface/transformers` (keep `kokoro-js`).

**Untouched**
- `src/pages/Chat.tsx`, every LLM/chat path, all UI components, all read-aloud buttons & dropdown.

## Cascade & hardening rules (apply to Tier 1 & 2)
- Worker-only model load (UI never freezes).
- `env.backends.onnx.wasm.numThreads = 1`; `useBrowserCache = true`; `allowRemoteModels = true`.
- WebGPU only if `'gpu' in navigator` and `requestAdapter()` returns; else WASM.
- 45s timeout around load+warm. On timeout/error → mark tier `error` and cascade to next tier; never leave a stuck progress UI.
- "Ready" = silent `generate("ok", { voice })` succeeded. Downloaded ≠ initialized.
- `TTS_CACHE_VERSION = "v1"` constant included in cache namespace so we can invalidate later.

## Tier 3 (speechSynthesis) rules
- `speechSynthesis.speak()` called synchronously inside the click handler — `ttsEngine.speak` returns early after queuing if Tier 3 is active so no awaits intervene on iOS.
- `getVoices()` empty on first Safari call → also subscribe to `onvoiceschanged`.

## Preload behavior
- Desktop: background-preload Tier 1 after login (non-blocking).
- Mobile: background-preload Tier 2 unless `navigator.connection?.saveData` → lazy on first click.
- Tier 3: no preload.

## State
`{ activeTier: 1|2|3, modelState: 'idle'|'loading'|'ready'|'error', progress, generatingId, playingId, error }` — same shape the hook already exposes, plus `activeTier`. A subtle "Preparing voice…" pill only while a *model* tier is loading; vanishes on ready or cascade to Tier 3.

## Logging
Single diagnostic line before playback: `console.log("TTS tier:", activeTier, "| blob bytes:", blob.size)`. Cascade transitions logged once. All previous verbose TTS logs removed.

## Verification
- Desktop: Tier 1 plays, log shows `tier: 1`.
- iPhone/iPad: Tier 2 attempts; on success plays Kitten; on timeout cleanly falls to Tier 3 and still plays.
- Android: report landed tier + audio.
- Refresh on any device: cached model, no full re-download.

## Risks / open items
- KittenTTS browser path is preview-stage; the Tier 3 fallback is the safety net. We'll model the worker on the `clowerweb/kitten-tts-web-demo` reference and verify the exact ONNX filenames against `KittenML/KittenTTS` on HF at implementation time.
- Adding `@huggingface/transformers` ships additional JS to desktop too (Kitten worker is lazy-imported, so it only downloads when actually instantiated — desktop won't pay the cost unless cascade triggers).
