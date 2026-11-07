const corsHeaders = {
  "Access-Control-Allow-Origin": "https://font-editor.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return response({ error: "Use POST." }, 405);
    }

    if (!env.OPENAI_API_KEY) {
      return response({ error: "The OPENAI_API_KEY secret is missing." }, 500);
    }

    try {
      const body = await request.json();
      const action = body.action;

      if (!["generate", "scan", "edit", "check"].includes(action)) {
        return response({ error: "Unknown AI action." }, 400);
      }

      let instructions = "";
      let input = [];

      if (action === "generate") {
        const samples = Array.isArray(body.samples) ? body.samples.slice(0, 5) : [];
        const targets = Array.isArray(body.targets) ? body.targets.slice(0, 12) : [];

        if (!samples.length || !targets.length) {
          return response({ error: "Provide sample letters and target letters." }, 400);
        }

        instructions = `
You are an expert typeface designer.
Create missing font glyphs that match the supplied sample glyphs.

The canvas coordinate system is 700 by 700.
Coordinates must be between 0 and 700.
Use strokes made from points. Each stroke has:
- points: an array of {x,y}
- width: a number between 2 and 35
- color: a CSS color string

Preserve the visual style, proportions, stroke thickness and slant of the samples.
Do not simply copy a sample letter.
Create readable, distinct glyphs.
Return one glyph for every requested target character.
Use a reasonable advance width between 300 and 700.
`;

        input = [{
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({ samples, targets })
          }]
        }];
      }

      if (action === "scan") {
        if (!body.image || typeof body.image !== "string") {
          return response({ error: "No image was supplied." }, 400);
        }

        const targets = Array.isArray(body.targets) ? body.targets.slice(0, 80) : [];

        instructions = `
You are a handwriting recognition and font glyph extraction assistant.
Inspect the supplied handwriting sheet and identify the requested characters.
The sheet may contain handwritten letters arranged in rows or boxes.
Return a separate glyph for each character you can confidently identify.

Represent each glyph as vector strokes in a 700 by 700 coordinate system.
Coordinates must be between 0 and 700.
Each stroke must contain points [{x,y}, ...], width, and color.
Use a maximum of 8 strokes per glyph and 30 points per stroke.
Keep the glyph centered and preserve the handwriting style.
If a character cannot be identified, omit it rather than inventing it.
`;

        input = [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract these characters from the handwriting sheet: " + targets.join(" ")
            },
            {
              type: "input_image",
              image_url: body.image
            }
          ]
        }];
      }

      if (action === "edit") {
        const glyphs = body.glyphs || {};
        const instruction = String(body.instruction || "").slice(0, 1000);

        if (!instruction.trim()) {
          return response({ error: "Enter an editing instruction." }, 400);
        }

        instructions = `
You are editing vector font glyphs.
Apply the user's instruction while preserving the identity and readability of each character.
Coordinates must remain between 0 and 700.
Return the complete edited glyphs, not descriptions.
`;

        input = [{
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({ instruction, glyphs })
          }]
        }];
      }

      if (action === "check") {
        const glyphs = body.glyphs || {};

        instructions = `
You are a professional typeface quality checker.
Inspect the supplied glyph data for consistency.
Look for inconsistent stroke widths, unusual advances, missing glyphs,
extreme proportions and likely readability issues.
Return a concise list of actionable suggestions.
Do not modify the glyphs.
`;

        input = [{
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify(glyphs)
          }]
        }];
      }

      const schema = action === "check"
        ? {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["suggestions"],
            additionalProperties: false
          }
        : {
            type: "object",
            properties: {
              glyphs: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    advance: { type: "number" },
                    strokes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          width: { type: "number" },
                          color: { type: "string" },
                          points: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                x: { type: "number" },
                                y: { type: "number" }
                              },
                              required: ["x", "y"],
                              additionalProperties: false
                            }
                          }
                        },
                        required: ["width", "color", "points"],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ["advance", "strokes"],
                  additionalProperties: false
                }
              }
            },
            required: ["glyphs"],
            additionalProperties: false
          };

      const apiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-5.5",
          instructions,
          input,
          text: {
            format: {
              type: "json_schema",
              name: action === "check" ? "font_check" : "font_glyphs",
              strict: true,
              schema
            }
          }
        })
      });

      const result = await apiResponse.json();

      if (!apiResponse.ok) {
        return response({
          error: result.error?.message || "The AI request failed."
        }, apiResponse.status);
      }

      const outputText = (result.output || [])
        .flatMap(item => item.content || [])
        .filter(item => item.type === "output_text")
        .map(item => item.text)
        .join("");

      if (!outputText) {
        return response({ error: "The AI returned an empty response." }, 502);
      }

      const parsed = JSON.parse(outputText);

      return response(parsed);
    } catch (error) {
      return response({
        error: error.message || "Unexpected Worker error."
      }, 500);
    }
  }
};
