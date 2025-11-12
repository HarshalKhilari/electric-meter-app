export default async function handler(req, res) {
  console.log("🟢 OCR endpoint called");

  try {
    if (req.method !== "POST") {
      console.log("❌ Wrong method:", req.method);
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      console.log("❌ No imageBase64 received");
      return res.status(400).json({ error: "No image data" });
    }

    console.log("✅ Received image, length:", imageBase64.length);

    const modelName = "gemini-2.5-flash";
    const apiKey = process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.log("❌ No GEMINI_API_KEY in environment");
      return res.status(500).json({ error: "Missing Gemini API key" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const body = {
      contents: [
        {
          parts: [
            { text: "Test call: please reply 'pong'" },
            {
              inline_data: {
                mimeType: "image/jpeg",
                data: imageBase64.split(",")[1],
              },
            },
          ],
        },
      ],
    };

    console.log("📡 Sending request to Gemini...");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await response.json();
    console.log("✅ Gemini response:", json);

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "No text";
    res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error("💥 OCR Handler error:", err);
    res.status(500).json({ error: err.message });
  }
}
