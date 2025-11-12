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
You are a vision-based OCR system specialized in reading electricity meter images.

Return ONLY pure JSON in this format:
{
  "meter_reading": "<digits or null>",
  "register_type": "<string or null>",
  "serial_number": "<string or null>",
  "confidence": "<low|medium|high>",
  "notes": "<short note>"
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
