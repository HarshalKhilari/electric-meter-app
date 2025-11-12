import React, { useRef, useState, useEffect } from "react";

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [result, setResult] = useState(null);
  const [rawJson, setRawJson] = useState("");

  useEffect(() => {
    startCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" } },
        audio: false,
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera error:", err);
      alert("Unable to access camera. Please allow permissions.");
    }
  };

  const applyClaheAndResize = (imageData) => {
    const src = cv.matFromImageData(imageData);
    const ycrcb = new cv.Mat();
    cv.cvtColor(src, ycrcb, cv.COLOR_RGBA2YCrCb);
    const channels = new cv.MatVector();
    cv.split(ycrcb, channels);
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(channels.get(0), channels.get(0));
    cv.merge(channels, ycrcb);
    cv.cvtColor(ycrcb, src, cv.COLOR_YCrCb2RGBA);
    const dsize = new cv.Size(1280, 720);
    const resized = new cv.Mat();
    cv.resize(src, resized, dsize, 0, 0, cv.INTER_AREA);
    const processedImage = new ImageData(
      new Uint8ClampedArray(resized.data),
      resized.cols,
      resized.rows
    );
    src.delete();
    ycrcb.delete();
    resized.delete();
    channels.delete();
    clahe.delete();
    return processedImage;
  };

  const captureImage = async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const processed = applyClaheAndResize(imageData);
    ctx.putImageData(processed, 0, 0);

    const base64 = canvas.toDataURL("image/jpeg").split(",")[1];

    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64 }),
    });

    const data = await res.json();
    if (data.ok) {
      setResult(data.result);
      setRawJson(data.raw);
    } else {
      setResult({
        meter_reading: null,
        register_type: null,
        serial_number: null,
        confidence: "low",
        notes: data.error,
      });
    }
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-950 text-white p-4">
      <h1 className="text-2xl font-bold mb-4">⚡ Electricity Meter OCR</h1>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full max-w-md rounded-lg shadow-lg"
      />

      <canvas ref={canvasRef} className="hidden"></canvas>

      <button
        onClick={captureImage}
        className="mt-4 bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 px-6 rounded-full"
      >
        📸 Capture
      </button>

      {result && (
        <div className="mt-6 w-full max-w-md bg-gray-800 p-4 rounded-lg shadow-md text-left">
          <p><b>Meter Reading:</b> {result.meter_reading || "—"}</p>
          <p><b>Register Type:</b> {result.register_type || "—"}</p>
          <p><b>Serial Number:</b> {result.serial_number || "—"}</p>
          <p><b>Confidence:</b> {result.confidence || "—"}</p>
          <p><b>Notes:</b> {result.notes || "—"}</p>
        </div>
      )}

      {rawJson && (
        <div className="mt-4 w-full max-w-md bg-gray-900 p-4 rounded-md">
          <h2 className="font-semibold text-yellow-400 mb-2">Raw JSON Output:</h2>
          <pre className="text-sm whitespace-pre-wrap break-words">
            {rawJson}
          </pre>
        </div>
      )}
    </div>
  );
}
