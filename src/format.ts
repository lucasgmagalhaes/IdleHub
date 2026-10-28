const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Short human readable size; one decimal only below 10 units. */
function compact(value: number): string {
  return value < 10 && value !== 0 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
}

export function formatBytes(bytes: number): string {
  // Sizes that round to 1024 MB are shown as 1 GB.
  return Math.round(bytes / MB) >= 1024 ? `${compact(bytes / GB)} GB` : `${compact(bytes / MB)} MB`;
}

/** A sample the system could not measure shows as a dash, never as "NaN%". */
export function formatCpu(percent: number): string {
  return Number.isFinite(percent) ? `${compact(Math.max(0, percent))}%` : "–";
}

/** Host and path without the protocol, e.g. `orteil.dashnet.org/cookieclicker/`. */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
}
