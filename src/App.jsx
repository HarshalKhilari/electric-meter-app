import { useRef, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ✅ Supabase client
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [data, setData] = useState({
    meter_reading: "",
    register_type: "",
    serial_number: "",
    confidence: "",
    notes: ""
  });
  const [loading, setLoading] = useState(false);

  // ✅ Load OpenCV once
  useEffect(() => {
    const loadOpenCV = async () => {
      if (!window.cv) {
        await new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = "https://docs.opencv.org/4.x/opencv.js";
          script.async = true;
          script.onload = resolve;
          document.body.appendChild(script);
        });
      }
    };
    loadOpenCV();
  }, []);

  // ✅ Start rear camera automatically
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Camera access error:", err);
        alert("Unable to access camera. Please check permissions.");
      }
    };
    startCamera();
  }, []);

  // ✅ CLAHE + resize to 720p
  const preprocessImage = (imageDataUrl) => {
    if (!window.cv) return imageDataUrl;

    const img = new Image();
    img.src = imageDataUrl;

    return new Promise((resolve) => {
      img.onload = () => {
        const mat = cv.imread(img);
        let gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY, 0);

        const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
        let enhanced = new cv.Mat();
        clahe.apply(gray, enhanced);

        const newHeight = 720;
        const scale = newHeight / enhanced.rows;
        const newWidth = Math.round(enhanced.cols * scale);
        let resized = new cv.Mat();
        cv.resize(enhanced, resized, new cv.Size(newWidth, newHeight));

        const canvas = document.createElement("canvas");
        canvas.width = newWidth;
        canvas.height = newHeight;
        cv.imshow(canvas, resized);

        const processedDataUrl = canvas.toDataURL("image/jpeg", 0.9);

        mat.delete();
        gray.delete();
        enhanced.delete();
        resized.delete();
        clahe.delete();

        resolve(processedDataUrl);
      };
    });
  };

  // ✅ Capture + preprocess + send
  const captureAndProcess = async () => {
    setLoading(true);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const rawDataUrl = canvas.toDataURL("image/jpeg");

      const processed = await preprocessImage(rawDataUrl);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: processed }),
      });

      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Processing error:", e);
      alert("Processing failed.");
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    await supabase.from("meter_records").insert([data]);
    alert("Submitted successfully!");
  };

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Electric Meter Reader V2</h1>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-80 border rounded"
      />
      <canvas ref={canvasRef} width="400" height="300" className="hidden" />

      <div className="flex gap-4 mt-4">
        <button
          onClick={captureAndProcess}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white rounded"
        >
          {loading ? "Processing..." : "Capture"}
        </button>
      </div>

      {!loading && (
        <div className="mt-4 w-80">
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Meter Reading"
            value={data.meter_reading}
            onChange={(e) =>
              setData({ ...data, meter_reading: e.target.value })
            }
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Register Type"
            value={data.register_type}
            onChange={(e) =>
              setData({ ...data, register_type: e.target.value })
            }
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Serial Number"
            value={data.serial_number}
            onChange={(e) =>
              setData({ ...data, serial_number: e.target.value })
            }
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Confidence"
            value={data.confidence}
            readOnly
          />
          <textarea
            className="w-full border p-2 mb-2"
            placeholder="Notes"
            value={data.notes}
            readOnly
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
