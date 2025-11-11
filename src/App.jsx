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
  const [devices, setDevices] = useState([]);
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  const [preferredBackDeviceId, setPreferredBackDeviceId] = useState(null);
  const [preferredFrontDeviceId, setPreferredFrontDeviceId] = useState(null);

  const [cameraReady, setCameraReady] = useState(false); // 🔧 wait for user gesture
  const [cameraError, setCameraError] = useState(null);  // 🔧 store error message

  const stopCurrentStream = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const enumerateAndChooseDevices = async () => {
    try {
      let tempStream = null;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (err) {
        console.warn("Permission not granted yet:", err);
      }

      const list = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = list.filter((d) => d.kind === "videoinput");
      let back = null, front = null;
      for (const d of videoDevices) {
        const label = (d.label || "").toLowerCase();
        if (!back && (label.includes("back") || label.includes("rear") || label.includes("environment"))) back = d.deviceId;
        if (!front && (label.includes("front") || label.includes("user"))) front = d.deviceId;
      }
      if (!back && videoDevices.length > 1) back = videoDevices.at(-1).deviceId;
      if (!front && videoDevices.length) front = videoDevices[0].deviceId;

      setDevices(videoDevices);
      setPreferredBackDeviceId(back);
      setPreferredFrontDeviceId(front);
      setCurrentDeviceId(back || front || videoDevices[0]?.deviceId || null);

      if (tempStream) tempStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      console.error("enumerate error", e);
    }
  };

  const startCameraWithDevice = async (deviceId) => {
    try {
      stopCurrentStream();
      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } } }
        : { video: { facingMode: "environment" } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      const s = track.getSettings?.() || {};
      if (s.deviceId) setCurrentDeviceId(s.deviceId);
      setCameraError(null);
    } catch (err) {
      console.error("Camera start error:", err);
      setCameraError("Unable to access camera. Please check permissions and ensure no other app is using camera.");
    }
  };

  const flipCamera = async () => {
    const target =
      currentDeviceId === preferredBackDeviceId
        ? preferredFrontDeviceId || devices[0]?.deviceId
        : preferredBackDeviceId || devices[0]?.deviceId;
    if (target) await startCameraWithDevice(target);
  };

  useEffect(() => {
    enumerateAndChooseDevices();
  }, []);

  // 🔧 start only when user clicks “Start Camera”
  const handleStartCamera = async () => {
    setCameraReady(true);
    await startCameraWithDevice(currentDeviceId);
  };

  const captureImage = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    await processImage(canvas.toDataURL("image/png"));
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
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/png", data: image.split(",")[1] } }] }],
          }),
        }
      );
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      setData(JSON.parse(text));
    } catch {
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

      {/* 🔧 If not ready, show a Start Camera button */}
      {!cameraReady && (
        <button
          onClick={handleStartCamera}
          className="px-4 py-2 bg-blue-600 text-white rounded mb-4"
        >
          Start Camera
        </button>
      )}

      <div className="relative w-80 h-auto">
        <video ref={videoRef} autoPlay playsInline muted className="w-80 rounded border bg-black" />
        {cameraReady && (
          <>
            <div className="absolute left-0 right-0 bottom-3 flex justify-center pointer-events-none">
              <button
                onClick={captureImage}
                className="pointer-events-auto w-16 h-16 rounded-full bg-white border-4 border-gray-300 shadow-lg"
              />
            </div>
            <div className="absolute right-3 bottom-6 pointer-events-none">
              <button
                onClick={flipCamera}
                className="pointer-events-auto bg-black/60 text-white px-3 py-2 rounded"
              >
                Flip
              </button>
            </div>
          </>
        )}
      </div>

      {cameraError && (
        <p className="text-red-500 mt-3">
          {cameraError}{" "}
          <button
            onClick={() => startCameraWithDevice(currentDeviceId)}
            className="underline text-blue-600 ml-1"
          >
            Retry
          </button>
        </p>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {loading && <p className="mt-4 text-yellow-500">Processing...</p>}
      {!loading && (
        <div className="mt-4 w-80">
          <input type="text" className="w-full border p-2 mb-2" placeholder="Meter Reading" value={data.reading} onChange={(e) => setData({ ...data, reading: e.target.value })}/>
          <input type="text" className="w-full border p-2 mb-2" placeholder="Unit / Register" value={data.unit} onChange={(e) => setData({ ...data, unit: e.target.value })}/>
          <input type="text" className="w-full border p-2 mb-2" placeholder="Meter Number" value={data.meter_number} onChange={(e) => setData({ ...data, meter_number: e.target.value })}/>
          <button onClick={handleSubmit} className="w-full bg-blue-600 text-white p-2 rounded">Submit</button>
        </div>
      )}
    </div>
  );
}

export default App;
