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

  // Preview / capture state
  const [previewImage, setPreviewImage] = useState(null);

  // Camera list + selected camera
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        // 1) Ask for generic permission so labels are populated
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        // Immediately stop this temp stream
        tempStream.getTracks().forEach((t) => t.stop());

        // 2) Now list cameras and auto-select default
        await listCameras();
      } catch (err) {
        alert("Camera permission failed: " + err.message);
      }
    };

    init();
  }, []);

  // --------------------------------------------------------
  // Stop any existing video stream
  const stopCurrentStream = () => {
    const stream = videoRef.current?.srcObject;
    if (!stream) return;

    stream.getTracks().forEach((t) => t.stop());
    videoRef.current.srcObject = null;
  };

  // --------------------------------------------------------
  // Start camera with optional deviceId
  const startCamera = async (deviceId = null) => {
    try {
      stopCurrentStream();

      const constraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { exact: "environment" } },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera access failed: " + err.message);
    }
  };

  // --------------------------------------------------------
  // 1. Get all camera properties
  const getAllCameras = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    return cams;
  };

  // --------------------------------------------------------
  // 2. Find camera whose label contains "back" and "0" (with fallbacks)
  const findMainBackCamera = (cams) => {
    if (!cams || cams.length === 0) return null;

    // Primary rule: label has "back" AND "0"
    let cam =
      cams.find(
        (c) => c.label.includes("back") && c.label.includes("0")
      ) ||
      // Fallback: any label with "back"
      cams.find((c) => c.label.includes("back")) ||
      // Fallback: first camera
      cams[0] ||
      null;

    return cam;
  };

  // --------------------------------------------------------
  // 3. Select that camera device as default and start it
  const selectDefaultCamera = (cams) => {
    const chosen = findMainBackCamera(cams);
    if (!chosen) return null;

    setSelectedCameraId(chosen.deviceId);
    startCamera(chosen.deviceId);

    return chosen;
  };

  // --------------------------------------------------------
  // Wrapper: get cameras, store list, and select default
  const listCameras = async () => {
    const cams = await getAllCameras();

    setCameras(cams);          // used for dropdown
    selectDefaultCamera(cams); // auto-select main/back/0 camera
  };

  // --------------------------------------------------------
  // Called when user manually changes camera from dropdown
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
  // Capture button behavior (preview vs live)
  const handleCaptureClick = () => {
    if (previewImage) {
      // back to live camera
      setPreviewImage(null);
      setResult(null);
      setRaw("");

      // restart currently selected camera
      startCamera(selectedCameraId);
    } else {
      captureImage();
    }
  };

  // --------------------------------------------------------
  // Capture image, show preview, send to OCR
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
              <p>
                <b>Meter Reading:</b> {result.meter_reading || "—"}
              </p>
              <p>
                <b>Register Type:</b> {result.register_type || "—"}
              </p>
              <p>
                <b>Serial Number:</b> {result.serial_number || "—"}
              </p>
              <p>
                <b>Confidence:</b> {result.confidence || "—"}
              </p>
              <p>
                <b>Notes:</b> {result.notes || "—"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
