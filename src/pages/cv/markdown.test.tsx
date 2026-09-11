// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { renderInlineBold } from "./markdown";

afterEach(cleanup);

it.each([
  "\\textbf {real bold}",
  "\\bf{real bold}",
  "{\\bf real bold}",
  "{\\bfseries real bold}",
  "\u0009extbf{real bold}",
  "\u0008f{real bold}",
  "**real\nbold**",
])("renders %s with a bold element", (text) => {
  const { container } = render(<p>{renderInlineBold(text)}</p>);
  expect(container.querySelector("strong")?.textContent?.replace(/\s+/g, " ")).toBe("real bold");
  expect(container.textContent?.replace(/\s+/g, " ")).toBe("real bold");
});

it("retains nested braces without losing the bold span", () => {
  const { container } = render(<p>{renderInlineBold("Plain \\textbf{bold {detail}} plain")}</p>);
  expect(container.querySelector("strong")?.textContent).toBe("bold {detail}");
  expect(container.textContent).toBe("Plain bold {detail} plain");
});

it("leaves malformed markup and HTML inert", () => {
  const { container } = render(<p>{renderInlineBold("**unfinished <img src=x> \\textbf{oops")}</p>);
  expect(container.querySelector("strong")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("**unfinished <img src=x> \\textbf{oops");
});

it("renders legacy LaTeX bold markers as strong text", () => {
  render(<p>{renderInlineBold("Built " + "\\textbf{reliable systems}.")}</p>);

  expect(screen.getByText("reliable systems").tagName).toBe("STRONG");
  expect(screen.queryByText(/\\textbf/)).toBeNull();
});
