/**
 * B4 — Meal aggregation, and B5 — duplicate detection.
 *
 * Person A calls addObservation() once per detected eating frame. The tricky
 * part is that "the glasses see the same bite for two seconds" and "the
 * person picked up a genuinely new bite" look identical at the single-frame
 * level — both are "same food label, seen again shortly after." We resolve
 * that with one rule:
 *
 *   - If the current in-progress item has the SAME food label and the gap
 *     since it was last seen is within ACTIVE_ITEM_GAP_SEC, treat this
 *     observation as another look at the SAME bite: blend the estimate in
 *     (running average), don't add a new line item, don't add new calories.
 *   - Otherwise (different food label, or the gap is long enough that the
 *     hand plausibly went away and came back with a fresh piece) commit a
 *     new SessionFoodItem.
 *
 * The eating session itself stays open across many such items and only
 * closes after SESSION_INACTIVITY_TIMEOUT_SEC of no observations at all,
 * producing exactly one meal for e.g. "chicken bite, rice bite, veg bite,
 * chicken bite again."
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
  private activeItemIndex: number | null = null;

  constructor(
    private readonly onSessionClosed?: (session: EatingSession) => void,
    private readonly sessionInactivityTimeoutSec: number = DEFAULT_SESSION_INACTIVITY_TIMEOUT_SEC,
    private readonly activeItemGapSec: number = DEFAULT_ACTIVE_ITEM_GAP_SEC,
    private readonly idFactory: () => string = () => `session-${Math.floor(Date.now())}-${Math.random().toString(36).slice(2, 7)}`
  ) {}

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
      this.activeItemIndex = null;
    }

    const session = this.activeSession;
    session.lastUpdateSec = input.timestampSec;

    const currentItem = this.activeItemIndex !== null ? session.items[this.activeItemIndex] : undefined;
    const isSameBite =
      !!currentItem &&
      currentItem.food === input.food &&
      input.timestampSec - currentItem.lastSeenSec <= this.activeItemGapSec;

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
      this.activeItemIndex = session.items.length - 1;
    }

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
    this.activeItemIndex = null;
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
