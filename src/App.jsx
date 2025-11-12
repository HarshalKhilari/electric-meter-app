// src/App.jsx
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

  // ✅ Start only the default back camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Unable to access camera. Please check permissions.");
    }
  };

  // ✅ Start camera when component mounts
  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const captureImage = async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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

    try {
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
                  {
                    inline_data: {
                      mime_type: "image/png",
                      data: image.split(",")[1],
                    },
                  },
                ],
              },
            ],
          }),
        }
      );

      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(text);
      setData(parsed);
    } catch (err) {
      console.error("Error processing image:", err);
      setData({ reading: "", unit: "", meter_number: "" });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    await supabase.from("meter_records").insert([data]);
    alert("Submitted successfully!");
  };

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Electric Meter Reader</h1>

      {/* ✅ Video preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-80 border rounded bg-black"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* ✅ Capture button (bottom-center style) */}
      <div className="mt-4 flex justify-center">
        <button
          onClick={captureImage}
          className="w-16 h-16 rounded-full bg-white border-4 border-gray-300 shadow-lg"
          title="Capture"
        />
      </div>

      {loading && <p className="mt-4 text-yellow-500">Processing...</p>}

      {!loading && (
        <div className="mt-4 w-80">
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Meter Reading"
            value={data.reading}
            onChange={(e) => setData({ ...data, reading: e.target.value })}
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Unit / Register"
            value={data.unit}
            onChange={(e) => setData({ ...data, unit: e.target.value })}
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
