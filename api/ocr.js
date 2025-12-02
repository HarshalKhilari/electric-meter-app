export const config = {
  runtime: "edge",
};

import { createClient } from "@supabase/supabase-js";

export default async function handler(req) {
  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405 }
      );
    }

    const { imageBase64 } = await req.json();
    if (!imageBase64)
      return new Response(
        JSON.stringify({ error: "No image provided" }),
        { status: 400 }
      );

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    );

    const API_KEY = process.env.VITE_GEMINI_API_KEY;

    const GEMINI_URL =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

    const prompt = `
You are an OCR extraction engine for electricity meter images.

Extract the following fields from the image:

1. meter_reading — digits from the 7-segment display only (digits + decimal point allowed).
   - The decimal point is valid only if horizontally aligned with the bottom segment.
   - Preserve leading zeros.

2. register_type — unit label near the reading.
   - Allowed values: "kWh", "kVAh", "kW", "kVA".
   - kWh / kVAh → no decimal
   - kW / kVA → decimal present

3. serial_number — printed label near a barcode.
   - Valid: 7–8 digits or prefixes lt, ndp, npp, ss, tpp.
   - Ignore handwritten or small surrounding text.

If unreadable, return null.

Return JSON only:

{
  "meter_reading": "<string|null>",
  "register_type": "<string|null>",
  "serial_number": "<string|null>",
  "confidence": "<high|medium|low>",
  "notes": "<short note or empty>"
}
`;

    const response = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 200,
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: imageBase64,
                  mimeType: "image/jpeg",
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    let text = "";

    const parts = data?.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (typeof part.text === "string") {
        text = part.text.trim();
        break;
      }
    }
    
    // If Gemini responded with no text at all (rare)
    if (!text) {
      throw new Error(
        "Gemini returned no text content: " + JSON.stringify(data)
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch (e) {
      parsed = {
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: `Could not parse response: ${text}`,
      };
    }


    await supabase.from("meter_records").insert([
      {
        reading: parsed.meter_reading,
        unit: parsed.register_type,
        meter_number: parsed.serial_number,
        notes: parsed.notes,
      },
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        result: parsed,
        raw: text,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);

    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500 }
    );
  }
}
