export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image provided" });

    const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    const API_KEY = process.env.GEMINI_API_KEY;

    const prompt = `
You are an OCR system specialized in reading electricity meter images.

Extract the following:
1. meter_reading — numeric digits on 7-segment display.
2. register_type — text near numeric display (like "kWh", "kVAh", etc.).
3. serial_number — printed or engraved alphanumeric code.

Return ONLY pure JSON like this:
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
      parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      parsed = {
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: `Could not parse response: ${text}`,
      };
    }

    res.status(200).json({ ok: true, result: parsed, raw: text });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
