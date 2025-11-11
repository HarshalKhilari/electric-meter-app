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

  // Device lists & IDs
  const [videoDevices, setVideoDevices] = useState([]);
  const [backDeviceId, setBackDeviceId] = useState(null);
  const [frontDeviceId, setFrontDeviceId] = useState(null);
  const [currentDeviceId, setCurrentDeviceId] = useState(null);

  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // Stop existing stream
  const stopStream = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
      });
      videoRef.current.srcObject = null;
    }
  };

  // Enumerate devices & choose preferred cameras (with improved logic)
  const setupDevices = async () => {
    try {
      // get permission for camera to fetch labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stopStream();

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      // Preparation: separate back & front
      let back = null;
      let front = null;

      // first, find front by label
      for (const device of videoInputs) {
        const lbl = (device.label || "").toLowerCase();
        if (lbl.includes("front") || lbl.includes("user")) {
          front = device.deviceId;
          break;
        }
      }
      // then find back by label, prioritise those not ultra-wide
      for (const device of videoInputs) {
        const lbl = (device.label || "").toLowerCase();
        if ((lbl.includes("back") || lbl.includes("rear") || lbl.includes("environment")) &&
            !lbl.includes("ultra") && !lbl.includes("wide") && !lbl.includes("tele") ) {
          back = device.deviceId;
          break;
        }
      }
      // fallback: if no “good” back found, pick first back candidate
      if (!back) {
        for (const device of videoInputs) {
          const lbl = (device.label || "").toLowerCase();
          if (lbl.includes("back") || lbl.includes("rear") || lbl.includes("environment")) {
            back = device.deviceId;
            break;
          }
        }
      }
      // fallback further: if still none, pick first or only
      if (!back && videoInputs.length > 0) {
        back = videoInputs[0].deviceId;
      }
      if (!front && videoInputs.length > 1) {
        front = videoInputs[1].deviceId;
      }

      setVideoDevices(videoInputs);
      setBackDeviceId(back);
      setFrontDeviceId(front);
      setCurrentDeviceId(back || front || null);

    } catch (err) {
      console.error("setupDevices error:", err);
    }
  };

  // Start camera using a specific facingMode
  const startCamera = async (facingMode) => {
    try {
      stopStream();

      // Use facingMode for reliable switching on mobile
      const constraints = {
        video: {
          facingMode: facingMode, // "user" or "environment"
          // Optional: set an ideal resolution to try and select the default wide lens
          // ideal: { width: 1280, height: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Update currentDeviceId based on the actual track settings (optional but good practice)
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      if (settings.deviceId) {
        setCurrentDeviceId(settings.deviceId);
      }

      // Update back/front IDs to match the current camera for flip logic consistency
      if (facingMode === "environment") {
        setBackDeviceId(settings.deviceId);
      } else if (facingMode === "user") {
        setFrontDeviceId(settings.deviceId);
      }

      setCameraError(null);
      setCameraStarted(true);
    } catch (err) {
      console.error("startCamera error:", err);
      setCameraError("Unable to access camera. Please check permissions and no other app is using the camera.");
    }
  };

  // Flip camera logic
  const flipCamera = async () => {
    // Determine the current facing mode based on which ID is currently active
    const isCurrentlyFront = currentDeviceId && frontDeviceId && currentDeviceId === frontDeviceId;
    const isCurrentlyBack = currentDeviceId && backDeviceId && currentDeviceId === backDeviceId;

    let targetFacingMode = "environment"; // Default to back

    if (isCurrentlyBack) {
      targetFacingMode = "user"; // Switch to front
    } else if (isCurrentlyFront) {
      targetFacingMode = "environment"; // Switch to back
    }
    // If neither is defined (first start), it defaults to "environment" (back) as set above.

    await startCamera(targetFacingMode);
  };
  
  // On mount: setup devices
  useEffect(() => {
    setupDevices();
  }, []);

  // Capture logic
  const captureImage = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
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
                  { inline_data: { mime_type: "image/png", data: image.split(",")[1] } },
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
      console.error("processImage error:", err);
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

      <div className="relative w-80 h-auto">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-80 h-auto rounded border bg-black"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Capture or start button at bottom center */}
        <div className="absolute left-0 right-0 bottom-3 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              if (!cameraStarted) {
                startCamera("environment");
              } else {
                captureImage();
              }
            }}
            className="pointer-events-auto w-16 h-16 rounded-full bg-white border-4 border-gray-300 shadow-lg"
            title={cameraStarted ? "Capture" : "Start Camera"}
          />
        </div>

        {/* Flip camera icon at bottom-right */}
        <div className="absolute right-3 bottom-6 pointer-events-none">
          <button
            onClick={flipCamera}
            className="pointer-events-auto bg-black/60 text-white p-2 rounded flex items-center justify-center"
            title="Flip Camera"
          >
            {/* Simple flip icon: */}
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4-4m0 0l-4-4m4 4H9m0 8l-4 4m0 0l4 4m-4-4h10" />
            </svg>
          </button>
        </div>
      </div>

      {cameraError && (
        <p className="text-red-500 mt-3 text-center">
          {cameraError}
          <button
            onClick={() => startCamera("environment")}
            className="underline text-blue-600 ml-1"
          >
            Retry
          </button>
        </p>
      )}

      {loading && <p className="mt-4 text-yellow-500">Processing...</p>}
      {!loading && (
        <div className="mt-4 w-80">
          <input type="text" className="w-full border p-2 mb-2" placeholder="Meter Reading" value={data.reading} onChange={(e) => setData({ ...data, reading: e.target.value })}/>
          <input type="text" classNow="w-full border p-2 mb-2" placeholder="Unit / Register" value={data.unit} onChange={(e) => setData({ ...data, unit: e.target.value })}/>
          <input type="text" className="w-full border p-2 mb-2" placeholder="Meter Number" value={data.meter_number} onChange={(e) => setData({ ...data, meter_number: e.target.value })}/>
          <button onClick={handleSubmit} className="w-full bg-blue-600 text-white p-2 rounded">Submit</button>
        </div>
      )}
    </div>
  );
}

export default App;
