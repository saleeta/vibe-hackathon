# Spectacles / Lens Studio compliance notes for Person B

Not a legal review — practical points to keep the pipeline reviewable and
shippable on Spectacles.

- **Camera frames leave the device.** B1 sends a captured still frame to an
  external classifier endpoint over HTTPS (`InternetModule`). That's a
  network capability that must be declared/requested per Lens Studio's
  project capability requirements for internet access — check the project's
  capability settings in Lens Studio match what `PersonBController` actually
  calls. Don't silently add a second, undeclared network destination later
  without updating that.
- **Minimize what leaves the device.** Only the single frame needed for
  recognition is sent, not a continuous video stream — B1/B2 both operate on
  one still image per detected eating event, not a live feed to the backend.
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
- **No PII persistence built here.** This pipeline as written doesn't persist
  images or eating history anywhere — `PersonBController.onSessionClosed` has
  a `TODO` for wherever session summaries get sent next. If that becomes a
  server-side store of a user's eating history, that's health-adjacent
  personal data and should get its own privacy/retention review before
  shipping — flagging now so it isn't missed later.
