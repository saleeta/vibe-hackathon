/**
 * Wires B1-B6 together and is the single entry point Person A's eating-event
 * detector calls into: `onEatingEventDetected(input)`.
 *
 * This is the ONLY file in PersonB/ that touches Lens Studio SDK types
 * (SceneObject, InternetModule, etc.) — everything else is plain, portable
 * TS. That split is deliberate: it's the boundary between "logic we can unit
 * test / demo in plain Node" and "glue that only makes sense inside Lens
 * Studio."
 *
 * NOTE on API surface: Lens Studio's SDK has moved things between versions
 * before (RemoteServiceModule.fetch -> InternetModule.fetch as of LS 5.9) —
 * verify `global.internetModule` / `InternetModule` is still the correct
 * entry point against the Lens Studio version this project is opened in,
 * and adjust the call marked LENS-STUDIO-API below. `input.imageBase64` is
 * expected to already be base64-encoded by Person A's capture code before
 * it reaches this controller.
 */

import { FoodRecognitionService, HttpFoodClassifierBackend } from "./FoodRecognitionService";
import { PortionEstimator } from "./PortionEstimator";
import { NutritionClient, PostJson } from "./NutritionClient";
import { EatingSessionManager } from "./EatingSessionManager";
import { ConfidenceAggregator } from "./ConfidenceAggregator";
import { EatingEventInput, EatingSession, MealSummary } from "./Types";

// Config — point these at your deployed food-classifier endpoint and the
// nutrition-service from this repo (see nutrition-service/README.md).
const FOOD_CLASSIFIER_ENDPOINT = "https://YOUR_FOOD_CLASSIFIER_ENDPOINT/classify";
const NUTRITION_SERVICE_BASE_URL = "https://YOUR_NUTRITION_SERVICE_HOST";

// @ts-ignore — BaseScriptComponent/component/input come from Lens Studio's injected SDK typings, not visible outside Lens Studio.
@component
export class PersonBController extends BaseScriptComponent {
  private foodRecognition!: FoodRecognitionService;
  private portionEstimator!: PortionEstimator;
  private nutritionClient!: NutritionClient;
  private sessionManager!: EatingSessionManager;

  onAwake() {
    const postJson: PostJson = (url, body) => this.postJsonViaInternetModule(url, body);

    this.foodRecognition = new FoodRecognitionService(
      new HttpFoodClassifierBackend(FOOD_CLASSIFIER_ENDPOINT, postJson)
    );
    this.portionEstimator = new PortionEstimator();
    this.nutritionClient = new NutritionClient(NUTRITION_SERVICE_BASE_URL, postJson);
    this.sessionManager = new EatingSessionManager((closedSession) => this.onSessionClosed(closedSession));

    // Lens Studio update tick — lets a session close from inactivity even if
    // no new eating events arrive (B4/B5's "session closes after inactivity").
    this.createEvent("UpdateEvent").bind(() => {
      this.sessionManager.checkTimeout(getTime());
    });
  }

  /** Person A calls this when their hand+food eating-event detector fires. */
  async onEatingEventDetected(input: EatingEventInput): Promise<void> {
    const recognizedItems = await this.foodRecognition.recognize(input.imageBase64, input.roiHint);
    if (recognizedItems.length === 0) return; // nothing recognized with enough confidence — drop this frame

    const observations = recognizedItems.map((item) => {
      const portion = this.portionEstimator.estimate(item.food, item.boundingBox, input.hand, item.confidence);
      return {
        food: item.food,
        weightG: portion.estimatedWeightG,
        weightUncertaintyG: portion.uncertaintyG,
        foodConfidence: item.confidence,
        portionConfidence: portion.confidence,
      };
    });

    // Whether this frame showed a single bite or a whole plate, log every
    // food detected in it as one atomic group at this timestamp (B4). Each
    // food dedupes against its own prior state (B5), so it's safe to call
    // this again on every subsequent frame the same plate stays in view —
    // it won't inflate the plate's calories each time it's looked at again.
    this.sessionManager.addPlateObservation(input.timestampSec, observations);

    // Confidence is logged per observation too (B6), not just at session close,
    // so the MVP has per-frame data to evaluate against.
    recognizedItems.forEach((item, i) => {
      const obs = observations[i];
      const obsConfidence = ConfidenceAggregator.forObservation(input.eatingConfidence, item.confidence, obs.portionConfidence);
      print(`[PersonB] observed ${item.food} ~${obs.weightG}g (overall confidence ${obsConfidence.overall})`);
    });
  }

  private async onSessionClosed(session: EatingSession): Promise<void> {
    if (session.items.length === 0) return;

    const mealItems = EatingSessionManager.summarizeByFood(session).map((i) => ({ food: i.food, weightG: i.weightG }));
    const { totals, glycemicEstimate } = await this.nutritionClient.meal(mealItems);

    // TODO: thread A's per-observation eatingConfidence through the session instead of
    // defaulting to 1 — needs EatingSessionManager to track it alongside each item.
    const sessionEatingConfidence = 1;
    const confidence = ConfidenceAggregator.forSession(session.items, sessionEatingConfidence);

    const summary: MealSummary = {
      sessionId: session.id,
      startedSec: session.startedSec,
      closedSec: session.closedSec ?? getTime(),
      items: session.items,
      totals,
      confidence,
      glycemicEstimate,
      // measuredGlucose is intentionally left unset here — this pipeline has no
      // sensor input. Attach a real CGM/fingerstick reading to `summary` at
      // whatever point a device integration exists; never fill this from the
      // food-derived glycemicEstimate above.
    };

    print(
      `[PersonB] Eating Session ${summary.sessionId}: ${summary.totals.kcal} kcal, ` +
        `${summary.totals.proteinG}g protein (confidence ${summary.confidence.overall}), ` +
        `estimated glycemic load ${glycemicEstimate.totalGlycemicLoad} (${glycemicEstimate.category})`
    );

    // TODO: emit `summary` to whatever consumes it next (a display script,
    // a persistence/analytics call, etc.) via a Lens Studio Event or a
    // direct reference to that script.
  }

  // LENS-STUDIO-API: verify against the installed Lens Studio version.
  // As of Lens Studio 5.9+, fetch/HTTP moved from RemoteServiceModule to
  // InternetModule (see docs/ARCHITECTURE.md for the source).
  private async postJsonViaInternetModule(url: string, body: unknown): Promise<unknown> {
    // @ts-ignore — global.deviceInfoSystem/internetModule are Lens Studio globals.
    const internetModule = global.internetModule as {
      fetch: (url: string, options: any) => Promise<{ json(): Promise<unknown>; ok: boolean; status: number }>;
    };

    const response = await internetModule.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    return response.json();
  }
}
