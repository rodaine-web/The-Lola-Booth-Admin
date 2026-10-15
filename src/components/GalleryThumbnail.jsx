import { useEffect, useState } from "react";
import { api } from "../api/client.js";
export default function GalleryThumbnail({ id, alt = "Gallery photo", mimeType }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true,
      url;
    api
      .blob(`/gallery-admin/media/${id}`)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (alive) setSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? (
    mimeType === "video/mp4" ? <video src={src} muted playsInline preload="metadata" aria-label={alt}/> : <img src={src} alt={alt} loading="lazy" />
  ) : (
    <div className="gallery-thumb-placeholder">Preview unavailable</div>
  );
}
