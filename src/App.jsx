import React, { useRef, useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// --------------------------------------------------------
// Load OpenCV.js (once)
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
// Client-side preprocessing:
//  - grayscale
//  - CLAHE
//  - sharpen (unblur)
//  - resize to 720px width
// --------------------------------------------------------
const processWithOpenCV = async (canvas) => {
  await loadOpenCV();

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let clahed = new cv.Mat();
  let sharpened = new cv.Mat();
  let resized = new cv.Mat();

  // Grayscale
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // CLAHE
  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  clahe.apply(gray, clahed);

  // Sharpen filter
  const kernel = cv.matFromArray(
    3,
    3,
    cv.CV_32F,
    [
      0, -1, 0,
     -1,  5, -1,
      0, -1, 0,
    ]
  );
  cv.filter2D(clahed, sharpened, cv.CV_8U, kernel);

  // Resize → 720px width
  const TARGET_WIDTH = 512;
  const scale = TARGET_WIDTH / sharpened.cols;
  const newHeight = Math.round(sharpened.rows * scale);
  const newSize = new cv.Size(TARGET_WIDTH, newHeight);

  cv.resize(sharpened, resized, newSize, 0, 0, cv.INTER_AREA);

  // Draw back to canvas
  canvas.width = TARGET_WIDTH;
  canvas.height = newHeight;
  cv.imshow(canvas, resized);

  const base64 = canvas.toDataURL("image/jpeg").split(",")[1];

  // Cleanup
  src.delete();
  gray.delete();
  clahed.delete();
  sharpened.delete();
  resized.delete();
  kernel.delete();
  clahe.delete();

  return base64;
};

// --------------------------------------------------------

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
        // Ask permission so labels populate
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        tempStream.getTracks().forEach((t) => t.stop());

        await listCameras();
      } catch (err) {
        alert("Camera permission failed: " + err.message);
      }
    };

    init();
  }, []);

  // --------------------------------------------------------
  const stopCurrentStream = () => {
    const stream = videoRef.current?.srcObject;
    if (!stream) return;

    stream.getTracks().forEach((t) => t.stop());
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
          : { facingMode: { exact: "environment" } },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Camera access failed: " + err.message);
    }
  };

  // --------------------------------------------------------
  const getAllCameras = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  };

  // --------------------------------------------------------
  const findMainBackCamera = (cams) => {
    if (!cams || cams.length === 0) return null;

    return (
      cams.find((c) => c.label.includes("back") && c.label.includes("0")) ||
      cams.find((c) => c.label.includes("back")) ||
      cams[0] ||
      null
    );
  };

  // --------------------------------------------------------
  const selectDefaultCamera = (cams) => {
    const chosen = findMainBackCamera(cams);
    if (!chosen) return null;

    setSelectedCameraId(chosen.deviceId);
    startCamera(chosen.deviceId);

    return chosen;
  };

  // --------------------------------------------------------
  const listCameras = async () => {
    const cams = await getAllCameras();
    setCameras(cams);
    selectDefaultCamera(cams);
  };

  // --------------------------------------------------------
  const handleCameraChange = (e) => {
    const newId = e.target.value;

    setSelectedCameraId(newId);
    setPreviewImage(null);
    setResult(null);
    setRaw("");

    startCamera(newId);
  };

  // --------------------------------------------------------
  const handleCaptureClick = () => {
    if (previewImage) {
      setPreviewImage(null);
      setResult(null);
      setRaw("");
      startCamera(selectedCameraId);
    } else {
      captureImage();
    }
  };

  // --------------------------------------------------------
  // Capture → preview → preprocess (OpenCV) → OCR
  const captureImage = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Show raw preview
    const previewUrl = canvas.toDataURL("image/jpeg");
    setPreviewImage(previewUrl);

    setLoading(true);

    try {
      // Preprocess client-side
      const base64 = await processWithOpenCV(canvas);

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
      <h1 className="text-xl font-bold mb-4">
        ⚡ Meter OCR (Client-side OpenCV preprocessing)
      </h1>

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
        {loading ? "Processing..." : previewImage ? "📸 Capture Again" : "📸 Capture"}
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
