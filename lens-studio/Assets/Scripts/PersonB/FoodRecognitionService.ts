/**
 * B1 — Food recognition.
 *
 * Pluggable by design: the actual classifier is a network call to whatever
 * vision backend the team lands on (hosted model, Claude/GPT vision, or a
 * custom endpoint). The interface only needs a base64 still frame in and a
 * ranked, confidence-scored food list out, so the backend can change without
 * touching B2-B6.
 */

import { FoodCandidate, FoodRecognitionResult } from "./Types";

export interface FoodClassifierBackend {
  /** Send a still frame, get back ranked food candidates (can be >1 food, e.g. a plate). */
  classify(imageBase64: string): Promise<FoodCandidate[]>;
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

  async classify(imageBase64: string): Promise<FoodCandidate[]> {
    const response = (await this.postJson(this.endpointUrl, {
      image_base64: imageBase64,
    })) as { food?: FoodCandidate[] };

    if (!response || !Array.isArray(response.food)) {
      throw new Error("Food classifier backend returned an unexpected shape");
    }
    return response.food;
  }
}

/**
 * Deterministic offline backend for local dev / demos / unit tests, so the
 * rest of the B1-B6 pipeline can be exercised without a live vision API.
 */
export class MockFoodClassifierBackend implements FoodClassifierBackend {
  constructor(private readonly script: FoodCandidate[][]) {}
  private callIndex = 0;

  async classify(_imageBase64: string): Promise<FoodCandidate[]> {
    const result = this.script[Math.min(this.callIndex, this.script.length - 1)];
    this.callIndex++;
    return result;
  }
}

const MIN_CONFIDENCE_TO_KEEP = 0.15;

export class FoodRecognitionService {
  constructor(private readonly backend: FoodClassifierBackend) {}

  async recognize(imageBase64: string): Promise<FoodRecognitionResult> {
    const candidates = await this.backend.classify(imageBase64);

    const food = candidates
      .filter((c) => c.confidence >= MIN_CONFIDENCE_TO_KEEP)
      .sort((a, b) => b.confidence - a.confidence);

    return { food };
  }

  /** Convenience accessor for callers that only care about the top guess. */
  static topCandidate(result: FoodRecognitionResult): FoodCandidate | undefined {
    return result.food[0];
  }
}
