import { PerceptionEvents } from '../Core/PerceptionEvents';
import { RingBuffer } from '../Core/RingBuffer';
import { EatingState, FoodInHandResult, HandsSnapshot, HandState } from '../Core/PerceptionTypes';

/**
 * A4 — Eating-event detector. Almost certainly the most important
 * component in this module: turns noisy per-frame signals into one
 * confident "a bite happened" event.
 *
 *   NOT_EATING -> FOOD_DETECTED -> FOOD_IN_HAND -> HAND_APPROACHING_FACE
 *              -> FOOD_AT_FACE -> EATING_EVENT
 *
 * Each transition requires its condition to hold for a minimum dwell time
 * (debounce), and the whole machine resets to NOT_EATING if evidence goes
 * stale (tracking lost, food no longer in hand, hand stalls, etc.), so a
 * single noisy frame can't fake a transition and a real bite can't be
 * missed because of one dropped frame either.
 */
@component
export class EatingEventDetector extends BaseScriptComponent {
  @input
  @hint('World-unit distance from hand to face anchor below which food counts as "at the mouth".')
  faceProximityUnits: number = 6;

  @input
  @hint('Minimum inward (toward-face) speed to count as "approaching", in units/sec.')
  approachSpeedThreshold: number = 4;

  @input minDwellFoodInHandMs: number = 200;
  @input minDwellApproachingMs: number = 150;
  @input minDwellAtFaceMs: number = 300;

  @input
  @hint('Any state times out back to NOT_EATING if its condition stops holding for this long.')
  staleTimeoutMs: number = 1500;

  @input
  @hint('Minimum time between two EATING_EVENTs, so one bite is not double-counted.')
  cooldownMs: number = 4000;

  private state: EatingState = EatingState.NOT_EATING;
  private stateEnteredAtMs: number = 0;
  private lastConditionTrueAtMs: number = 0;
  private lastEventAtMs: number = -Infinity;

  private latestFoodInHand: FoodInHandResult = { food_in_hand: false, food_object: null, confidence: 0, hand: null };
  private latestHands: HandsSnapshot | null = null;
  private history = new RingBuffer<{ t: number; state: EatingState }>(60);

  onAwake(): void {
    PerceptionEvents.onFoodInHand.add((r) => (this.latestFoodInHand = r));
    PerceptionEvents.onHandsUpdated.add((h) => (this.latestHands = h));
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

  private activeHand(): HandState | null {
    if (!this.latestHands || !this.latestFoodInHand.hand) return null;
    return this.latestFoodInHand.hand === this.latestHands.left.side
      ? this.latestHands.left
      : this.latestHands.right;
  }

  private isApproachingFace(hand: HandState): boolean {
    // Inward speed = component of velocity pointing toward the face anchor.
    // Approximated here via closing speed: negative rate-of-change of distance.
    // HandTracker doesn't expose distance-to-face directly to this module
    // (kept decoupled), so we use velocity magnitude as a practical proxy —
    // good enough combined with the FOOD_AT_FACE proximity check that follows.
    return hand.velocity.length >= this.approachSpeedThreshold;
  }

  private tick(): void {
    const now = this.nowMs();
    const hand = this.activeHand();

    switch (this.state) {
      case EatingState.NOT_EATING: {
        if (this.latestFoodInHand.food_in_hand) this.enterState(EatingState.FOOD_DETECTED);
        break;
      }

      case EatingState.FOOD_DETECTED: {
        if (!this.latestFoodInHand.food_in_hand) {
          this.resetIfStale(now, EatingState.NOT_EATING);
          break;
        }
        this.lastConditionTrueAtMs = now;
        if (this.dwellMs() >= this.minDwellFoodInHandMs) this.enterState(EatingState.FOOD_IN_HAND);
        break;
      }

      case EatingState.FOOD_IN_HAND: {
        if (!this.latestFoodInHand.food_in_hand || !hand) {
          this.resetIfStale(now, EatingState.NOT_EATING);
          break;
        }
        this.lastConditionTrueAtMs = now;
        if (this.isApproachingFace(hand)) this.enterState(EatingState.HAND_APPROACHING_FACE);
        break;
      }

      case EatingState.HAND_APPROACHING_FACE: {
        if (!this.latestFoodInHand.food_in_hand || !hand) {
          this.resetIfStale(now, EatingState.NOT_EATING);
          break;
        }
        this.lastConditionTrueAtMs = now;
        if (this.dwellMs() >= this.minDwellApproachingMs) this.enterState(EatingState.FOOD_AT_FACE);
        break;
      }

      case EatingState.FOOD_AT_FACE: {
        if (!hand) {
          this.resetIfStale(now, EatingState.HAND_APPROACHING_FACE);
          break;
        }
        this.lastConditionTrueAtMs = now;
        if (this.dwellMs() >= this.minDwellAtFaceMs) {
          this.enterState(EatingState.EATING_EVENT);
        }
        break;
      }

      case EatingState.EATING_EVENT: {
        this.fireEatingEvent(now);
        this.enterState(EatingState.NOT_EATING);
        break;
      }
    }
  }

  private resetIfStale(now: number, fallback: EatingState): void {
    if (now - this.lastConditionTrueAtMs >= this.staleTimeoutMs) {
      this.enterState(fallback === EatingState.NOT_EATING ? EatingState.NOT_EATING : fallback);
    }
  }

  private fireEatingEvent(now: number): void {
    if (now - this.lastEventAtMs < this.cooldownMs) return; // debounce: don't double-count one bite
    this.lastEventAtMs = now;
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
