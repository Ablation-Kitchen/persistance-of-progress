/**
 * Ticket 16 acceptance: the 17-week walkthrough against the composed container, with the
 * browser clock fixed through Playwright's clock API (the production build has no `?today=`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TMP, downWipe, removeTaskFromFixture, up } from "./docker.js";

const at = (date: string) => new Date(`${date}T09:00:00Z`);
const START = "2026-09-07"; // the Monday after the first-run date
const WEEK4 = "2026-09-30"; // day 24

async function setToday(page: Page, date: string) {
  await page.clock.setFixedTime(at(date));
}

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const statValue = (page: Page, label: string) =>
  page
    .locator(".stats div")
    .filter({ has: page.locator("dt", { hasText: label }) })
    .locator("dd");
const taskIds = (col: Locator) =>
  col
    .locator("article[data-task]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-task")));

async function openMenu(page: Page) {
  await page.getByRole("button", { name: /▾$/ }).click();
  return page.getByRole("menu");
}

/**
 * The visible text of a screen, for before/after comparisons: everything except the toast slot,
 * so the header (active Enrollment) and the reload banner are compared too.
 */
async function screenText(page: Page, url: string, h1: string | RegExp) {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return page.evaluate(() => {
    const root = document.getElementById("root")!.cloneNode(true) as HTMLElement;
    root.querySelector(".toast-slot")?.remove();
    document.body.append(root); // innerText needs the clone laid out
    const text = root.innerText;
    root.remove();
    return text;
  });
}

test("the 17-week walkthrough", async ({ page }) => {
  const consoleErrors: string[] = [];
  // Set only while a step provokes API errors on purpose; the browser logs those loads too.
  let expectingApiErrors = false;
  const apiErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (expectingApiErrors && m.text().startsWith("Failed to load resource")) return;
    consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (!expectingApiErrors && r.url().includes("/api/") && r.status() >= 400) {
      apiErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });

  let removed = { id: "", title: "" };
  const noteText = "First session done: tokenizer and attention notes.";

  await test.step("first run: load the fixture, start next Monday → Almost ready", async () => {
    await setToday(page, "2026-09-02"); // a Wednesday
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Pick a path." })).toBeVisible();
    await page.getByRole("button", { name: /^Load / }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Day 1 is")).toHaveValue(START);
    await dialog.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Almost ready." })).toBeVisible();
    await expect(page.getByText(/^starts mon 7 sep · in 5 days$/)).toBeVisible();
  });

  await test.step("day 1: tick two Tasks and write a Day Note → streak 1", async () => {
    await setToday(page, START);
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today." })).toBeVisible();
    const today = region(page, "Today");
    await expect(today.locator("article[data-task]").first()).toBeVisible();
    const ids = (await taskIds(today)) as string[];
    const tick = async (col: Locator, id: string) => {
      const check = col.locator(`article[data-task="${id}"] .check`);
      await check.click();
      await expect(check).toHaveAttribute("aria-pressed", "true");
    };
    // Day 1 has one Task; the second tick is day 2's, ticked early from the strip.
    await tick(today, ids[0]!);
    await page
      .getByRole("group", { name: "Week 1" })
      .getByRole("button", { name: /^tue 8 sep/ })
      .click();
    const day2 = region(page, "Tue 8 sep");
    await expect(day2.getByText(/· ahead$/)).toBeVisible();
    await tick(day2, ((await taskIds(day2)) as string[])[0]!);
    await day2.getByRole("button", { name: "← back to today" }).click();

    // A Task Note on the first ticked Task: it is removed from the path later on.
    removed = {
      id: ids[0]!,
      title: (await today.locator(`article[data-task="${ids[0]}"] .title-btn`).innerText()).trim(),
    };
    await today.locator(`article[data-task="${removed.id}"] .title-btn`).click();
    const taskNote = region(page, "Task note");
    await taskNote.getByRole("textbox").fill(noteText);
    await expect(taskNote.getByText(/^saved$/)).toBeVisible();

    const dayNote = region(page, "Day note");
    await dayNote.getByRole("textbox").fill("Day 1. Environment set up, first reading done.");
    await expect(dayNote.getByText(/^saved$/)).toBeVisible();
    await expect(statValue(page, "day streak")).toHaveText("1");
  });

  await test.step("week 4: Catch up lists overdue; +2 shift; one marker on Path", async () => {
    await setToday(page, WEEK4);
    await page.goto("/today");
    await expect(page.getByText(/^day 24 · week 4 of 17 · /)).toBeVisible();
    const catchUp = region(page, "Catch up");
    const before = await catchUp.locator("article[data-task]").evaluateAll((els) =>
      els.map((e) => ({
        id: e.getAttribute("data-task")!,
        overdue: /(\d+)d overdue/.exec(e.textContent ?? "")?.[1] ?? null,
      })),
    );
    // A card whose overdue count can't be read would make the expectations below vacuous.
    expect(before.filter((t) => t.overdue === null)).toEqual([]);
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((t) => Number(t.overdue) <= 2)).toBe(true);

    const control = catchUp.getByRole("group", { name: "Schedule shift" });
    await control.getByLabel("shift open tasks by").fill("2");
    await control.getByRole("button", { name: "Shift…" }).click();
    await control.getByRole("button", { name: /^Move \d+ tasks$/ }).click();
    await expect(catchUp.getByRole("button", { name: "Undo +2d" })).toBeVisible();
    // Tasks that were at most 2 days overdue are back inside their windows.
    await expect
      .poll(() => taskIds(catchUp))
      .toEqual(before.filter((t) => Number(t.overdue) > 2).map((t) => t.id));

    await page.goto("/path");
    await expect(page.getByRole("heading", { level: 1, name: "The path." })).toBeVisible();
    // Week 4 straddles Blocks 1 and 2; the marker sits in exactly one of them.
    await page.getByRole("button", { name: "expand all" }).click();
    await expect(page.getByText(/^shifted \+2d on wed 30 sep/)).toHaveCount(1);
  });

  await test.step("story bank: the template shows; after typing the Note is from template", async () => {
    await page.goto("/notes?note=task:story-bank");
    const drawer = page.getByRole("dialog");
    const box = drawer.getByRole("textbox");
    await expect(box).not.toHaveValue("");
    const template = await box.inputValue();
    expect(template).toContain("|");
    await expect(drawer.getByText("from template")).toHaveCount(0);
    await box.press("End");
    await box.pressSequentially(" Led the eval rewrite.");
    await expect(drawer.getByText(/^saved$/)).toBeVisible();
    await expect(drawer.getByText(/from template/).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  await test.step("reload: remove a done Task with a Note → banner → preview → apply", async () => {
    removeTaskFromFixture(removed.id);
    await page.goto("/today");
    await expect(page.getByText("The path file has changed")).toBeVisible({ timeout: 70_000 });
    await page.getByRole("button", { name: "Review reload" }).click();
    const dialog = page.getByRole("dialog", { name: "Review reload" });
    await expect(
      dialog.getByRole("region", { name: "Removed", exact: true }).getByText(removed.title),
    ).toBeVisible();
    await expect(dialog.getByText(/1 removed task will be kept hidden/)).toBeVisible();
    await dialog.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText("Path reloaded")).toBeVisible();
    await expect(page.getByText("The path file has changed")).toHaveCount(0);

    await page.goto("/notes?block=removed");
    await expect(page.getByRole("heading", { level: 1, name: "Notes, by block." })).toBeVisible();
    await expect(page.getByText(removed.title).first()).toBeVisible();
    await expect(page.getByText(noteText).first()).toBeVisible();
  });

  await test.step("export Notes: expected filename, Block → week → day outline", async () => {
    await page.goto("/notes");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: /Export/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`eval-infra-17-weeks_${START}_notes_${WEEK4}.md`);
    const md = readFileSync((await file.path())!, "utf8");
    const headings = md.split("\n").filter((l) => /^#{1,4} /.test(l));
    expect(headings[0]).toMatch(/^# .+ — notes$/);
    expect(md).toMatch(/^## Block 1 · /m);
    expect(md).toMatch(/^### Week 1 · 2026-09-07 – 2026-09-13$/m);
    expect(md).toMatch(/^#### Mon 2026-09-07 · day 1$/m);
    expect(md).toContain("Environment set up, first reading done.");
    // Every week sits under a Block, every day under a week, in that order.
    let level = 1;
    for (const h of headings.slice(1)) {
      const n = h.indexOf(" ");
      if (h.startsWith("## Removed tasks")) break;
      expect(n, h).toBeLessThanOrEqual(level + 1);
      level = n;
    }
  });

  await test.step("backup → down -v → up → restore: every screen matches", async () => {
    const screens = [
      ["/today", "Today."],
      ["/path", "The path."],
      ["/notes", "Notes, by block."],
      ["/notes?block=removed", "Notes, by block."],
    ] as const;
    const before: string[] = [];
    for (const [url, h1] of screens) before.push(await screenText(page, url, h1));

    const menu = await openMenu(page);
    const download = page.waitForEvent("download");
    await menu.getByRole("button", { name: "Download backup" }).click();
    const backup = await download;
    expect(backup.suggestedFilename()).toBe(`learning-tracker-backup_${WEEK4}.json`);
    const backupFile = path.join(TMP, backup.suggestedFilename());
    await backup.saveAs(backupFile);

    // Leave the app before the server goes away, so no request fails mid-wipe.
    await page.goto("about:blank");
    downWipe();
    up();

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Pick a path." })).toBeVisible();
    await page.getByLabel("Choose a backup…").setInputFiles(backupFile);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "In the backup" })).toBeVisible();
    await dialog.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Backup restored")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Today." })).toBeVisible();

    for (const [i, [url, h1]] of screens.entries()) {
      expect(await screenText(page, url, h1), url).toBe(before[i]);
    }
  });

  await test.step("API errors: the server's message in a dialog; a failed save → toast", async () => {
    expectingApiErrors = true;
    // A real 422 from the server: a file that isn't a backup.
    const preview = page.waitForResponse((r) => r.url().endsWith("/api/restore/preview"));
    const menu = await openMenu(page);
    await menu.getByLabel("Restore…").setInputFiles({
      name: "not-a-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });
    const res = await preview;
    expect(res.status()).toBe(422); // backup-invalid
    const { message } = ((await res.json()) as { error: { message: string } }).error;
    expect(message).toBeTruthy();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText(message);
    await dialog.getByRole("button", { name: "Close" }).click();

    // A failed optimistic tick (the server is made to fail it) rolls back and shows a toast.
    await page.goto("/today");
    const today = region(page, "Today");
    await expect(today.locator("article[data-task]").first()).toBeVisible();
    const [id] = (await taskIds(today)) as string[];
    // Pinned by id: ticking can reorder the cards, so `.first()` could move to another Task.
    const check = today.locator(`article[data-task="${id}"] .check`);
    const was = await check.getAttribute("aria-pressed");
    await page.route("**/api/enrollments/*/tasks/*/state", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "internal", message: "injected failure" } }),
      }),
    );
    await check.click();
    await expect(page.getByRole("status")).toContainText("Couldn't save, try again");
    await expect(check).toHaveAttribute("aria-pressed", was!);
    await page.unroute("**/api/enrollments/*/tasks/*/state");
    expectingApiErrors = false;
  });

  await test.step("throughout: no console errors and no failed API calls", async () => {
    expect(consoleErrors).toEqual([]);
    expect(apiErrors).toEqual([]);
  });
});
