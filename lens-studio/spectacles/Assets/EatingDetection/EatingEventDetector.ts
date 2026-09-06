import { PerceptionEvents } from '../Core/PerceptionEvents';
import { RingBuffer } from '../Core/RingBuffer';
import { EatingState, FoodInHandResult } from '../Core/PerceptionTypes';

/**
 * Eating-event detector. Turns noisy per-frame food-in-hand signals into
 * one confident "log this" event.
 *
 *   NOT_EATING -> FOOD_DETECTED -> FOOD_IN_HAND (fires onEatingEvent)
 *
 * Trigger condition is **food confirmed in hand**, not a full hand-to-mouth
 * bite gesture — a hand-approaching-face/at-face requirement was tried
 * first but reliably detecting an actual bite motion (vs. just holding
 * food) turned out to be more fragile than it was worth for this product:
 * confirming *something* is being held is a good enough signal to log it,
 * without needing to also catch the exact moment it reaches the mouth.
 *
 * The FOOD_DETECTED -> FOOD_IN_HAND transition still requires its condition
 * to hold for `minDwellFoodInHandMs` (debounce against a single noisy
 * frame), and the whole machine resets to NOT_EATING if food-in-hand
 * evidence goes stale (tracking lost, food set down, etc.) for
 * `staleTimeoutMs`, so a real hold can't be missed because of one dropped
 * frame either.
 */
@component
export class EatingEventDetector extends BaseScriptComponent {
  @input
  @hint('How long food must be continuously confirmed in-hand before it counts as an eating event.')
  minDwellFoodInHandMs: number = 200;

  @input
  @hint('Any state times out back to NOT_EATING if its condition stops holding for this long.')
  staleTimeoutMs: number = 1500;

  @input
  @hint('Minimum time between two EATING_EVENTs, so one continuous hold is not counted as many bites.')
  cooldownMs: number = 2000;

  private state: EatingState = EatingState.NOT_EATING;
  private stateEnteredAtMs: number = 0;
  private lastConditionTrueAtMs: number = 0;
  private lastEventAtMs: number = -Infinity;

  private latestFoodInHand: FoodInHandResult = { food_in_hand: false, food_object: null, confidence: 0, hand: null };
  private history = new RingBuffer<{ t: number; state: EatingState }>(60);

  onAwake(): void {
    PerceptionEvents.onFoodInHand.add((r) => (this.latestFoodInHand = r));
    this.createEvent('UpdateEvent').bind(() => this.tick());
    this.enterState(EatingState.NOT_EATING);
  }

  private nowMs(): number {
    return getTime() * 1000;
  }

  private enterState(next: EatingState): void {
    const previous = this.state;
    this.state = next;
    this.stateEnteredAtMs = this.nowMs();
    this.lastConditionTrueAtMs = this.stateEnteredAtMs;
    this.history.push({ t: this.stateEnteredAtMs, state: next });
    if (previous !== next) {
      PerceptionEvents.onEatingStateChanged.invoke({ previous, next, timestampMillis: this.stateEnteredAtMs });
    }
  }

  private dwellMs(): number {
    return this.nowMs() - this.stateEnteredAtMs;
  }

  private tick(): void {
    const now = this.nowMs();

    switch (this.state) {
      case EatingState.NOT_EATING: {
        if (this.latestFoodInHand.food_in_hand) this.enterState(EatingState.FOOD_DETECTED);
        break;
      }

      case EatingState.FOOD_DETECTED: {
        if (!this.latestFoodInHand.food_in_hand) {
          this.resetIfStale(now);
          break;
        }
        this.lastConditionTrueAtMs = now;
        if (this.dwellMs() >= this.minDwellFoodInHandMs) this.enterState(EatingState.FOOD_IN_HAND);
        break;
      }

      case EatingState.FOOD_IN_HAND: {
        this.fireEatingEvent(now);
        this.enterState(EatingState.NOT_EATING);
        break;
      }
    }
  }

  private resetIfStale(now: number): void {
    if (now - this.lastConditionTrueAtMs >= this.staleTimeoutMs) {
      this.enterState(EatingState.NOT_EATING);
    }
  }

  private cooldownLogAtMs = -Infinity;

  private fireEatingEvent(now: number): void {
    if (now - this.lastEventAtMs < this.cooldownMs) {
      // Print at most once per cooldown window — the state machine re-reaches
      // this branch every tick while food stays in hand, which floods the log.
      if (now - this.cooldownLogAtMs > this.cooldownMs) {
        this.cooldownLogAtMs = now;
        print('[FoodLens:EatingEvent] Confirmed hold ignored — still in cooldown from the last one.');
      }
      return; // debounce: don't double-count one hold
    }
    this.lastEventAtMs = now;
    print(`[FoodLens:EatingEvent] Eating event confirmed: "${this.latestFoodInHand.food_object ?? 'unknown'}" — triggering capture + analysis.`);
    PerceptionEvents.onEatingEvent.invoke({
      food_object: this.latestFoodInHand.food_object ?? 'unknown',
      confidence: this.latestFoodInHand.confidence,
      timestampMillis: now,
    });
  }

  getCurrentState(): EatingState {
    return this.state;
  }
}
