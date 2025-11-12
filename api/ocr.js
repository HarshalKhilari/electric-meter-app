export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "No image provided" });

    const GEMINI_URL =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    const API_KEY = process.env.VITE_GEMINI_API_KEY;

    const prompt = `
You are a vision-based OCR system specialized in reading electricity meter images.

Extract and return a JSON object with exactly the following keys:
{
  "meter_reading": "<digits on the 7-segment display or null>",
  "register_type": "<text like kWh, kVAh, or null>",
  "serial_number": "<printed or engraved alphanumeric code or null>",
  "confidence": "<low|medium|high>",
  "notes": "<very short comment>"
}

Rules:
- Always return ONLY a valid JSON object — no explanations or markdown.
- If uncertain, set the field to null.
- Do not include any extra text before or after JSON.
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

    // Extract Gemini output text safely
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    let parsed;
    try {
      // Clean up any code fences or stray characters
      const cleanText = text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleanText);
    } catch (err) {
      parsed = {
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: `Could not parse response: ${text}`,
      };
    }

    return res.status(200).json({ ok: true, result: parsed, raw: text });
  } catch (err) {
    console.error("OCR error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
