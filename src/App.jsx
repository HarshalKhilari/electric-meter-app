import React, { useRef, useState, useEffect } from "react";

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Start default rear camera once when loaded
  useEffect(() => {
    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: "environment" } },
          audio: false,
        });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Camera init error:", err);
        alert("Unable to access camera: " + err.message);
      }
    }
    initCamera();
  }, []);

  // Capture & send frame
  const capturePhoto = async () => {
    try {
      setLoading(true);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

      console.log("📸 Captured frame, sending to /api/ocr…");
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });

      const data = await res.json();
      console.log("✅ OCR result:", data);
      setResult(data);
    } catch (err) {
      console.error("💥 Capture error:", err);
      alert("Error capturing or sending image: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center p-4 text-white bg-gray-900 min-h-screen">
      <h1 className="text-xl font-bold mb-4">Electric Meter OCR</h1>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="rounded-lg shadow-lg w-full max-w-md"
      />

      <canvas ref={canvasRef} className="hidden" />

      <button
        onClick={capturePhoto}
        disabled={loading}
        className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full"
      >
        {loading ? "Processing…" : "📸 Capture"}
      </button>

      {result && (
        <pre className="mt-4 p-4 bg-gray-800 rounded-lg text-left w-full max-w-md">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
