import { render, screen } from "@testing-library/react";
import { Meter } from "./Meter";

describe("Meter", () => {
  it.each([
    [42.4, "42"],
    [150, "100"],
    [-5, "0"],
    [Number.NaN, "0"],
  ])("shows %s percent as a value of %s", (percent, expected) => {
    render(<Meter label="CPU" percent={percent} text="" />);
    expect(screen.getByRole("meter", { name: "CPU" })).toHaveAttribute("aria-valuenow", expected);
  });
});
