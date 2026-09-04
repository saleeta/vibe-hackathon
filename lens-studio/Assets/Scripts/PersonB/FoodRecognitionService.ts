/**
 * B1 — Food recognition.
 *
 * Pluggable by design: the actual classifier is a network call to whatever
 * vision backend the team lands on (hosted model, Claude/GPT vision, or a
 * custom endpoint). The interface only needs a base64 still frame in and
 * ranked, confidence-scored food regions out, so the backend can change
 * without touching B2-B6.
 *
 * A backend returns one region per distinct food it localizes in the frame —
 * one region for a single food in the hand, several for a plate (rice,
 * chicken, broccoli, sauce...). That's what lets B2 estimate each food's
 * portion independently and B4 log a whole plate as one atomic group.
 */

import { BoundingBox, FoodCandidate, FoodRegionDetection, RecognizedFoodItem } from "./Types";

export interface FoodClassifierBackend {
  /** Send a still frame (plus an optional crop/attention hint), get back one or more detected food regions. */
  classify(imageBase64: string, roiHint?: BoundingBox): Promise<FoodRegionDetection[]>;
}

/**
 * HTTP-backed classifier. `postJson` is injected so this class has no
 * dependency on Lens Studio's InternetModule or on Node's fetch — the caller
 * (PersonBController in Lens, or a test/demo harness in Node) supplies
 * whichever transport it has.
 */
export class HttpFoodClassifierBackend implements FoodClassifierBackend {
  constructor(
    private readonly endpointUrl: string,
    private readonly postJson: (url: string, body: unknown) => Promise<unknown>
  ) {}

  async classify(imageBase64: string, roiHint?: BoundingBox): Promise<FoodRegionDetection[]> {
    const response = (await this.postJson(this.endpointUrl, {
      image_base64: imageBase64,
      roi_hint: roiHint ?? null,
    })) as { regions?: FoodRegionDetection[] };

    if (!response || !Array.isArray(response.regions)) {
      throw new Error("Food classifier backend returned an unexpected shape");
    }
    return response.regions;
  }
}

/**
 * Deterministic offline backend for local dev / demos / unit tests, so the
 * rest of the B1-B6 pipeline can be exercised without a live vision API.
 * `script[i]` is what's "seen" on the i-th call to classify() — pass a
 * single-region array for a food-in-hand frame, or a multi-region array to
 * simulate a plate.
 */
export class MockFoodClassifierBackend implements FoodClassifierBackend {
  constructor(private readonly script: FoodRegionDetection[][]) {}
  private callIndex = 0;

  async classify(_imageBase64: string, _roiHint?: BoundingBox): Promise<FoodRegionDetection[]> {
    const result = this.script[Math.min(this.callIndex, this.script.length - 1)];
    this.callIndex++;
    return result;
  }
}

const MIN_CONFIDENCE_TO_KEEP = 0.15;

export class FoodRecognitionService {
  constructor(private readonly backend: FoodClassifierBackend) {}

  /** Resolves every detected region to its top candidate, dropping low-confidence noise. */
  async recognize(imageBase64: string, roiHint?: BoundingBox): Promise<RecognizedFoodItem[]> {
    const regions = await this.backend.classify(imageBase64, roiHint);

    const items: RecognizedFoodItem[] = [];
    for (const region of regions) {
      const top = topCandidate(region.candidates);
      if (top && top.confidence >= MIN_CONFIDENCE_TO_KEEP) {
        items.push({ boundingBox: region.boundingBox, food: top.name, confidence: top.confidence });
      }
    }
    return items;
  }
}

function topCandidate(candidates: FoodCandidate[]): FoodCandidate | undefined {
  return [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
}
