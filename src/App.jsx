import React, { useEffect, useRef, useState } from "react";
import cv from "@techstark/opencv-js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [imageData, setImageData] = useState(null);
  const [meterReading, setMeterReading] = useState("");
  const [registerType, setRegisterType] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [processing, setProcessing] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  // 🎞 Start camera
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, // Default back camera
        });
        videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Camera error:", err);
      }
    };

    cv["onRuntimeInitialized"] = () => {
      console.log("✅ OpenCV.js loaded");
      setModelReady(true);
      initCamera();
    };
  }, []);

  // 📸 Capture image from video feed
  const captureImage = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg");
    setImageData(dataUrl);
  };

  // 🧠 Preprocess using CLAHE + resize
  const preprocessImage = async (imgDataUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imgDataUrl;
      img.onload = () => {
        const mat = cv.imread(img);
        cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY);

        const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
        const claheResult = new cv.Mat();
        clahe.apply(mat, claheResult);

        const targetHeight = 720;
        const scale = targetHeight / claheResult.rows;
        const targetWidth = Math.round(claheResult.cols * scale);
        const resized = new cv.Mat();
        cv.resize(claheResult, resized, new cv.Size(targetWidth, targetHeight));

        const outputCanvas = document.createElement("canvas");
        cv.imshow(outputCanvas, resized);
        const processedData = outputCanvas.toDataURL("image/jpeg");

        // Free memory
        mat.delete();
        clahe.delete();
        claheResult.delete();
        resized.delete();

        resolve(processedData);
      };
    });
  };

  // ⚙️ Send image to Gemini OCR API
  const handleProcess = async () => {
    if (!imageData) return alert("Please capture an image first");
    setProcessing(true);

    try {
      const processedImage = await preprocessImage(imageData);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: processedImage }),
      });

      const result = await res.json();

      setMeterReading(result.meter_reading || "");
      setRegisterType(result.register_type || "");
      setSerialNumber(result.serial_number || "");
    } catch (e) {
      console.error("Processing failed:", e);
    }

    setProcessing(false);
  };

  // 💾 Save to Supabase
  const handleSubmit = async () => {
    const { error } = await supabase.from("meter_readings").insert([
      {
        meter_reading: meterReading,
        register_type: registerType,
        serial_number: serialNumber,
        timestamp: new Date().toISOString(),
      },
    ]);

    if (error) alert("Failed to save: " + error.message);
    else alert("✅ Saved successfully!");
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-2xl font-bold mb-4">⚡ Meter OCR v2</h1>

      <div className="relative rounded-lg overflow-hidden shadow-lg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="rounded-lg w-[360px] h-[480px] bg-black"
        />
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-4 mt-4">
        <button
          onClick={captureImage}
          className="bg-blue-500 px-4 py-2 rounded-lg hover:bg-blue-600"
        >
          📸 Capture
        </button>
        <button
          onClick={handleProcess}
          disabled={!modelReady || processing}
          className={`${
            processing ? "bg-gray-500" : "bg-green-500"
          } px-4 py-2 rounded-lg hover:bg-green-600`}
        >
          {processing ? "Processing..." : "Run OCR"}
        </button>
      </div>

      <div className="mt-6 w-80 space-y-3">
        <div>
          <label className="block text-sm">Meter Reading</label>
          <input
            value={meterReading}
            onChange={(e) => setMeterReading(e.target.value)}
            className="w-full p-2 text-black rounded"
          />
        </div>

        <div>
          <label className="block text-sm">Register/Unit</label>
          <input
            value={registerType}
            onChange={(e) => setRegisterType(e.target.value)}
            className="w-full p-2 text-black rounded"
          />
        </div>

        <div>
          <label className="block text-sm">Meter Number</label>
          <input
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className="w-full p-2 text-black rounded"
          />
        </div>

        <button
          onClick={handleSubmit}
          className="mt-4 bg-yellow-500 px-4 py-2 rounded-lg hover:bg-yellow-600 w-full"
        >
          ✅ Submit
        </button>
      </div>
    </div>
  );
}
