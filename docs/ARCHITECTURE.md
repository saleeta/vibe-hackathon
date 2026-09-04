# Person B — architecture

Person A owns eating-event detection (hand + food proximity in frame) and
calls into Person B's pipeline once per detected frame:

```
Person A: "eating event detected" ─┐
                                    ▼
                     PersonBController.onEatingEventDetected(input)
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
              B1 Food          B2 Portion       (hand geometry,
              recognition      estimation        depth, from A)
                    │               │
                    └───────┬───────┘
                            ▼
              B4/B5 EatingSessionManager.addObservation()
              (dedupes repeated looks at the same bite,
               keeps the session open across bites,
               closes it after inactivity)
                            │
                     session closes
                            ▼
              B3 nutrition-service  (food + grams -> macros,
                                      summed over the session)
                            │
                            ▼
              B6 ConfidenceAggregator -> MealSummary
```

## Why the code is split the way it is

`lens-studio/Assets/Scripts/PersonB/` has one Lens-Studio-coupled file
(`PersonBController.ts`) and five plain-TypeScript files (`Types.ts`,
`FoodRecognitionService.ts`, `PortionEstimator.ts`, `NutritionClient.ts`,
`EatingSessionManager.ts`, `ConfidenceAggregator.ts`). The plain files take no
dependency on Lens Studio SDK globals — they're driven purely by data in,
data out — so they can be exercised in a real Node process (see
`examples/demo.ts`) without opening Lens Studio or wearing hardware. That's
the fastest debug loop for the session/dedup logic (B4/B5), which is the part
most worth getting right before wiring up real hardware.

`nutrition-service/` is B3, and is deliberately a standalone HTTP service, not
Lens code — per the spec ("build this as a separate service"), and because a
food nutrition database doesn't belong bundled into a Spectacles Lens build.

## Lens Studio SDK notes (verify against your installed version)

- **HTTP calls**: as of Lens Studio 5.9, `fetch`/`performHttpRequest` live on
  `InternetModule`, not the older `RemoteServiceModule`
  ([Internet Access docs](https://developers.snap.com/spectacles/about-spectacles-features/apis/internet-access)).
  `PersonBController.postJsonViaInternetModule` is the one place that calls
  this — check it against whatever Lens Studio version the project is opened
  in, since this API has moved before.
- **Images over the network**: Snap's own guidance is to prefer Remote
  Assets authored at Lens-build time rather than fetching images dynamically.
  That guidance is about *pulling* remote image assets into the Lens (e.g.
  textures); it doesn't apply to *sending* a captured frame out to a
  classifier, which is what B1 does — but keep an eye on it if the
  vision backend design changes.
- **Remote Service Gateway**: Snap also offers a
  [Remote Service Gateway](https://developers.snap.com/spectacles/about-spectacles-features/apis/remoteservice-gateway)
  for calling specific hosted AI APIs from a Lens without managing your own
  proxy/auth. Worth evaluating as the food-classifier backend instead of a
  fully custom endpoint, depending on which vision model the team picks.

## Known MVP simplifications (documented on purpose, not hidden)

- **B2 portion estimation** is a geometric heuristic (bounding-box footprint
  × per-food shape/density model, scaled using the hand as a ruler), not a
  learned depth model. See the comment block at the top of
  `PortionEstimator.ts` for the exact assumptions and what to replace first.
- **B4/B5 bite tracking** merges consecutive same-food observations within a
  short gap (default 6s) into one item, and closes the session after a
  longer inactivity gap (default 3 min). Two *non-contiguous* helpings of the
  same food (e.g. going back for more chicken) become two session items, then
  get summed together for display/totals via
  `EatingSessionManager.summarizeByFood()`. Both timeouts are constructor
  parameters, not hardcoded, so they're easy to tune against real usage data.
- **B6 confidence** combines eating/food/portion confidence with a weighted
  geometric mean (not a plain average) specifically so one badly-estimated
  stage drags the overall score down instead of being diluted out — see the
  comment in `ConfidenceAggregator.ts`.
- Person A does not yet pass a per-observation `eatingConfidence` through to
  session close; `PersonBController.onSessionClosed` currently defaults it to
  `1` with a `TODO` marking exactly where to wire the real value through.
