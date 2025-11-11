// src/App.jsx
import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

/*
  App overview:
  - Auto-starts camera on load using a specific deviceId (preferred back camera).
  - Enumerates video inputs and chooses back/front deviceIds using heuristics.
  - Switches camera reliably by requesting getUserMedia with deviceId exact constraint.
  - Stops previous tracks before starting a new stream.
  - Capture button centered at bottom; flip button bottom-right.
*/

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // extracted data
  const [data, setData] = useState({ reading: "", unit: "", meter_number: "" });
  const [loading, setLoading] = useState(false);

  // device management
  const [devices, setDevices] = useState([]); // list of { deviceId, label }
  const [currentDeviceId, setCurrentDeviceId] = useState(null); // currently used deviceId
  const [preferredBackDeviceId, setPreferredBackDeviceId] = useState(null);
  const [preferredFrontDeviceId, setPreferredFrontDeviceId] = useState(null);

  // ----------------------------
  // Helper: stop current stream/tracks
  // ----------------------------
  const stopCurrentStream = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach((t) => {
        try {
          t.stop();
        } catch (e) {
          // ignore
        }
      });
      videoRef.current.srcObject = null;
    }
  };

  // ----------------------------
  // Enumerate devices and choose defaults
  // ----------------------------
  const enumerateAndChooseDevices = async () => {
    try {
      // 1) If we don't have permission yet, request a short stream to get device labels.
      //    This is necessary on many browsers (enumerateDevices hides labels until permission granted).
      let tempStream = null;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        // attach briefly to videoRef to ensure camera is active and labels will appear.
        if (videoRef.current && !videoRef.current.srcObject) {
          videoRef.current.srcObject = tempStream;
        }
      } catch (err) {
        // If user denies, enumeration may still return device IDs but labels may be blank.
        console.warn("Initial permission request for camera failed or not granted yet.", err);
      }

      // 2) Enumerate devices
      const list = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = list.filter((d) => d.kind === "videoinput").map((d) => ({
        deviceId: d.deviceId,
        label: d.label || "Camera"
      }));

      // 3) Heuristics to pick back and front devices from labels
      //    Look for keywords commonly included in labels: 'back', 'rear', 'environment', 'front', 'user'
      let back = null;
      let front = null;
      for (const d of videoDevices) {
        const lab = d.label.toLowerCase();
        if (!back && (lab.includes("back") || lab.includes("rear") || lab.includes("environment"))) {
          back = d.deviceId;
        }
        if (!front && (lab.includes("front") || lab.includes("user"))) {
          front = d.deviceId;
        }
      }

      // 4) If heuristics failed, fallback: if there are >1 cameras, choose last as back, first as front
      if (!back && videoDevices.length > 1) {
        back = videoDevices[videoDevices.length - 1].deviceId;
      }
      if (!front && videoDevices.length > 0) {
        front = videoDevices[0].deviceId;
      }

      // 5) Save list and preferred ids
      setDevices(videoDevices);
      setPreferredBackDeviceId(back);
      setPreferredFrontDeviceId(front);

      // 6) Choose initial currentDeviceId: prefer back if available
      const initialDevice = back || front || (videoDevices[0] && videoDevices[0].deviceId) || null;
      setCurrentDeviceId(initialDevice);

      // 7) Stop the temp stream (if allocated) - we only used it to get labels
      if (tempStream) {
        tempStream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    } catch (err) {
      console.error("Error enumerating devices:", err);
    }
  };

  // ----------------------------
  // Start camera using a deviceId (preferred) or fallback
  // ----------------------------
  const startCameraWithDevice = async (deviceId) => {
    try {
      // stop any existing to avoid conflicts
      stopCurrentStream();

      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } }, audio: false }
        : { video: { facingMode: "environment" }, audio: false };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // save the actual deviceId from the running track (useful if browser mapped facingMode)
      const runningTrack = stream.getVideoTracks()[0];
      const settings = runningTrack.getSettings ? runningTrack.getSettings() : {};
      if (settings && settings.deviceId) {
        setCurrentDeviceId(settings.deviceId);
      }
    } catch (err) {
      console.error("Camera start error:", err);
      alert("Unable to access camera. Please check permissions and ensure no other app is using camera.");
    }
  };

  // ----------------------------
  // Flip camera function: toggles between preferred back/front device ids or cycles available devices
  // ----------------------------
  const flipCamera = async () => {
    // if we have explicit preferred IDs, toggle between them
    if (preferredBackDeviceId || preferredFrontDeviceId) {
      const target =
        currentDeviceId === preferredBackDeviceId
          ? preferredFrontDeviceId || (devices[0] && devices[0].deviceId)
          : preferredBackDeviceId || (devices[0] && devices[0].deviceId);
      if (target) {
        await startCameraWithDevice(target);
      } else {
        // fallback: cycle through devices list
        cycleDevices();
      }
    } else {
      // fallback: cycle
      cycleDevices();
    }
  };

  // fallback cycle: pick next device in the devices array
  const cycleDevices = async () => {
    if (!devices || devices.length === 0) return;
    const idx = devices.findIndex((d) => d.deviceId === currentDeviceId);
    const nextIdx = idx < 0 ? 0 : (idx + 1) % devices.length;
    const nextDevice = devices[nextIdx].deviceId;
    await startCameraWithDevice(nextDevice);
  };

  // ----------------------------
  // On mount: enumerate devices and auto-start camera
  // ----------------------------
  useEffect(() => {
    // Run once on mount: enumerate and choose defaults (also gets permission prompt)
    enumerateAndChooseDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever currentDeviceId changes, start camera using that device
  useEffect(() => {
    if (currentDeviceId) {
      startCameraWithDevice(currentDeviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDeviceId]);

  // ----------------------------
  // Capture & processing functions (unchanged logic)
  // ----------------------------
  const captureImage = async () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // draw the video frame to canvas (match aspect ratio)
    // make sure canvas size matches video display size for good resolution
    const video = videoRef.current;
    canvas.width = video.videoWidth || 400;
    canvas.height = video.videoHeight || 300;
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
      let text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      try {
        const parsed = JSON.parse(text);
        setData(parsed);
      } catch {
        setData({ reading: "", unit: "", meter_number: "" });
      }
    } catch (err) {
      console.error("processImage error:", err);
      alert("Error processing image. Check console.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    await supabase.from("meter_records").insert([data]);
    alert("Submitted successfully!");
  };

  // ----------------------------
  // UI: Video + overlaid controls (capture centered bottom, flip bottom-right)
  // ----------------------------

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Electric Meter Reader</h1>

      {/* container for video and overlay buttons */}
      <div className="relative w-80 h-auto">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-80 h-auto rounded border bg-black"
        />
        {/* capture button: centered bottom */}
        <div className="absolute left-0 right-0 bottom-3 flex justify-center pointer-events-none">
          <button
            onClick={captureImage}
            className="pointer-events-auto w-16 h-16 rounded-full bg-white border-4 border-gray-300 shadow-lg"
            title="Capture"
          />
        </div>

        {/* flip button: bottom-right */}
        <div className="absolute right-3 bottom-6 pointer-events-none">
          <button
            onClick={flipCamera}
            className="pointer-events-auto bg-black/60 text-white px-3 py-2 rounded"
          >
            Flip
          </button>
        </div>
      </div>

      {/* canvas used for capture (hidden) */}
      <canvas ref={canvasRef} className="hidden" />

      {loading && <p className="mt-4 text-yellow-500">Processing...</p>}

      {!loading && (
        <div className="mt-4 w-80">
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Meter Reading"
            value={data.reading}
            onChange={(e) => setData({ ...data, reading: e.target.value })}
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Unit / Register"
            value={data.unit}
            onChange={(e) => setData({ ...data, unit: e.target.value })}
          />
          <input
            type="text"
            className="w-full border p-2 mb-2"
            placeholder="Meter Number"
            value={data.meter_number}
            onChange={(e) => setData({ ...data, meter_number: e.target.value })}
          />
          <button onClick={handleSubmit} className="w-full bg-blue-600 text-white p-2 rounded">
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
