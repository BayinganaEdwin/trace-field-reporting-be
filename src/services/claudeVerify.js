/**
 * claudeVerify.js — Claude vision-based construction image classifier
 *
 * Uses claude-haiku-5-5 with vision to determine:
 *   1. Is this actually a construction site photo?
 *   2. If yes, which stage does it show?
 *   3. How confident is the classification?
 *
 * Non-construction images (flowers, food, selfies, etc.) correctly return
 * 0% confidence rather than a random score.
 *
 * Requires: ANTHROPIC_API_KEY in environment (via .env file)
 */

const fetch = require('node-fetch');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const CLASS_NAMES = [
  'formwork_erected',
  'reinforcement_placed',
  'concrete_poured',
  'structure_complete',
];

const STAGE_DESCRIPTIONS = {
  formwork_erected:     'wooden or metal formwork/shuttering assembled to shape concrete structures',
  reinforcement_placed: 'steel rebar / reinforcement bars laid inside formwork prior to concrete pour',
  concrete_poured:      'wet or freshly cast concrete being placed into formwork',
  structure_complete:   'finished concrete structure with formwork removed, showing cured surfaces or brickwork',
};

/**
 * Verify an image against a reported construction stage using Claude vision.
 *
 * @param {Buffer}  imageBuffer   - Raw image bytes
 * @param {string}  mimetype      - e.g. 'image/jpeg'
 * @param {string}  reportedStage - The stage the worker reported (e.g. 'concrete_poured')
 * @returns {object|null} Result object or null if Claude is unavailable
 */
async function verifyWithClaude(imageBuffer, mimetype, reportedStage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('[ClaudeVerify] ANTHROPIC_API_KEY not set — skipping Claude verification');
    return null;
  }

  // Normalise mimetype for Anthropic's accepted formats
  let mediaType = 'image/jpeg';
  if (mimetype.includes('png'))  mediaType = 'image/png';
  if (mimetype.includes('webp')) mediaType = 'image/webp';
  if (mimetype.includes('gif'))  mediaType = 'image/gif';

  const base64Image = imageBuffer.toString('base64');

  const stageList = CLASS_NAMES
    .map(s => `- ${s}: ${STAGE_DESCRIPTIONS[s]}`)
    .join('\n');

  const systemPrompt = `You are a precise AI construction site inspector. Your job is to analyze photos submitted by construction workers and verify they match the reported construction stage. Be strict and accurate — a flower photo, food, selfie, or anything unrelated to construction should get confidence 0.`;

  const userPrompt = `Analyze this image. The worker reported the construction stage as: "${reportedStage}"

Valid construction stages are:
${stageList}

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{
  "isConstructionSite": <true or false>,
  "detectedStage": <"stage_name" or null if not a construction site>,
  "confidenceScore": <0.0 to 1.0, how confident you are in detectedStage>,
  "allScores": {
    "formwork_erected": <0.0-1.0>,
    "reinforcement_placed": <0.0-1.0>,
    "concrete_poured": <0.0-1.0>,
    "structure_complete": <0.0-1.0>
  },
  "observations": "<one concise sentence describing exactly what you see>"
}

Rules:
- If the image is NOT a construction site (e.g. flowers, food, people, nature, interiors, text), set isConstructionSite=false, detectedStage=null, confidenceScore=0.0, all allScores to 0.0
- If it IS a construction site, allScores values should reflect how much evidence of each stage is visible; they should sum to roughly 1.0
- Be strict: partial or ambiguous construction evidence → lower confidence`;

  const t0 = Date.now();
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            { type: 'text', text: userPrompt },
          ],
        }],
      }),
      timeout: 25000,
    });

    const inferenceMs = Date.now() - t0;

    if (!response.ok) {
      const errBody = await response.text();
      console.warn(`[ClaudeVerify] API error ${response.status}:`, errBody.slice(0, 200));
      return null;
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text?.trim() ?? '';

    // Extract JSON — handle cases where Claude wraps it in ```json ... ```
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[ClaudeVerify] Could not parse JSON from response:', rawText.slice(0, 200));
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);

    // Normalise scores to ensure they're numbers
    const allScores = {};
    for (const cls of CLASS_NAMES) {
      allScores[cls] = Number(result.allScores?.[cls] ?? 0);
    }

    if (!result.isConstructionSite) {
      return {
        detectedStage:    null,
        confidenceScore:  0,
        allScores,
        modelVersion:     'claude-haiku-vision',
        inferenceMs,
        isConstructionSite: false,
        observations:     result.observations ?? 'Image does not show a construction site.',
      };
    }

    const confidence = Math.min(1, Math.max(0, Number(result.confidenceScore ?? 0)));

    return {
      detectedStage:    result.detectedStage ?? null,
      confidenceScore:  confidence,
      allScores,
      modelVersion:     'claude-haiku-vision',
      inferenceMs,
      isConstructionSite: true,
      observations:     result.observations ?? `AI detected ${result.detectedStage} with ${Math.round(confidence * 100)}% confidence.`,
    };

  } catch (err) {
    console.warn('[ClaudeVerify] Request failed:', err.message);
    return null;
  }
}

module.exports = { verifyWithClaude, CLASS_NAMES };
