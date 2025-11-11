import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [data, setData] = useState({ reading: "", unit: "", meter_number: "" });
  const [loading, setLoading] = useState(false);
  const [facingMode, setFacingMode] = useState("environment"); // ✅ default to back camera

  // ✅ Start camera with facingMode
  // This version stops any existing video streams before starting a new one
  // to prevent "Unable to access camera" errors when flipping between cameras.
  const startCamera = async () => {
    try {
      // 🛑 Stop any active camera streams first
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }

      // 🎥 Start new camera with current facing mode (default: back camera)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });

      // 📺 Attach the new stream to the video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Unable to access camera. Please check permissions.");
    }
  };


  // ✅ Restart camera whenever facingMode changes
  useEffect(() => {
    startCamera();
  }, [facingMode]);

  const captureImage = async () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/png");
    await processImage(image);
  };

  const processImage = async (image) => {
    setLoading(true);
    const prompt = `
      Extract the following from this image of an electric meter:
      1. Meter reading (numbers only)
      2. Units or Register (e.g., kWh)
      3. Meter number
      Respond as JSON with keys: reading, unit, meter_number
    `;

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" +
        import.meta.env.VITE_GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/png", data: image.split(",")[1] } },
              ],
            },
          ],
        }),
      }
    );

    const json = await res.json();
    let text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    try {
      const parsed = JSON.parse(text);
      setData(parsed);
    } catch {
      setData({ reading: "", unit: "", meter_number: "" });
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    await supabase.from("meter_records").insert([data]);
    alert("Submitted successfully!");
  };

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Electric Meter Reader</h1>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-80 border rounded"
      />
      <canvas ref={canvasRef} width="400" height="300" className="hidden" />

      <div className="flex gap-4 mt-4">
        <button
          onClick={startCamera}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Start Camera
        </button>
        <button
          onClick={captureImage}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Capture
        </button>
        <button
          onClick={() =>
            setFacingMode((prev) =>
              prev === "user" ? "environment" : "user"
            )
          }
          className="px-4 py-2 bg-gray-600 text-white rounded"
        >
          Flip Camera
        </button>
      </div>

      {loading && <p className="mt-4 text-yellow-500">Processing...</p>}

      {!loading && (
        <div className="mt-4 w-80">
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Meter Reading"
            value={data.reading}
            onChange={(e) =>
              setData({ ...data, reading: e.target.value })
            }
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Unit / Register"
            value={data.unit}
            onChange={(e) =>
              setData({ ...data, unit: e.target.value })
            }
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Meter Number"
            value={data.meter_number}
            onChange={(e) =>
              setData({ ...data, meter_number: e.target.value })
            }
          />
          <button
            onClick={handleSubmit}
            className="w-full bg-blue-600 text-white p-2 rounded"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
