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

  // ✅ preview / capture state
  const [previewImage, setPreviewImage] = useState(null);

  // ✅ camera switching
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  useEffect(() => {
    const init = async () => {
      await startCamera();
      await listCameras();
    };

    init();
  }, []);

  // --------------------------------------------------------

  const stopCurrentStream = () => {
      const stream = videoRef.current?.srcObject;
      if (!stream) return;

      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    };

    // --------------------------------------------------------

    const startCamera = async (deviceId = null) => {
      try {
        stopCurrentStream();

        const constraints = {
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { exact: "environment" } }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        videoRef.current.srcObject = stream;

      } catch (err) {
        alert("Camera access failed: " + err.message);
      }
    };

  // --------------------------------------------------------
  const detectDefaultCamera = (cameras) => {
    const labelsLower = cameras.map(c => ({
      ...c,
      labelLower: c.label.toLowerCase()
    }));

    // ✅ Best match: main back camera (has "back" AND "0")
    let primary = labelsLower.find(
      cam =>
        cam.labelLower.includes("back") &&
        cam.labelLower.includes("0")
    );

    // ✅ Fallback: any back camera
    if (!primary) {
      primary = labelsLower.find(
        cam => cam.labelLower.includes("back")
      );
    }

    // ✅ Final fallback: first available camera
    if (!primary && cameras.length > 0) {
      primary = cameras[0];
    }

    return primary || null;
  };

  // --------------------------------------------------------

  const listCameras = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === "videoinput");

    setCameras(cameras);

    const defaultCam = detectDefaultCamera(cameras);

    if (defaultCam) {
      setSelectedCameraId(defaultCam.deviceId);
      startCamera(defaultCam.deviceId);
    }
  };


  // --------------------------------------------------------

  const handleCameraChange = (e) => {
    const newId = e.target.value;

    setSelectedCameraId(newId);

    // reset preview / OCR state
    setPreviewImage(null);
    setResult(null);
    setRaw("");

    // restart camera with chosen lens
    startCamera(newId);
  };

  // --------------------------------------------------------

  const handleCaptureClick = () => {
    if (previewImage) {
      // back to live camera
      setPreviewImage(null);
      setResult(null);
      setRaw("");

      startCamera(selectedCameraId);

    } else {
      captureImage();
    }
  };

  // --------------------------------------------------------

  const captureImage = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // save preview
    const captureUrl = canvas.toDataURL("image/jpeg");
    setPreviewImage(captureUrl);

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

  // --------------------------------------------------------

  return (
    <div className="flex flex-col items-center bg-black text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-4">⚡ Meter OCR (Gemini)</h1>

      {/* Camera selector */}
      {cameras.length > 0 && (
        <select
          className="mb-3 bg-gray-800 text-white px-2 py-1 rounded"
          value={selectedCameraId || ""}
          onChange={handleCameraChange}
        >
          {cameras.map((cam, i) => (
            <option key={cam.deviceId} value={cam.deviceId}>
              {cam.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      )}

      {/* Live or preview */}
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

      {/* Capture / Restart */}
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
