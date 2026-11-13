// @vitest-environment jsdom
import { File } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addDays, localToday, weekday } from "@learning-tracker/core";
import { FIXTURE, startServer, type TestServer } from "./test/server";
import { renderApp } from "./test/render";
import { nextWeekday } from "./today";

let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});

afterEach(async () => {
  cleanup();
  delete document.documentElement.dataset.theme;
  await server.close();
});

async function startFixture(dateLabel?: "Today") {
  fireEvent.click(await screen.findByRole("button", { name: /^Load / }));
  const dialog = await screen.findByRole("dialog");
  if (dateLabel) fireEvent.click(within(dialog).getByRole("button", { name: dateLabel }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
  await screen.findByRole("heading", { level: 1, name: TODAY_H1 });
}

/** The Today screen's h1 in any of its states (during, before the start, after the end). */
const TODAY_H1 = /^(Today|Almost ready|You finished it)\.$/;

describe("first run", () => {
  it("empty state → fixture listed → start date → Today for the new active Enrollment", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Pick a path." })).toBeTruthy();
    const item = (await screen.findByRole("button", { name: /^Load / })).closest("li")!;
    expect(item.textContent).toContain("123 tasks");
    expect(item.textContent).toContain("valid");
    expect(screen.getByRole("button", { name: "Choose a backup…" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(within(item).getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Day 1 is") as HTMLInputElement;
    const today = localToday(new Date());
    expect(input.value).toBe(nextWeekday(today));
    expect(weekday(input.value)).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    expect(input.value).toBe(today);
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Today." })).toBeTruthy();
    await screen.findByText(/^day 1 · week 1 of 17 · /);
  });

  it("an invalid file shows its issues and can't be picked", async () => {
    server.writePath("broken.yaml", "schemaVersion: 1\nid: Bad Id\n");
    renderApp("/");
    const bad = await screen.findByRole("button", { name: "broken.yaml is invalid" });
    expect(bad).toHaveProperty("disabled", true);
    const item = bad.closest("li")!;
    expect(within(item).getByRole("list", { name: "Problems" }).children.length).toBeGreaterThan(0);
  });

  it("an invalid upload shows its issues without creating anything", async () => {
    renderApp("/");
    const input = (await screen.findByText("Choose a .yaml file")).querySelector("input")!;
    const file = new File(["schemaVersion: 2\n"], "mine.yaml");
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/mine\.yaml has \d+ problems?/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a valid upload goes through the start-date dialog", async () => {
    renderApp("/");
    const input = (await screen.findByText("Choose a .yaml file")).querySelector("input")!;
    fireEvent.change(input, {
      target: { files: [new File([readFileSync(FIXTURE, "utf8")], "mine.yaml")] },
    });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("heading", { level: 1, name: TODAY_H1 })).toBeTruthy();
  });
});

describe("switcher and delete", () => {
  it("deleting the active Enrollment shows the switcher; deleting the last shows the empty state", async () => {
    renderApp("/");
    await startFixture("Today");
    // A second enrollment through "New enrollment".
    fireEvent.click(screen.getByRole("button", { name: /▾$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "New enrollment" }));
    await screen.findByRole("heading", { level: 1, name: "New enrollment." });
    await startFixture();

    // Menu: two enrollments, the active one with percent and streak.
    fireEvent.click(screen.getByRole("button", { name: /▾$/ }));
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getAllByRole("listitem")).toHaveLength(2));
    await within(menu).findByText(/0% · 0-day streak/);
    const active = within(menu)
      .getAllByRole("listitem")
      .find((li) => li.className.includes("active"))!;
    fireEvent.click(within(active).getByRole("button", { name: /^Delete / }));
    fireEvent.click(within(active).getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pick an enrollment." }),
    ).toBeTruthy();
    const rest = await screen.findAllByRole("listitem");
    const row = rest.find((li) => li.className.includes("enrollment"))!;
    expect(row.textContent).toContain(`from ${localToday(new Date())}`);

    fireEvent.click(within(row).getByRole("button", { name: /^Delete / }));
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pick a path." })).toBeTruthy();
  });

  it("picking an Enrollment from the switcher makes it active", async () => {
    renderApp("/");
    await startFixture("Today");
    fireEvent.click(screen.getByRole("button", { name: /▾$/ }));
    const menu = await screen.findByRole("menu");
    const row = (await within(menu).findAllByRole("listitem"))[0]!;
    fireEvent.click(within(row).getByRole("button", { name: /^Delete / }));
    fireEvent.click(within(row).getByRole("button", { name: "Keep" }));
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("app shell", () => {
  it.each([
    ["/today", TODAY_H1],
    ["/path", "Path"],
    ["/notes", "Notes"],
  ])(
    "%s shows its screen and marks the nav link once an Enrollment is active",
    async (url, title) => {
      renderApp("/");
      await startFixture();
      cleanup();
      renderApp(url);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      const link = typeof title === "string" ? title : "Today";
      expect(screen.getByRole("link", { name: link }).className).toContain("on");
    },
  );

  it("the toggle flips data-theme on <html>", async () => {
    document.documentElement.dataset.theme = "light";
    renderApp("/new");
    fireEvent.click(screen.getByRole("button", { name: /switch to dark/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /switch to light/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("nextWeekday", () => {
  it("is strictly after today", () => {
    expect(nextWeekday("2026-09-07")).toBe("2026-09-14"); // Monday → next Monday
    expect(nextWeekday("2026-09-13")).toBe("2026-09-14"); // Sunday
    expect(nextWeekday("2026-09-07", "wednesday")).toBe("2026-09-09");
    expect(weekday(addDays("2026-09-07", 0))).toBe(0);
  });
});
