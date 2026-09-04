# Spectacles / Lens Studio compliance notes for Person B

Not a legal review — practical points to keep the pipeline reviewable and
shippable on Spectacles.

- **Camera frames leave the device.** Person A's `HttpFoodAnalysisClient`
  sends a captured HQ frame to `api/`'s `/v1/analyze` endpoint over HTTPS
  (`InternetModule`). That's a network capability that must be
  declared/requested per Lens Studio's project capability requirements for
  internet access — check the project's capability settings match the one
  `backendUrl` actually configured. Don't silently add a second, undeclared
  network destination later without updating that.
- **Minimize what leaves the device.** Only the single HQ frame needed for
  recognition is sent, not a continuous video stream — enforced on Person
  A's side by `EatingTrigger` (one `analyze()` call per confirmed
  `EATING_EVENT`, a `busy` guard against overlap, and A4's `cooldownMs`
  against re-triggering the same bite) and on Person B's side by B1/B2 both
  operating on that one still image, never a live feed.
- **No always-on recording implied.** Nothing in this pipeline starts a
  Spectacles hardware recording; see `SCREEN_RECORDING.md` — recording stays
  user-initiated via the physical button, which is the compliant default for
  wearable camera capture (visible indicator LED, user-triggered).
- **Uncertainty is surfaced, not hidden.** Every logged estimate carries a
  confidence/uncertainty value (B6) rather than presenting a guess as exact —
  relevant both for user trust (don't silently overstate calorie precision)
  and for review purposes.
- **Nutrition data is a placeholder.** `nutrition-service`'s seed database
  (`src/db/foods.json`) is a small hand-authored table for demo purposes, not
  a licensed nutrition database. Before any real usage, swap in a properly
  licensed source (USDA FoodData Central is public domain; Nutritionix/Edamam
  require API agreements) — see `nutrition-service/README.md`.
- **The glycemic load estimate is not a blood glucose reading, and must
  never be presented as one.** `nutrition-service` estimates a meal's
  glycemic load from its food composition (`GI × carbs / 100`, summed) —
  this is a rough, population-level, non-personalized indicator (no
  insulin sensitivity, no individual response curve, no digestion timing),
  not something derived from a sensor. It is exposed on
  `MealSummary.glycemicEstimate` and is explicitly separate from
  `MealSummary.measuredGlucose`, which is left unset by this pipeline and
  exists only for a future real CGM/fingerstick integration. Do not:
  - label the estimate "blood sugar" or "blood glucose" in any UI — call it
    an *estimated glycemic load*, with the food-derived caveat visible;
  - use it as an input to any insulin-dosing suggestion or similar clinical
    decision — that would cross from a nutrition-tracking feature into
    medical-device territory, and this pipeline was not built or validated
    for that; a wrong dose from a wrong estimate is a harm this app must
    not be able to cause;
  - conflate it with a real reading if a CGM integration is added later —
    keep them as separate fields/UI elements, per `ARCHITECTURE.md`.
  If the product direction genuinely needs blood-glucose logging for
  diabetics (not just an estimate), that means integrating a real glucose
  sensor/device API, not extrapolating further from food photos.
- **`api/`'s vision backend sends photos to a third party.**
  `ClaudeVisionClassifier` sends the full image to Anthropic's API over HTTPS
  to identify food and estimate portions — this is real third-party data
  transmission, not hypothetical, whenever `/v1/food/classify` or
  `/v1/analyze` is called. That's consistent with the "camera frames leave
  the device" point above for the live-Spectacles path, but worth restating
  because `test-images/` photos are whatever the user drops in that folder —
  don't put images there that shouldn't be sent to Anthropic's API. Check
  Anthropic's API terms/data-handling policy before sending anything
  sensitive, and see the "minimize what leaves the device" point above — the
  same one-frame-per-event principle should hold for any real deployment.
- **No PII persistence built here.** This pipeline as written doesn't
  persist images or eating history anywhere — `api/`'s `/v1/analyze`
  computes and returns a result per request with nothing written to disk or
  a database, and the Lens-side display (`AutoLogDisplay`/`NutritionHUD`)
  only shows-then-fades. If a server-side store of a user's eating history
  gets added later, that's health-adjacent personal data and should get its
  own privacy/retention review before shipping — flagging now so it isn't
  missed later.
