import { PerceptionEvents } from '../Core/PerceptionEvents';
import { CameraSampler } from '../A1_CameraSampler/CameraSampler';
import { IFoodAnalysisClient } from './FoodAnalysisClient';

/**
 * A5 — Automatic trigger.
 *
 *   continuous cheap perception -> eating detected -> HQ capture -> backend
 *
 * This is the only place in the module that talks to the backend, and it
 * only does so once per confirmed EATING_EVENT — never per-frame. Swap
 * `foodAnalysisClient` between HttpFoodAnalysisClient and
 * MockFoodAnalysisClient (same @input slot, both implement
 * IFoodAnalysisClient) to demo without a live backend.
 */
@component
export class EatingTrigger extends BaseScriptComponent {
  @input
  cameraSampler: CameraSampler;

  @input('Component.ScriptComponent')
  foodAnalysisClientComponent: ScriptComponent; // must implement IFoodAnalysisClient

  private get foodAnalysisClient(): IFoodAnalysisClient {
    return this.foodAnalysisClientComponent as unknown as IFoodAnalysisClient;
  }

  private busy = false;

  onAwake(): void {
    PerceptionEvents.onEatingEvent.add((evt) => this.handleEatingEvent(evt));
  }

  private async handleEatingEvent(evt: { food_object: string; confidence: number; timestampMillis: number }) {
    if (this.busy) return; // one in-flight analysis at a time is enough for the MVP
    this.busy = true;
    try {
      const hqTexture = await this.cameraSampler.captureHighQuality();
      PerceptionEvents.onHighQualityFrameCaptured.invoke({ texture: hqTexture, timestampMillis: evt.timestampMillis });

      const result = await this.foodAnalysisClient.analyze(hqTexture, evt);

      // A6 (and anything else the main app wires up) picks this up automatically.
      PerceptionEvents.onFoodAnalyzed.invoke(result);
    } catch (err) {
      print(`[EatingTrigger] Food analysis failed: ${err}`);
    } finally {
      this.busy = false;
    }
  }
}
