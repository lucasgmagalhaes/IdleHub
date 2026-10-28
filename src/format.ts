const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Short human readable size; one decimal only below 10 units. */
function compact(value: number): string {
  return value < 10 && value !== 0 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
}

export function formatBytes(bytes: number): string {
  return bytes >= GB ? `${compact(bytes / GB)} GB` : `${compact(bytes / MB)} MB`;
}

export function formatCpu(percent: number): string {
  return `${compact(percent)}%`;
}
