const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";
const ALLOWED_ORIGIN = "https://font-editor.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function getModelText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result === "string") return result.result;
  throw new Error("The AI model returned an empty response.");
}

function parseJSON(text) {
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      throw new Error("The AI did not return valid JSON. Try again.");
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function validateGlyphs(data, allowedCharacters = null) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid glyph data.");
  }

  const result = {};

  for (const [character, glyph] of Object.entries(data).slice(0, 40)) {
    if (
      typeof character !== "string" ||
      [...character].length !== 1 ||
      !glyph ||
      typeof glyph !== "object"
    ) {
      continue;
    }

    if (allowedCharacters && !allowedCharacters.includes(character)) {
      continue;
    }

    const strokes = Array.isArray(glyph.strokes)
      ? glyph.strokes.slice(0, 8)
      : [];

    const cleanStrokes = strokes.map(stroke => ({
      width: Math.max(2, Math.min(35, Number(stroke.width) || 12)),
      color: "#f2f4ff",
      points: (Array.isArray(stroke.points) ? stroke.points : [])
        .slice(0, 30)
        .map(point => ({
          x: Math.max(0, Math.min(700, Number(point.x) || 0)),
          y: Math.max(0, Math.min(700, Number(point.y) || 0))
        }))
    })).filter(stroke => stroke.points.length > 0);

    if (cleanStrokes.length) {
      result[character] = {
        advance: Math.max(
          250,
          Math.min(1000, Number(glyph.advance) || 700)
        ),
        strokes: cleanStrokes
      };
    }
  }

  return result;
}

async function askAI(env, prompt, image = null, maxTokens = 5000) {
  if (!env.AI || typeof env.AI.run !== "function") {
    throw new Error(
      'Workers AI binding is missing. Add a Workers AI binding named "AI".'
    );
  }

  const input = {
    messages: [
      {
        role: "system",
        content:
          "You are an expert typeface designer. " +
          "You create clean, consistent, readable font glyphs. " +
          "Follow the requested JSON format exactly. " +
          "Do not include explanations, markdown, or code fences."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    max_tokens: maxTokens,
    temperature: 0.25
  };

  if (image) {
    input.image = image;
  }

  const result = await env.AI.run(MODEL, input);
  return parseJSON(getModelText(result));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (request.method !== "POST") {
      return reply({ error: "Use POST for AI requests." }, 405);
    }

    const origin = request.headers.get("Origin");

    if (origin && origin !== ALLOWED_ORIGIN) {
      return reply({ error: "This website is not allowed to use this Worker." }, 403);
    }

    try {
      const contentLength = Number(
        request.headers.get("Content-Length") || 0
      );

      if (contentLength > 8 * 1024 * 1024) {
        return reply({ error: "Request is too large." }, 413);
      }

      const body = await request.json();
      const action = body.action;

      if (!action) {
        return reply({ error: "Missing AI action." }, 400);
      }

      // --------------------------------------------
      // GENERATE GLYPHS FROM EXISTING SAMPLE LETTERS
      // --------------------------------------------

      if (action === "generate") {
        const samples = Array.isArray(body.samples)
          ? body.samples.slice(0, 5)
          : [];

        const targets = Array.isArray(body.targets)
          ? [...new Set(body.targets)]
              .filter(c => typeof c === "string" && [...c].length === 1)
              .slice(0, 24)
          : [];

        if (samples.length < 1) {
          return reply({ error: "Draw at least one sample character." }, 400);
        }

        if (!targets.length) {
          return reply({ error: "No target characters were provided." }, 400);
        }

        const prompt = `
Create font glyphs for these target characters:

${JSON.stringify(targets)}

Use the supplied sample glyphs as the style reference:

${JSON.stringify(samples)}

Each glyph must use this exact structure:

{
  "glyphs": {
    "A": {
      "advance": 700,
      "strokes": [
        {
          "width": 12,
          "color": "#f2f4ff",
          "points": [
            {"x": 100, "y": 500},
            {"x": 200, "y": 300}
          ]
        }
      ]
    }
  }
}

Rules:
- Return every requested target character when possible.
- Keep the same visual style as the samples.
- Coordinates must be between 0 and 700.
- Use a coordinate system where smaller y values are higher.
- Make letters readable and recognizable.
- Use 1 to 8 strokes per character.
- Each stroke should have 2 to 30 points.
- Keep the design inside the drawing area.
- Return JSON only.
`;

        const result = await askAI(env, prompt, null, 5000);
        const glyphs = validateGlyphs(result.glyphs, targets);

        if (!Object.keys(glyphs).length) {
          throw new Error("The AI could not generate usable glyphs. Try again.");
        }

        return reply({ glyphs });
      }

      // --------------------------------------------
      // READ HANDWRITING FROM AN UPLOADED IMAGE
      // --------------------------------------------

      if (action === "scan") {
        const image = body.image;

        const targets = Array.isArray(body.targets)
          ? [...new Set(body.targets)]
              .filter(c => typeof c === "string" && [...c].length === 1)
              .slice(0, 24)
          : [];

        if (
          typeof image !== "string" ||
          !/^data:image\/(png|jpeg|webp);base64,/i.test(image)
        ) {
          return reply({
            error: "Please provide a PNG, JPG or WebP image."
          }, 400);
        }

        if (image.length > 7 * 1024 * 1024) {
          return reply({ error: "The image is too large." }, 413);
        }

        if (!targets.length) {
          return reply({ error: "No missing characters were provided." }, 400);
        }

        const prompt = `
Examine the supplied handwriting/font sheet image.

Extract these characters if they are visible:

${JSON.stringify(targets)}

Create a separate glyph for each recognizable target character.

Return this exact JSON structure:

{
  "glyphs": {
    "A": {
      "advance": 700,
      "strokes": [
        {
          "width": 12,
          "color": "#f2f4ff",
          "points": [
            {"x": 100, "y": 500},
            {"x": 200, "y": 300}
          ]
        }
      ]
    }
  }
}

Rules:
- Only return characters you can recognize in the image.
- Do not invent characters that are not visible.
- Coordinates must be between 0 and 700.
- Smaller y values mean higher positions.
- Use 1 to 8 strokes per character.
- Each stroke must have 2 to 30 points.
- Approximate the visible letter shapes as closely as possible.
- Return JSON only.
`;

        const result = await askAI(env, prompt, image, 5000);
        const glyphs = validateGlyphs(result.glyphs, targets);

        if (!Object.keys(glyphs).length) {
          throw new Error(
            "No recognizable characters were found. Try a clearer image."
          );
        }

        return reply({ glyphs });
      }

      // --------------------------------------------
      // EDIT EXISTING GLYPHS USING TEXT INSTRUCTIONS
      // --------------------------------------------

      if (action === "edit") {
        const instruction = String(body.instruction || "").trim();

        if (!instruction) {
          return reply({ error: "Enter an editing instruction." }, 400);
        }

        if (instruction.length > 500) {
          return reply({
            error: "Keep your editing instruction under 500 characters."
          }, 400);
        }

        const original = body.glyphs;

        if (!original || typeof original !== "object") {
          return reply({ error: "No glyphs were supplied." }, 400);
        }

        const characters = Object.keys(original).slice(0, 24);

        if (!characters.length) {
          return reply({ error: "No characters were supplied." }, 400);
        }

        const prompt = `
Edit the supplied font glyphs according to this instruction:

${instruction}

Current glyph data:

${JSON.stringify(original)}

Return the edited glyphs using this exact JSON structure:

{
  "glyphs": {
    "A": {
      "advance": 700,
      "strokes": [
        {
          "width": 12,
          "color": "#f2f4ff",
          "points": [
            {"x": 100, "y": 500},
            {"x": 200, "y": 300}
          ]
        }
      ]
    }
  }
}

Rules:
- Return the edited versions of the supplied characters.
- Preserve the original character identities.
- Follow the instruction while keeping letters readable.
- Keep the overall font style consistent.
- Coordinates must be between 0 and 700.
- Use 1 to 8 strokes per character.
- Each stroke must have 2 to 30 points.
- Return JSON only.
`;

        const result = await askAI(env, prompt, null, 5000);
        const glyphs = validateGlyphs(result.glyphs, characters);

        if (!Object.keys(glyphs).length) {
          throw new Error("The AI could not edit the supplied glyphs.");
        }

        return reply({ glyphs });
      }

      // --------------------------------------------
      // CHECK GLYPHS AND SUGGEST IMPROVEMENTS
      // --------------------------------------------

      if (action === "check") {
        const glyphs = body.glyphs;

        if (!glyphs || typeof glyphs !== "object") {
          return reply({ error: "No glyphs were supplied." }, 400);
        }

        const prompt = `
Review this font data:

${JSON.stringify(glyphs)}

Look for:
- Inconsistent stroke thickness.
- Characters that may be difficult to recognize.
- Uneven proportions.
- Inconsistent character widths.
- Characters that may need spacing adjustments.
- Possible style inconsistencies.

Return this exact JSON structure:

{
  "suggestions": [
    "Suggestion one.",
    "Suggestion two."
  ]
}

Give useful, specific suggestions.
Do not modify the glyphs.
Return JSON only.
`;

        const result = await askAI(env, prompt, null, 1500);

        const suggestions = Array.isArray(result.suggestions)
          ? result.suggestions
              .filter(v => typeof v === "string")
              .slice(0, 12)
          : [];

        return reply({ suggestions });
      }

      return reply({ error: "Unknown AI action: " + action }, 400);

    } catch (error) {
      console.error("Font Editor AI error:", error);

      return reply({
        error: error?.message || "An unexpected AI error occurred."
      }, 500);
    }
  }
};
