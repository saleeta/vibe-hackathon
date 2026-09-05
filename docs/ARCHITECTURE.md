# Architecture — perception and nutrition, one pipeline

The perception module (`lens-studio/spectacles/Assets/` — `Camera/`, `Hands/`,
`FoodDetection/`, `EatingDetection/`, `Capture/`) detects "food is in the
hand, and it's genuinely being eaten" and captures a high-quality frame. The
nutrition pipeline (`Assets/Nutrition/`, `Assets/UI/`, `api/`,
`nutrition-service/`) turns that frame into calories, macros, and an
estimated glycemic load, shown back on screen. The two meet at exactly one
seam.

## The seam: `IFoodAnalysisClient`

The perception side already designed this integration point before the
nutrition side's real code existed (`Assets/Capture/FoodAnalysisClient.ts`):

```ts
export interface IFoodAnalysisClient {
  analyze(frame: Texture, context: EatingEventPayload): Promise<FoodAnalysisResult>;
}
```

`HttpFoodAnalysisClient` (the perception side's own implementation of it)
POSTs a JPEG-encoded frame plus context to a configurable `backendUrl` and
expects `{ name, grams, kcal, confidence, ... }` back. That request/response
shape turned out to match `api/`'s `POST /v1/analyze` almost exactly — so
**no new Lens-side networking code was needed**. Point
`HttpFoodAnalysisClient.backendUrl` at `api/`'s `/v1/analyze` endpoint and
the two sides are wired.

```
                    Perception (Camera/Hands/FoodDetection/EatingDetection/Capture)   Nutrition
┌──────────────────────────────────────────────────┐   ┌──────────────────────────────┐
│ CameraSampler → HandTracker → FoodInHandClassifier │   │                              │
│      → EatingEventDetector (state machine)         │   │                              │
│      → onEatingEvent { food_object, confidence,    │   │                              │
│                         timestampMillis }           │   │                              │
│      → EatingTrigger: captureHighQuality()          │   │                              │
│      → HttpFoodAnalysisClient.analyze(frame, ctx)  │──▶│  api/  POST /v1/analyze      │
│           POST { image_base64, food_hint,           │   │   recognition → portion      │
│                  detection_confidence,               │   │   → aggregation/dedup        │
│                  timestamp_millis }                  │◀──│   → nutrition lookup          │
└──────────────────────────────────────────────────┘   │   → confidence (see below)    │
                    │                                    │  returns FoodAnalysisResult   │
                    ▼                                    │  (flat + full MealSummary)   │
      Assets/UI/NutritionHUD.ts subscribes to            └──────────────────────────────┘
      onFoodAnalyzed and shows food + kcal + macros +
      glycemic load + confidence, then fades out
```

## What `/v1/analyze` does with the perception side's request

`api/src/pipeline/analyzePlateImage.ts` runs the same recognition-through-
confidence chain whether the frame came from the live `EatingTrigger` or a
manually-uploaded test photo (`test-images/`) — the only thing that differs
is `EatingEventContext`:

- `food_hint` (the on-device classifier's classified `food_object`) is
  passed to food recognition as a disambiguation hint — the vision prompt is
  told to *verify* it against the image, not trust it blindly
  (`OpenRouterVisionClassifier.ts`).
- `detection_confidence` (confidence this was genuinely an eating event)
  becomes the confidence aggregator's `eatingConfidence` input, instead of
  the `1.0` used for a deliberately-uploaded test photo where there's no
  such ambiguity.
- `timestamp_millis` becomes the eating-session timestamp.

Portion estimation uses the **vision-direct** method
(`PortionEstimator.fromVisionEstimate`) for both the live and test-photo
paths — `HandTracker` reports world-space hand positions (via SIK), not the
camera-space pixel geometry `PortionEstimator.estimate`'s hand-scale method
needs, so that geometric method currently has no live data feeding it. It's
still implemented and reachable (`POST /v1/portion/estimate`) for whenever
pixel-space hand geometry becomes available — see "Known gaps" below.

## The response: one shape, two readers

`/v1/analyze`'s response is a superset:

```
{
  // flat — what HttpFoodAnalysisClient reads into FoodAnalysisResult
  name, grams, kcal, confidence,
  proteinG, carbsG, fatG, weightUncertaintyG,
  glycemicLoad, glycemicCategory,
  foodConfidence, portionConfidence,
  items: [{ food, weightG }, ...],   // every food detected, not just the primary one

  // nested — the full MealSummary, for anything that wants more detail
  sessionId, startedSec, closedSec,
  items: SessionFoodItem[], totals, confidence: {...}, glycemicEstimate: {...}
}
```

`name`/`grams` flatten to the heaviest detected item / the summed weight
across all items — a live eating event is almost always one food, but a
frame can still show more than one (see meal aggregation below), so
`items[]` is there for anything that wants the full list.

## The visual

`Assets/UI/NutritionHUD.ts` subscribes to `PerceptionEvents.onFoodAnalyzed`
and shows the result. It's a single component with a `compactMode` input —
`true` shows a minimal one-liner (`"Apple · ~95 kcal"`), `false` shows the
fuller card (headline, a macros line, a glycemic-load line — explicitly
labeled *estimated*, never "blood sugar", see `COMPLIANCE.md` — and a
confidence line). Same no-button, auto-fade UX either way: nothing to tap,
shows on every `onFoodAnalyzed`, fades out automatically. (There used to be
two separate components for this — a compact one and a full-card one, each
with its own listener and fade loop against the same event; they're merged
into one now so only one Update-bound fade loop ever runs at a time.)

## Meal aggregation: one plate, one eating session, no double-counting

A single frame can show one food (a bite) or several (a plate — rice,
chicken, broccoli, sauce). `EatingSessionManager.addPlateObservation`
commits every food recognition detects in a frame as one atomic group, and
tracks "in progress" state **per food name** — so a plate seen again on a
later frame updates the running estimate for each food individually instead
of appending duplicate line items. The session stays open across
bites/plates and closes after inactivity, producing exactly one set of
logged calories per real eating session. See `EatingSessionManager.ts`'s
header comment for the full reasoning (including a past bug this design
specifically fixes: a single "most recently active item" tracker let a
plate's foods interfere with each other's dedup).

## Glycemic load estimate (extends the nutrition engine)

`nutrition-service` carries a glycemic index (GI) per food and returns an
estimated glycemic load (`GI × carbs / 100`, summed over the session),
surfaced as `glycemicLoad`/`glycemicCategory` (flat) and `glycemicEstimate`
(nested). **Derived entirely from food composition — not a measured blood
glucose value.** `FoodAnalysisResult` and `MealSummary` both keep this
field separate from any future real sensor reading; see `COMPLIANCE.md` for
why that distinction is load-bearing for a diabetes-adjacent feature.

## Why the code is split the way it is

`lens-studio/spectacles/Assets/` is one codebase, organized by pipeline
stage, with the perception and nutrition sides only touching each other
through `Core/PerceptionEvents.ts`'s signal bus:

- **Perception** (`Core/`, `Camera/`, `Hands/`, `FoodDetection/`,
  `EatingDetection/`, `Capture/`) — every script talks to its neighbors only
  through signals, never direct references — see `Assets/README.md` for the
  full state machine and event contract.
- **Nutrition** (`Nutrition/`) — six plain-TypeScript files (`Types.ts`,
  `FoodRecognitionService.ts`, `PortionEstimator.ts`, `NutritionClient.ts`,
  `EatingSessionManager.ts`, `ConfidenceAggregator.ts`). All of them take no
  dependency on Lens Studio SDK globals — driven purely by data in, data
  out — so they run in plain Node (see `examples/demo.ts`) without opening
  Lens Studio or wearing hardware. `Assets/UI/NutritionHUD.ts` is the one
  Lens-coupled nutrition file, and it's a leaf: nothing else in
  `Nutrition/` depends on it.

There's no separate "controller" Lens component for the nutrition side —
`Capture/EatingTrigger.ts` + `Capture/FoodAnalysisClient.ts` (pointed at
`api/`) already own that role, per the seam above.

`nutrition-service/` is the nutrition engine, and is deliberately a
standalone HTTP service, not Lens code — per the spec ("build this as a
separate service"), and because a food nutrition database doesn't belong
bundled into a Spectacles Lens build. `api/` is food recognition/portion/
confidence (+ the composed pipeline) as their own HTTP service for the same
reason vision/compute-heavy work shouldn't run on-device, and because it's
what both `HttpFoodAnalysisClient` and `test-images/`'s batch script call.

## Lens Studio SDK notes (verify against your installed version)

- **HTTP calls**: as of Lens Studio 5.9, `fetch`/`performHttpRequest` live on
  `InternetModule`, not the older `RemoteServiceModule`
  ([Internet Access docs](https://developers.snap.com/spectacles/about-spectacles-features/apis/internet-access)).
  Both `HttpFoodAnalysisClient` and this doc assume that surface; verify
  against whatever Lens Studio version the project is actually opened in.
- **Remote Service Gateway**: Snap also offers a
  [Remote Service Gateway](https://developers.snap.com/spectacles/about-spectacles-features/apis/remoteservice-gateway)
  for calling specific hosted AI APIs from a Lens without managing your own
  proxy/auth — worth evaluating as an alternative to `api/` if it covers a
  suitable vision API directly.
- Several perception-side files carry their own `TODO(verify)` markers for
  exact Lens Studio 5.15.4 API surface (texture encoding, `MLComponent` I/O,
  Text opacity property path) — `NutritionHUD.ts` carries the same
  Text-opacity uncertainty.

## Known gaps (documented on purpose, not hidden)

- **The hand-geometry portion method has no live data feeding it.**
  `HandTracker` reports world-space positions (via SIK), not the
  camera-space pixel width `PortionEstimator.estimate` needs. The
  vision-direct method (`PortionEstimator.fromVisionEstimate`) is what
  actually runs for both live and test-photo paths right now. Converting
  the perception side's world-space hand geometry to camera-space pixel
  width (via camera projection) would let the live path use the
  more-grounded geometric method — worth doing once real accuracy numbers
  from either method exist to compare.
- **Meal aggregation/dedup** merges consecutive same-food observations (per
  food name) within a short gap (default 6s) into one item, and closes the
  session after a longer inactivity gap (default 3 min). Both are
  constructor parameters, easy to tune against real usage data.
- **Confidence** combines eating/food/portion confidence with a weighted
  geometric mean (not a plain average) specifically so one badly-estimated
  stage drags the overall score down instead of being diluted out — see the
  comment in `ConfidenceAggregator.ts`.
