/**
 * Meal aggregation, and duplicate detection.
 *
 * The perception side calls addObservation() once per detected food item per
 * frame — either one at a time (sequential bites) or several at once via
 * addPlateObservation() when a single frame shows multiple foods together
 * (e.g. a plate of rice + chicken + broccoli + sauce). Both paths go through
 * the same dedup logic, keyed per food name:
 *
 *   - If that specific food already has an in-progress item and the gap
 *     since it was last seen is within ACTIVE_ITEM_GAP_SEC, treat this
 *     observation as another look at the SAME bite: blend the estimate in
 *     (running average), don't add a new line item, don't add new calories.
 *   - Otherwise (first time seeing this food, or the gap is long enough that
 *     the hand plausibly went away and came back with a fresh piece) commit
 *     a new SessionFoodItem for that food.
 *
 * Tracking "in progress" per food name (not just "whatever food was seen
 * most recently") matters once more than one food can be in play at once —
 * a single-slot "most recent item" tracker would let a plate's foods
 * interfere with each other's dedup (seeing chicken again right after
 * broccoli was seen would incorrectly compare against broccoli's state and
 * log chicken twice). Per-food tracking makes single-food-per-frame and
 * whole-plate-per-frame observations behave identically.
 *
 * The eating session itself stays open across many such items and only
 * closes after SESSION_INACTIVITY_TIMEOUT_SEC of no observations at all,
 * producing exactly one meal — one set of logged calories — no matter
 * whether the foods arrived as one plate snapshot or as separate bites.
 */

import { EatingSession, SessionFoodItem } from "./Types";

const DEFAULT_ACTIVE_ITEM_GAP_SEC = 6;
const DEFAULT_SESSION_INACTIVITY_TIMEOUT_SEC = 180;

export interface ObservationInput {
  timestampSec: number;
  food: string;
  weightG: number;
  weightUncertaintyG: number;
  foodConfidence: number;
  portionConfidence: number;
}

export class EatingSessionManager {
  private activeSession: EatingSession | null = null;
  /** Index into activeSession.items of the in-progress item for each food name. */
  private activeItemIndexByFood: Map<string, number> = new Map();

  constructor(
    private readonly onSessionClosed?: (session: EatingSession) => void,
    private readonly sessionInactivityTimeoutSec: number = DEFAULT_SESSION_INACTIVITY_TIMEOUT_SEC,
    private readonly activeItemGapSec: number = DEFAULT_ACTIVE_ITEM_GAP_SEC,
    private readonly idFactory: () => string = () => `session-${Math.floor(Date.now())}-${Math.random().toString(36).slice(2, 7)}`
  ) {}

  /** One food observation (one bite, or one region of a multi-food frame). */
  addObservation(input: ObservationInput): EatingSession {
    this.checkTimeout(input.timestampSec);

    if (!this.activeSession) {
      this.activeSession = {
        id: this.idFactory(),
        startedSec: input.timestampSec,
        lastUpdateSec: input.timestampSec,
        status: "open",
        items: [],
      };
      this.activeItemIndexByFood.clear();
    }

    const session = this.activeSession;
    session.lastUpdateSec = input.timestampSec;

    const foodKey = input.food.toLowerCase();
    const existingIndex = this.activeItemIndexByFood.get(foodKey);
    const currentItem = existingIndex !== undefined ? session.items[existingIndex] : undefined;
    const isSameBite = !!currentItem && input.timestampSec - currentItem.lastSeenSec <= this.activeItemGapSec;

    if (isSameBite && currentItem) {
      currentItem.weightG = runningAverage(currentItem.weightG, input.weightG, currentItem.observationCount);
      currentItem.weightUncertaintyG = Math.max(currentItem.weightUncertaintyG, input.weightUncertaintyG);
      currentItem.foodConfidence = Math.max(currentItem.foodConfidence, input.foodConfidence);
      currentItem.portionConfidence = runningAverage(
        currentItem.portionConfidence,
        input.portionConfidence,
        currentItem.observationCount
      );
      currentItem.lastSeenSec = input.timestampSec;
      currentItem.observationCount += 1;
    } else {
      const newItem: SessionFoodItem = {
        food: input.food,
        weightG: input.weightG,
        weightUncertaintyG: input.weightUncertaintyG,
        foodConfidence: input.foodConfidence,
        portionConfidence: input.portionConfidence,
        firstSeenSec: input.timestampSec,
        lastSeenSec: input.timestampSec,
        observationCount: 1,
      };
      session.items.push(newItem);
      this.activeItemIndexByFood.set(foodKey, session.items.length - 1);
    }

    return session;
  }

  /**
   * A single frame that shows several foods at once (a plate) — e.g. food
   * recognition returning rice + chicken + broccoli + sauce from one image. Processes
   * them as one atomic group under a shared timestamp; per-food dedup means
   * this is safe to call every time the plate is still in view, not just
   * once, without inflating the count.
   */
  addPlateObservation(timestampSec: number, items: Omit<ObservationInput, "timestampSec">[]): EatingSession {
    let session: EatingSession | null = null;
    for (const item of items) {
      session = this.addObservation({ ...item, timestampSec });
    }
    if (!session) throw new Error("addPlateObservation called with an empty item list");
    return session;
  }

  /** Call periodically (e.g. from the Lens's update tick) so a session can close even with no new observations. */
  checkTimeout(nowSec: number): EatingSession | null {
    if (!this.activeSession) return null;
    if (nowSec - this.activeSession.lastUpdateSec >= this.sessionInactivityTimeoutSec) {
      return this.closeActiveSession(nowSec);
    }
    return null;
  }

  closeActiveSession(nowSec: number): EatingSession | null {
    if (!this.activeSession) return null;
    const closed = this.activeSession;
    closed.status = "closed";
    closed.closedSec = nowSec;
    this.activeSession = null;
    this.activeItemIndexByFood.clear();
    this.onSessionClosed?.(closed);
    return closed;
  }

  get current(): EatingSession | null {
    return this.activeSession;
  }

  /**
   * Collapses items by food name (e.g. two non-contiguous chicken bites) for
   * a cleaner "Chicken / Rice / Vegetables" style summary display.
   */
  static summarizeByFood(session: EatingSession): { food: string; weightG: number }[] {
    const totals = new Map<string, number>();
    for (const item of session.items) {
      totals.set(item.food, (totals.get(item.food) ?? 0) + item.weightG);
    }
    return Array.from(totals.entries()).map(([food, weightG]) => ({ food, weightG: Math.round(weightG * 10) / 10 }));
  }
}

function runningAverage(existing: number, next: number, priorCount: number): number {
  return (existing * priorCount + next) / (priorCount + 1);
}
