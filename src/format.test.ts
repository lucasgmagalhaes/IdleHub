import { formatBytes, formatCpu } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 MB"],
    [512 * 1024, "0.5 MB"],
    [150 * 1024 * 1024, "150 MB"],
    [1.5 * 1024 * 1024 * 1024, "1.5 GB"],
  ])("formats %d as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatCpu", () => {
  it.each([
    [0, "0%"],
    [3.14159, "3.1%"],
    [42.6, "43%"],
  ])("formats %d as %s", (cpu, expected) => {
    expect(formatCpu(cpu)).toBe(expected);
  });
});
