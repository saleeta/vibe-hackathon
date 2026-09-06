import { PerceptionEvents } from '../Core/PerceptionEvents';
import { CameraSampler } from '../Camera/CameraSampler';
import { IFoodAnalysisClient } from './FoodAnalysisClient';
import { appendMealLogEntry } from './MealLog';

/**
 * Automatic capture + analysis trigger.
 *
 *   continuous cheap perception -> eating detected -> HQ capture -> backend
 *
 * This is the only place in the module that talks to the backend, and it
 * calls it **once per eating session, not once per bite**. A real meal is
 * many confirmed bites in a row (`EatingEventDetector` fires `onEatingEvent`
 * on each one, gated only by its own short `cooldownMs` against
 * double-counting the *same* bite) — without a session-level gate here,
 * every single bite would trigger its own HQ capture + network call, which
 * is both wasteful (repeated identical/near-identical vision calls for one
 * meal) and needlessly increases exposure to any backend's rate limits.
 * `sessionGapMs` suppresses further backend calls until that much time has
 * passed since the last *successful* analysis — the next bite after that
 * gap starts a new session and gets analyzed again. Kept short (7s) rather
 * than matching `EatingSessionManager`'s full 3-minute meal-inactivity
 * window — that longer value made sense against a shared/free-tier vision
 * backend where every call mattered, but was frustrating to actually use or
 * demo (holding up a second, different food shortly after the first just
 * did nothing). Raise it back toward a few minutes for real "one log per
 * meal" production behavior once that matters more than fast iteration.
 *
 * Swap `foodAnalysisClient` between HttpFoodAnalysisClient and
 * MockFoodAnalysisClient (same @input slot, both implement
 * IFoodAnalysisClient) to demo without a live backend.
 */
@component
export class EatingTrigger extends BaseScriptComponent {
  @input
  cameraSampler: CameraSampler;

  @input('Component.ScriptComponent')
  foodAnalysisClientComponent: ScriptComponent; // must implement IFoodAnalysisClient

  @input
  @hint('Once a bite is successfully analyzed, further bites within this many ms are treated as the same eating session and skip the backend call.')
  sessionGapMs: number = 7000;

  private get foodAnalysisClient(): IFoodAnalysisClient {
    return this.foodAnalysisClientComponent as unknown as IFoodAnalysisClient;
  }

  private busy = false;
  private busySinceMs = 0;
  private lastAnalysisAtMs = -Infinity;
  private lastSkipLogAtMs = -Infinity;

  /** If an analyze() call hangs (no timeout on the vision request), don't let `busy` block every future event forever. */
  private readonly busyWatchdogMs = 20000;

  onAwake(): void {
    PerceptionEvents.onEatingEvent.add((evt) => this.handleEatingEvent(evt));
  }

  private async handleEatingEvent(evt: { food_object: string; confidence: number; timestampMillis: number }) {
    const nowMs = getTime() * 1000;
    if (this.busy) {
      if (nowMs - this.busySinceMs > this.busyWatchdogMs) {
        print('[FoodLens:Trigger] Previous analysis never returned — clearing the busy flag.');
        this.busy = false;
      } else {
        if (nowMs - this.lastSkipLogAtMs > 3000) {
          this.lastSkipLogAtMs = nowMs;
          print('[FoodLens:Trigger] Skipped — an analysis is still in flight.');
        }
        return;
      }
    }
    if (evt.timestampMillis - this.lastAnalysisAtMs < this.sessionGapMs) {
      if (nowMs - this.lastSkipLogAtMs > 3000) {
        this.lastSkipLogAtMs = nowMs;
        print('[FoodLens:Trigger] Skipped — within the session cooldown since the last analysis.');
      }
      return;
    }

    this.busy = true;
    this.busySinceMs = nowMs;
    print('[FoodLens:Trigger] Capturing HQ frame and analyzing...');
    try {
      const hqTexture = await this.cameraSampler.captureHighQuality();
      PerceptionEvents.onHighQualityFrameCaptured.invoke({ texture: hqTexture, timestampMillis: evt.timestampMillis });

      const result = await this.foodAnalysisClient.analyze(hqTexture, evt);
      this.lastAnalysisAtMs = evt.timestampMillis; // only start the session gate once a call actually succeeds — a failed call can retry on the next bite

      print(`[FoodLens:Trigger] Analysis done: "${result.name}" ~${Math.round(result.kcal)} kcal (confidence ${Math.round((result.confidence ?? 0) * 100)}%).`);

      appendMealLogEntry({
        name: result.name,
        kcal: result.kcal,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
        glycemicLoad: result.glycemicLoad,
        timestampMillis: evt.timestampMillis,
      });

      // The HUD (and anything else the main app wires up) picks this up automatically.
      PerceptionEvents.onFoodAnalyzed.invoke(result);
    } catch (err) {
      print(`[FoodLens:Trigger] ERROR — analysis failed: ${err}`);
    } finally {
      this.busy = false;
    }
  }
}
