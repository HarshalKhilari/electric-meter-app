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
      You are an expert OCR system specialized in reading electricity meter images.

      Given an image of an electricity meter, identify and extract the following:
      1. meter_reading — numeric value on the 7-segment display (digits and decimal point only).
      2. register_type — label/unit near the numeric display (e.g., "kWh", "kVAh", "kW", etc.).
      3. serial_number — printed/engraved alphanumeric ID of the meter (ignore barcodes).

      Important visual rule for the decimal point:
      - The decimal point is valid **only if it is horizontally aligned with the bottom segment line** of the digits in the 7-segment display.
      - Ignore any dot or mark that is above or misaligned with that bottom edge.

      Guidelines:
      - The reading must come from the 7-segment display only.
      - Ignore timestamps, reflections, or glare.
      - If unreadable, set field to null.
      - If partially readable, show what can be extracted and mention in notes, the reading with unreadable part underscored
      - For some meters, the serial number is followed by contiguous numbers like 123 or 1234 followed by a date month or year month pair like 06/05. Ignore those and extract the preceeding serial number.
      - Return confidence as "high", "medium", or "low".
      - Keep notes short.

      Respond strictly in **pure JSON** (no markdown or code fences):
      {
        "meter_reading": "<digits or null>",
        "register_type": "<string or null>",
        "serial_number": "<string or null>",
        "confidence": "<low | medium | high>",
        "notes": "<short note if any>"
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
