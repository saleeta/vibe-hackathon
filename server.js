// Minimal backend for the Spectacles voice agent's open-ended question
// fallback (spectacles-voice-memory's VoiceListener/VoiceResponder).
//
// Holds NO provider API key of its own — LLM_BASE_URL/LLM_API_KEY are
// injected at deploy time by the platform's shared LLM gateway (app.yaml's
// `ai: true`), which auto-picks a free provider (Groq/Google AI Studio/
// OpenRouter) and fails over between them. This is what keeps a real
// provider key out of the Lens's shipped client-side bundle entirely —
// the glasses call this server, this server calls the gateway.
'use strict';

const express = require('express');
const app = express();
app.use(express.json({ limit: '32kb' })); // voice transcripts are short; no need for a large body limit

const PORT = process.env.PORT || 3000;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_API_KEY = process.env.LLM_API_KEY;

// Fail loudly at startup rather than silently answering with a broken
// integration — per the platform's hard rules.
if (!LLM_BASE_URL || !LLM_API_KEY) {
  console.error(JSON.stringify({ level: 'error', msg: 'LLM_BASE_URL/LLM_API_KEY not set — was ai: true set in app.yaml?' }));
  process.exit(1);
}

const SYSTEM_PROMPT =
  'You are a brief, spoken voice assistant on a pair of AR glasses. ' +
  'Answer in one or two short sentences, plain language, no markdown, ' +
  'no lists, nothing that only makes sense written down — your answer ' +
  'will be spoken aloud by a text-to-speech voice.';

app.get('/health', (_req, res) => {
  // Must not touch any dependency — this endpoint has none anyway (no database).
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', (_req, res) => {
  // No database/queue to check readiness against — ready as soon as the process is up.
  res.status(200).json({ status: 'ready' });
});

app.get('/version', (_req, res) => {
  res.status(200).json({
    sha: process.env.GIT_SHA || 'unknown',
    built: process.env.BUILD_TIME || null,
  });
});

app.get('/openapi.json', (_req, res) => {
  res.status(200).json({
    openapi: '3.0.0',
    info: { title: 'voice-agent-backend', version: '1.0.0' },
    paths: {
      '/chat': {
        post: {
          summary: 'Answer a free-form spoken question in one or two short sentences.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: { message: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Spoken-style answer',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { reply: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

app.post('/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ error: 'message (string) is required' });
  }

  try {
    const upstream = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        // The gateway substitutes its own model regardless of what's sent here.
        model: 'auto',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        max_tokens: 120,
        temperature: 0.4,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(JSON.stringify({ level: 'error', msg: 'LLM gateway error', status: upstream.status, detail: detail.slice(0, 500) }));
      return res.status(502).json({ error: 'upstream LLM gateway error' });
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({ error: 'empty response from LLM gateway' });
    }
    return res.status(200).json({ reply });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'chat handler failure', error: String(err) }));
    return res.status(502).json({ error: 'failed to reach LLM gateway' });
  }
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ level: 'info', msg: `voice-agent-backend listening on ${PORT}` }));
});
