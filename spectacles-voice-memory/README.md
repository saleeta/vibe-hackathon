# Voice Agent + Lost-Object Memory (B1-B4)

Self-contained Lens Studio TypeScript package: a push-to-talk voice agent
that answers "where are my keys" by looking up the last time that object
was seen today, showing a brief backwards "rewind" through the frames
leading up to that moment, and speaking the answer in a natural voice.

Standalone from `spectacles-perception` on purpose (duplicated `Signal`/
`RingBuffer` instead of importing) — either module can be dropped into a
different project alone.

## Flow

```
SightingTracker (B1)                    VoiceListener (B3)
  consumes onObjectDetected                pinch-down -> ASR starts
  (whatever detector is plugged in)        pinch-up   -> ASR stops, parses
  finalizes a sighting once an             "where are my X" locally,
  object leaves view for settleMs          no network round-trip
        |                                        |
        v                                        v
  onSightingRecorded                       onVoiceIntent
        |                                        |
        v                                        v
  ObjectMemoryStore (B2)  <-------- VoiceMemoryOrchestrator
  keeps latest sighting per class          looks up the store,
  (in-memory + persisted metadata)         publishes onLocateObjectResult
                                                  |
                                    +-------------+-------------+
                                    v                           v
                          VoiceResponder (B3)           RewindPopup (B4)
                          speaks the answer              plays the rewind,
                          via "Sasha" TTS voice           shows the caption
```

## Folder layout

```
Scripts/
  Core/                    shared types + event bus + ring buffer
  B1_ObjectSighting/       IObjectDetector seam, FrameSnapshotter (low-fps camera), SightingTracker
  B2_ObjectMemoryStore/    the "database" — last sighting per object class
  B3_VoiceAgent/           VoiceListener (ASR + local intent parsing), VoiceResponder (TTS)
  B4_LostObjectUI/         RewindPopup — glass-tile UI + frame playback
  VoiceMemoryOrchestrator.ts   wires B3's intent to B2's lookup, publishes the result
  DebugVoiceMemoryHarness.ts  test every state without a mic or a trained detector
```

## Wiring into a scene

One root `VoiceMemoryModule` object holding: `FrameSnapshotter`,
`SightingTracker` (`frameSnapshotter` -> the one above), `ObjectMemoryStore`,
`VoiceListener`, `VoiceResponder` (`voiceAudio` -> an `AudioComponent`),
`VoiceMemoryOrchestrator` (`store` -> `ObjectMemoryStore`),
`DebugVoiceMemoryHarness`. Plus a small UI child (Canvas -> ScreenTransform
-> `Image` + `Text`) carrying `RewindPopup` (`previewImage`, `captionText`).

## What's real vs. what's stubbed

**Real, verified against the compiler/docs:**
- `AsrModule` push-to-talk speech-to-text, triggered by SIK's pinch gesture.
- `TextToSpeechModule` with the **"Sasha"** voice — Lens Studio's
  officially documented natural/humanistic preset, not a robotic default.
- `global.persistentStorageSystem.store` for cross-restart metadata.
- Local, instant, on-device intent parsing for "where are my X" — no LLM
  round-trip, which is what actually makes this feel realtime.

**Deliberately stubbed / honest limitations:**
- **No general object detector.** Recognizing "keys" vs. "phone" vs.
  "glasses" in a frame needs a trained multi-class model this project
  doesn't have (same situation as `spectacles-perception`'s food
  classifier). `IObjectDetector` is the seam to plug one in;
  `DebugVoiceMemoryHarness.simulateObjectSeenThenGone()` feeds detections
  manually until then.
- **No location labeling.** "You left your keys near the table" requires
  knowing what "the table" is — no scene/surface understanding is
  implemented. `ObjectSighting.locationLabel` is never fabricated; the
  spoken response honestly falls back to "I last saw your X {time ago}"
  unless something upstream sets a real label.
  `simulateFoundWithLocation()` previews the intended full experience.
- **The "video snippet" is a still-frame sequence, not video.** A rolling
  buffer of low-res camera frames (`FrameSnapshotter`, ~2 FPS) played back
  in reverse — a real, working "rewind," just not literal video recording
  (no verified Lens Studio API for that was used here).
- **Snippets don't survive an app restart.** They're `Texture` handles,
  which can't go through the string-based persistent store — only the
  sighting's timestamp (and location, if any) persists. A sighting from an
  earlier session still answers "when," just without the visual rewind.
- **No SFX for `RewindPopup.rewindSound`.** Lens Studio's searchable
  music/asset libraries turned up only full-length licensed songs with
  "rewind" in the title, not short sound effects — left unassigned rather
  than wired to the wrong kind of asset.

## Known TODOs / needs in-editor verification

- `FrameSnapshotter`: exact method name for freezing a live camera texture
  into an independent snapshot (assumed `copyFrame()`, referenced in Lens
  Studio docs for this exact purpose, not directly confirmed by a compile).
- `VoiceListener`: `GestureModule.HandType` enum member names
  (assumed `.Left`/`.Right`).
- `RewindPopup`: `Rect.create()`'s argument order (assumed left, right,
  bottom, top — same open question as `AutoLogDisplay`).
- Whether two independent `CameraModule.requestCamera` streams (this
  module's `FrameSnapshotter` + `spectacles-perception`'s `CameraSampler`)
  can run at once if both modules ship together — not verified on device.
