import { displayUrl, formatBytes, formatCpu } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 MB"],
    [512 * 1024, "0.5 MB"],
    [150 * 1024 * 1024, "150 MB"],
    [1.5 * 1024 * 1024 * 1024, "1.5 GB"],
    // Rounds up to a full gigabyte: shown as such, not as "1024 MB".
    [1023.7 * 1024 * 1024, "1 GB"],
  ])("formats %d as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatCpu", () => {
  it.each([
    [0, "0%"],
    [3.14159, "3.1%"],
    [42.6, "43%"],
    // A bad sample from the system must not show as "NaN%" or a negative load.
    [Number.NaN, "–"],
    [Number.POSITIVE_INFINITY, "–"],
    [-1, "0%"],
  ])("formats %d as %s", (cpu, expected) => {
    expect(formatCpu(cpu)).toBe(expected);
  });
});

describe("displayUrl", () => {
  it.each([
    ["https://orteil.dashnet.org/cookieclicker/", "orteil.dashnet.org/cookieclicker/"],
    ["https://melvoridle.com", "melvoridle.com"],
    ["https://melvoridle.com/", "melvoridle.com"],
    ["not a url", "not a url"],
  ])("shows %s as %s", (url, expected) => {
    expect(displayUrl(url)).toBe(expected);
  });
});

