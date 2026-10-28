import { useState } from "react";

/** Site icon of a tab, falling back to its first letter. */
export function Favicon({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  let src: string | null = null;
  try {
    src = new URL("/favicon.ico", url).href;
  } catch {
    // Invalid URLs simply use the letter fallback.
  }
  if (failed || !src) {
    return (
      <span className="favicon favicon-letter" aria-hidden="true">
        {label.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className="favicon" src={src} alt="" onError={() => setFailed(true)} />;
}
