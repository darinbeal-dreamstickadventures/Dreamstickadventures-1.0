import { useEffect, useRef, useState } from "react";

function useQueryParam(key: string) {
  const params = new URLSearchParams(window.location.search);
  return params.get(key);
}

export default function Watch() {
  const filename = useQueryParam("v");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const src = filename ? `/videos/${filename}` : "";

  useEffect(() => {
    if (!filename) setError("No video specified. Add ?v=filename to the URL.");
  }, [filename]);

  async function handleDownload() {
    if (!src) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("Could not fetch video");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? "dreamstick-story.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError("Download failed: " + e.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0015] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full flex flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-yellow-400 drop-shadow-[0_0_12px_#FFD700]">
            ✨ DreamStick Adventures
          </h1>
          <p className="text-purple-300 mt-1 text-sm">Your personalised bedtime story video</p>
        </div>

        {error ? (
          <div className="bg-red-900/40 border border-red-500 text-red-300 rounded-xl p-4 text-center text-sm">
            {error}
          </div>
        ) : src ? (
          <>
            <div className="w-full rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(147,51,234,0.5)] border border-purple-700">
              <video
                ref={videoRef}
                src={src}
                controls
                autoPlay={false}
                playsInline
                className="w-full"
                style={{ maxHeight: "70vh", background: "#000" }}
              >
                Your browser does not support HTML5 video.
              </video>
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full py-3 px-6 rounded-xl font-bold text-black bg-yellow-400 hover:bg-yellow-300 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,215,0,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {downloading ? "Downloading…" : "⬇️  Download MP4"}
            </button>

            <p className="text-purple-400 text-xs text-center">
              1080 × 1920 · 30fps · H.264 · 2 minutes
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
