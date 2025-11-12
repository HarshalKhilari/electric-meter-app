// api/ocr.js

export default async function handler(req, res) {
  try {
    const { imageBase64 } = req.body;

    const prompt = `
You are an expert OCR system specialized in reading electricity meter images.

Given an image of an electricity meter, identify and extract the following:
1. meter_reading — numeric value on the 7-segment display (digits and decimal point only).
2. register_type — label/unit near the numeric display (e.g., "kWh", "kVAh", "kW", etc.).
3. serial_number — printed/engraved alphanumeric ID of the meter (ignore barcodes).

Important visual rule for the decimal point:
- The decimal point is valid only if it is horizontally aligned with the bottom segment line of the digits.
- Ignore any dot that is misaligned or above.

Guidelines:
- The reading must come from the 7-segment display only.
- Ignore timestamps, reflections, glare.
- If unreadable, set field to null.
- If partially readable, include readable part and note what’s missing.
- If serial number includes trailing date-like pairs (e.g., 06/05), ignore those.
- Return confidence as "high", "medium", or "low".
- Respond strictly in JSON format:
{
  "meter_reading": "<digits or null>",
  "register_type": "<string or null>",
  "serial_number": "<string or null>",
  "confidence": "<low | medium | high>",
  "notes": "<short note>"
}
`;

    // Use correct model name
    const modelName = "gemini-2.5-flash";

    // Use correct endpoint format with API key query param
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mimeType: "image/jpeg",
                data: imageBase64.split(",")[1]
              }
            }
          ]
        }
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
        // No separate Authorization header needed if you pass ?key=
      },
      body: JSON.stringify(body)
    });

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    const cleaned = text.replace(/```(?:json)?|```/g, "").trim();
    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      result = {
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: `Could not parse response: ${text}`
      };
    }

    res.status(200).json(result);
  } catch (err) {
    console.error("OCR Handler error:", err);
    res.status(500).json({ error: "Gemini OCR failed", details: err.message });
  }
}
