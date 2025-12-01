import React, { useRef, useState, useEffect } from "react";

export default function App() {
  const videoRef = useRef(null);

  const [cameraInfo, setCameraInfo] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const init = async () => {
      await startCamera();
      await listCameras();
    };

    init();
  }, []);

  // Start camera (request permission)
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" } },
        audio: false,
      });

      videoRef.current.srcObject = stream;
    } catch (err) {
      setError("Camera access failed: " + err.message);
    }
  };

  // Enumerate cameras AFTER permission is granted
  const listCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(
        (device) => device.kind === "videoinput"
      );

      setCameraInfo(cameras);
    } catch (err) {
      setError("Device enumeration failed: " + err.message);
    }
  };

  return (
    <div className="flex flex-col items-center bg-black text-white min-h-screen p-4">
      <h1 className="text-xl font-bold mb-4">📷 Camera Debug Tool</h1>

      {/* LIVE VIDEO FEED */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full max-w-md rounded-lg border border-yellow-400"
      />

      {/* ERROR DISPLAY */}
      {error && (
        <div className="mt-4 text-red-400">
          {error}
        </div>
      )}

      {/* CAMERA DEBUG PANEL */}
      {cameraInfo.length > 0 && (
        <div className="mt-6 w-full max-w-md text-left bg-gray-900 p-4 rounded-lg text-sm">
          <p className="font-bold mb-2">
            📷 Cameras detected: {cameraInfo.length}
          </p>

          {cameraInfo.map((cam, i) => (
            <div
              key={cam.deviceId}
              className="mb-3 pb-2 border-b border-gray-700"
            >
              <p><b>#{i}</b></p>
              <p>Label: {cam.label || "(No label available)"}</p>
              <p>ID: {cam.deviceId}</p>
              <p>Group: {cam.groupId}</p>
              <p>Kind: {cam.kind}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
