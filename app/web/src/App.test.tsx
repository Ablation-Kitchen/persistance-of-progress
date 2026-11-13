// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "./App";

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe("app shell", () => {
  it.each([
    ["/today", "Today"],
    ["/path", "Path"],
    ["/notes", "Notes"],
  ])("%s shows its placeholder and marks the nav link", (url, title) => {
    renderAt(url);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByRole("link", { name: title }).className).toContain("on");
  });

  it("redirects / to Today", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today");
  });

  it("the toggle flips data-theme on <html>", () => {
    document.documentElement.dataset.theme = "light";
    renderAt("/today");
    fireEvent.click(screen.getByRole("button", { name: /switch to dark/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /switch to light/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
