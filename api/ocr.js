export async function POST(req) {
  try {
    const { image } = await req.json();
    const apiKey = process.env.VITE_GEMINI_API_KEY;
    const model = "gemini-2.5-flash";

    const prompt = `
You are an expert OCR system specialized in reading electricity meter images.

Given an image of an electricity meter, identify and extract:
1. meter_reading — numeric value on the 7-segment display (digits and decimal point only)
2. register_type — label/unit near numeric display (e.g. "kWh")
3. serial_number — printed/engraved alphanumeric ID (ignore barcodes)
Follow rules:
- Decimal point valid only if horizontally aligned with bottom of 7-segment digits
- Ignore timestamps/reflections
- If unreadable, set to null
- Return strictly pure JSON as:
{
  "meter_reading": "<digits or null>",
  "register_type": "<string or null>",
  "serial_number": "<string or null>",
  "confidence": "<low | medium | high>",
  "notes": "<short note>"
}
`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/jpeg", data: image.split(",")[1] } },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      }
    );

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: "Could not parse response",
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("OCR error:", error);
    return new Response(
      JSON.stringify({
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: error.message,
      }),
      { status: 500 }
    );
  }
}
