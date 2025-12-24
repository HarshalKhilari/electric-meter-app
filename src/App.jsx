import React, { useRef, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// --------------------------------------------------------
// Load OpenCV.js
// --------------------------------------------------------
const loadOpenCV = () => {
  return new Promise((resolve) => {
    if (window.cv) return resolve();
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.x/opencv.js";
    script.async = true;
    script.onload = resolve;
    document.body.appendChild(script);
  });
};

// --------------------------------------------------------
// Client-side preprocessing pipeline
// --------------------------------------------------------
const processWithOpenCV = async (canvas) => {
  await loadOpenCV();

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let clahed = new cv.Mat();
  let resized = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  clahe.apply(gray, clahed);

  const TARGET_WIDTH = 512;
  const scale = TARGET_WIDTH / clahed.cols;
  const newHeight = Math.round(clahed.rows * scale);
  const newSize = new cv.Size(TARGET_WIDTH, newHeight);

  cv.resize(clahed, resized, newSize, 0, 0, cv.INTER_AREA);

  canvas.width = TARGET_WIDTH;
  canvas.height = newHeight;

  cv.imshow(canvas, resized);

  const base64 = canvas.toDataURL("image/jpeg").split(",")[1];

  src.delete();
  gray.delete();
  clahed.delete();
  resized.delete();
  clahe.delete();

  return base64;
};

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [raw, setRaw] = useState("");
  const [previewImage, setPreviewImage] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        tempStream.getTracks().forEach((t) => t.stop());
        await listCameras();
      } catch (err) {
        console.error("Camera permission failed:", err);
      }
    };
    init();
  }, []);

  // --------------------------------------------------------
  // Camera Management
  // --------------------------------------------------------
  const stopCurrentStream = () => {
    const stream = videoRef.current?.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };

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
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera access failed: " + err.message);
    }
  };

  const listCameras = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    setCameras(videoDevices);
    
    const backCam = videoDevices.find((c) => c.label.toLowerCase().includes("back")) || videoDevices[0];
    if (backCam) {
      setSelectedCameraId(backCam.deviceId);
      startCamera(backCam.deviceId);
    }
  };

  const handleCameraChange = (e) => {
    const newId = e.target.value;
    setSelectedCameraId(newId);
    setPreviewImage(null);
    setResult(null);
    startCamera(newId);
  };

  // --------------------------------------------------------
  // SHARED PROCESSING & DB LOGIC (The Fix)
  // --------------------------------------------------------
  const processAndSave = async (canvas) => {
    setLoading(true);
    try {
      const base64 = await processWithOpenCV(canvas);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      const data = await res.json();

      if (data.ok) {
        setResult(data.result);
        setRaw(data.raw);

        // Single write point
        await supabase.from("meter_records").insert([
          {
            reading: data.result?.meter_reading || null,
            unit: data.result?.register_type || null,
            meter_number: data.result?.serial_number || null,
            notes: data.result?.notes || null,
          },
        ]);
      } else {
        setResult({ error: data.error });
      }
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------------
  // Handlers
  // --------------------------------------------------------
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        setPreviewImage(canvas.toDataURL("image/jpeg"));
        processAndSave(canvas);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    // Clear input so same file can be uploaded again if needed
    e.target.value = ""; 
  };

  const handleCaptureClick = () => {
    if (previewImage) {
      setPreviewImage(null);
      setResult(null);
      startCamera(selectedCameraId);
    } else {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      setPreviewImage(canvas.toDataURL("image/jpeg"));
      processAndSave(canvas);
    }
  };

  return (
    <div className="flex flex-col items-center bg-black text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-4">⚡ Meter OCR</h1>

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

      <div className="relative w-full max-w-md aspect-video bg-gray-900 rounded-lg overflow-hidden">
        {previewImage ? (
          <img src={previewImage} className="w-full h-full object-cover" alt="Preview" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-4 mt-6">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleImageUpload}
          className="hidden"
        />

        <button
          onClick={() => fileInputRef.current.click()}
          disabled={loading}
          className="bg-blue-600 disabled:bg-blue-900 text-white px-6 py-2 rounded-full font-bold transition"
        >
          📂 Upload
        </button>

        <button
          onClick={handleCaptureClick}
          disabled={loading}
          className="bg-yellow-500 disabled:bg-yellow-800 text-black px-6 py-2 rounded-full font-bold transition"
        >
          {loading ? "Processing..." : previewImage ? "📸 Reset" : "📸 Capture"}
        </button>
      </div>

      {result && (
        <div className="mt-6 w-full max-w-md bg-gray-800 p-4 rounded-lg">
          {result.error ? (
            <p className="text-red-400">Error: {result.error}</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p><b>Reading:</b> {result.meter_reading || "—"}</p>
              <p><b>Type:</b> {result.register_type || "—"}</p>
              <p><b>Serial:</b> {result.serial_number || "—"}</p>
              <p><b>Notes:</b> {result.notes || "—"}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}