// Built-in module via require() — no @input asset wiring needed.
const nativeInternetModule: InternetModule = require('LensStudio:InternetModule');

/**
 * B3 — open-ended question fallback via Groq's direct API (called by explicit
 * user instruction, in place of a hosted proxy backend).
 *
 * SECURITY NOTE: calling a provider API directly from Lens Studio script code
 * means `groqApiKey` ends up embedded in whatever gets published from this
 * project — a Lens's client-side content is not private. This is fine for a
 * local/private demo on hardware you control; it is NOT fine for anything
 * published or shared. The safer alternative (a small backend holding the
 * key server-side, so the Lens never carries it) was deliberately not used
 * here per explicit instruction — see git history for that version if this
 * project is ever headed toward publishing.
 *
 * Model default: live-tested on real hardware — `llama-3.1-8b-instant`
 * (genuinely "smol"/fast, matching the realtime voice-agent goal) returned
 * a live 404 from Groq's API despite being listed as current in Groq's own
 * docs at the time this was written; `llama-3.3-70b-versatile` is what
 * actually worked in that same test. Groq's model catalog changes over
 * time — if this starts 404ing again, check https://console.groq.com/docs/models
 * for the current list rather than trusting this comment.
 */
@component
export class OpenEndedQAClient extends BaseScriptComponent {
  @input
  @hint('SENSITIVE. Groq API key — do not commit this project if it ends up wired here.')
  groqApiKey: string = '';

  @input
  @hint('Groq-hosted model id.')
  model: string = 'llama-3.3-70b-versatile';

  @input maxTokens: number = 120;

  private static readonly SYSTEM_PROMPT =
    'You are a brief, spoken voice assistant on a pair of AR glasses. ' +
    'Answer in one or two short sentences, plain language, no markdown, ' +
    'no lists, nothing that only makes sense written down — your answer ' +
    'will be spoken aloud by a text-to-speech voice.';

  async ask(question: string): Promise<string> {
    if (!this.groqApiKey) {
      throw new Error('OpenEndedQAClient: groqApiKey is not configured');
    }

    const response = await nativeInternetModule.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.groqApiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: OpenEndedQAClient.SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        max_tokens: this.maxTokens,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      // Include the response body — Groq's error bodies say exactly what's
      // wrong (e.g. "model_not_found"), turning a live failure into a
      // self-diagnosing one instead of a bare status code to guess from.
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // best-effort only
      }
      throw new Error(`Groq API returned ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const json = await response.json();
    const reply: string | undefined = json?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error('Groq API returned an empty reply');
    }
    return reply;
  }
}
