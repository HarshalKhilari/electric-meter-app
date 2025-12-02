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
      2. register_type — label/unit near the numeric display (includes "kWh", "kVAh", "kW", "kVA").
      3. serial_number — printed/engraved alphanumeric ID of the meter which is a 7 or 8 digit string near the barcodes.

      Important visual rule for the decimal point:
      - The decimal point is valid **only if it is horizontally aligned with the bottom segment line** of the digits in the 7-segment display.
      - Ignore any dot or mark that is above or misaligned with that bottom edge.

      Important rule for bad quality images:
      - Clahe and resize to 720p width is already applied. Apply additional preprocessing based on your judgement.
      - Some images would be blurred, or have glare or have uneven shadows, etc. You need to perform processing on the images, to amplify the signal of the reading and the register units from the other noise.
      - First locate the serial number if in the image, and the screen if in the image, apply preprocessing to improve clarity to undo the noise and environmental factors. Then get the digits. We want to binarize the image before extracting the digits. Hence, finding ways to remove the background or masking nosie factors from the image is a priority.

      Guidelines:
      - The reading must come from the 7-segment display only.
      - The reading can have extra leading 0s due to this being a 7 segment display. Show the reading as is, without applying any postprocessing on it
      - Registers kWh and kVAh are always about 6-7 digit without a decimal point.
      - Registers kW and kVA would always have a decimal point.
      - Ignore timestamps, reflections, or glare.
      - If unreadable, set field to null.
      - If partially readable, show what can be extracted and mention in notes, the reading with unreadable part underscored
      - Serial number is never handwritten. 
      - Serial is always printed text on a label, though fonts might be different and larger than the surrounding text like 'Property of..', voltage, ampere, hz, code, etc. 
      - The serial number will be above or below a barcode with a larger font than its surrounding text. If partially visible, ignore. 
      - Common serial number formats are: 8 digit, 7 digit, 4 digit, lt(6 digits), ndp(5 digits), ndp(4 digits), npp(5 digit), npp(4 digits), ss(8 digits), tpp(5 digits). 
      - Do not read smaller text which follows the 7 or 8 digit format as the serial. Look for larger text with serial number like pattern.
      - For some meters, the serial number is followed by contiguous numbers like 123 or 1234 followed by a date month or year month pair like 06/05. Ignore those and extract the preceeding serial number.
      - Localize the serial number depending on maximum 8 digit width. If you find the 8 digit followed by 123 or 1234, it definitely is the extra part. Ignore the reading if partial serial number is not visible
      - Return confidence as "high", "medium", or "low".
      - Keep notes short.
      - 

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
