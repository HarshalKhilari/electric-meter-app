import React, { useRef, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [raw, setRaw] = useState("");

  // ✅ NEW: holds frozen preview image
  const [previewImage, setPreviewImage] = useState(null);

  useEffect(() => {
    startCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" } },
        audio: false,
      });

      videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera access failed: " + err.message);
    }
  };

  // --------------------------------------------------------------------------------

  // ✅ single click handler now handles both capture & restart flow
  const handleCaptureClick = () => {
    if (previewImage) {
      // Reset back to LIVE CAMERA mode
      setPreviewImage(null);
      setResult(null);
      setRaw("");
      startCamera();
    } else {
      captureImage();
    }
  };

  // --------------------------------------------------------------------------------

  const captureImage = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // ✅ Save preview image immediately
    const captureUrl = canvas.toDataURL("image/jpeg");
    setPreviewImage(captureUrl);

    // OCR uses base64 only (no prefix)
    const base64 = captureUrl.split(",")[1];

    setLoading(true);

    try {
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      const data = await res.json();
      setLoading(false);

      if (data.ok) {
        setResult(data.result);
        setRaw(data.raw);

        // ✅ Save to Supabase
        const { error } = await supabase.from("meter_records").insert([
          {
            reading: data.result?.meter_reading || null,
            unit: data.result?.register_type || null,
            meter_number: data.result?.serial_number || null,
            notes: data.result?.notes || null,
          },
        ]);

        if (error) console.error("Supabase insert error:", error);
        else console.log("✅ Record saved to Supabase");
      } else {
        setResult({ error: data.error });
        setRaw("");
      }
    } catch (err) {
      setLoading(false);
      setResult({ error: err.message });
    }
  };

  // --------------------------------------------------------------------------------

  return (
    <div className="flex flex-col items-center bg-black text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-4">⚡ Meter OCR (Gemini)</h1>

      {/* ✅ SWITCH: Live camera OR frozen preview */}
      {previewImage ? (
        <img
          src={previewImage}
          alt="Preview"
          className="w-full max-w-md rounded-lg"
        />
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full max-w-md rounded-lg"
        />
      )}

      <canvas ref={canvasRef} className="hidden"></canvas>

      {/* ✅ SINGLE BUTTON CONTROLS BOTH MODES */}
      <button
        onClick={handleCaptureClick}
        disabled={loading}
        className="mt-4 bg-yellow-500 text-black px-6 py-2 rounded-full font-bold"
      >
        {loading
          ? "Processing..."
          : previewImage
          ? "📸 Capture Again"
          : "📸 Capture"}
      </button>

      {result && (
        <div className="mt-6 w-full max-w-md text-left bg-gray-800 p-4 rounded-lg">
          {result.error ? (
            <p className="text-red-400">Error: {result.error}</p>
          ) : (
            <>
              <p><b>Meter Reading:</b> {result.meter_reading || "—"}</p>
              <p><b>Register Type:</b> {result.register_type || "—"}</p>
              <p><b>Serial Number:</b> {result.serial_number || "—"}</p>
              <p><b>Confidence:</b> {result.confidence || "—"}</p>
              <p><b>Notes:</b> {result.notes || "—"}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
