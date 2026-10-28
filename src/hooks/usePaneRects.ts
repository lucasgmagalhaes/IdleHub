import { useLayoutEffect, type RefObject } from "react";
import type { Rect } from "../backend";

/**
 * Reports where each pane's content area is, so the host can put the native
 * game webview exactly there. Measures on resize and whenever `layoutKey` changes.
 */
export function usePaneRects(
  container: RefObject<HTMLElement | null>,
  layoutKey: string,
  onRects: (rects: Rect[]) => void,
) {
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    let last = "";
    const measure = () => {
      const rects = [...root.querySelectorAll<HTMLElement>("[data-pane-content]")]
        .sort((a, b) => Number(a.dataset.paneContent) - Number(b.dataset.paneContent))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        });
      const key = JSON.stringify(rects);
      if (key !== last) {
        last = key;
        onRects(rects);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [container, layoutKey, onRects]);
}
