import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64)
      return res.status(400).json({ error: "No image provided" });

    const GEMINI_URL =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    const API_KEY = process.env.VITE_GEMINI_API_KEY;

    const prompt = `
      You are an OCR extraction engine for electricity meter images.

      Extract the following fields from the image:

      1. meter_reading  
        - Digits from the 7-segment display only (digits + decimal point allowed).
        - The decimal point is valid only if horizontally aligned with the bottom segment of the digits.
        - Preserve leading zeros if present.

      2. register_type  
        - The visible unit label located near the meter reading.
        - Allowed values: "kWh", "kVAh", "kW", "kVA".
        - kWh / kVAh readings have no decimal point.
        - kW / kVA readings include a decimal point.

      3. serial_number  
        - Printed label text near a barcode, typically larger font.
        - Valid formats: 7 or 8 digits, or these prefixes:
          - lt(6 digits), ndp(4–5 digits), npp(4–5 digits), ss(8 digits), tpp(5 digits).
        - Do not extract handwritten or small-font surrounding text.
        - Ignore trailing sequences or dates attached to serials.

      If any field cannot be confidently read, return null.

      Return JSON only:

      {
        "meter_reading": "<string|null>",
        "register_type": "<string|null>",
        "serial_number": "<string|null>",
        "confidence": "<high|medium|low>",
        "notes": "<short note or empty string>"
      }

      `;

    const response = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { data: imageBase64, mimeType: "image/jpeg" } },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      parsed = {
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: `Could not parse response: ${text}`,
      };
    }

    // Insert into Supabase table
    const { error: dbError } = await supabase.from("meter_records").insert([
      {
        reading: parsed.meter_reading,
        unit: parsed.register_type,
        meter_number: parsed.serial_number,
        notes: parsed.notes,
      },
    ]);

    if (dbError) console.error("Supabase insert error:", dbError);

    return res.status(200).json({
      ok: true,
      result: parsed,
      raw: text,
      db_status: dbError ? "DB insert failed" : "Inserted OK",
    });
  } catch (err) {
    console.error("OCR handler error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
