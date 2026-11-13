// @vitest-environment jsdom
/** Ticket 08 acceptance: Note routes through the UI, the editor, autosave and the drawer. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { NoteBody, Snapshot, TaskStateResponse } from "@learning-tracker/core";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";
import { ToastProvider } from "../toast";
import { NoteDrawer } from "./Drawer";
import { NoteView } from "./NoteView";

const START = "2026-09-07";
const STORY_DAY = "2026-12-21"; // day 106: "Fill in the story bank" (has a noteTemplate)

let server: TestServer;
let id: string;
let calls: { url: string; init: RequestInit | undefined }[];

beforeEach(async () => {
  server = await startServer();
  id = (
    await api<Snapshot>("POST", "/api/enrollments", {
      source: { file: "eval-infra-17-weeks.yaml" },
      startDate: START,
    })
  ).id;
  calls = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return inner(input, init);
  };
});

afterEach(async () => {
  cleanup();
  await server.close();
});

const puts = () => calls.filter((c) => c.init?.method === "PUT" && c.url.includes("/notes/"));
const getSnapshot = () => api<Snapshot>("GET", `/api/enrollments/${id}`);
const getNotes = () => api<NoteBody[]>("GET", `/api/enrollments/${id}/notes`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stat = (label: string) =>
  [...document.querySelectorAll(".stats div")]
    .find((d) => d.querySelector("dt")?.textContent === label)
    ?.querySelector("dd")?.textContent;

async function openToday(url: string) {
  renderApp(url);
  await waitFor(() => expect(document.querySelector(".today-hero .stats")).not.toBeNull());
}
const section = (name: string) => screen.getByRole("region", { name });
const textareaIn = async (name: string) =>
  (await within(section(name)).findByRole("textbox")) as HTMLTextAreaElement;

describe("Task Note from a template", () => {
  it("shows the template, stores nothing until the first keystroke, then saves fromTemplate", async () => {
    const template = (await getSnapshot()).path.blocks
      .flatMap((b) => b.tasks)
      .find((t) => t.id === "story-bank")!.noteTemplate!;
    await openToday(`/today?today=${STORY_DAY}`);
    fireEvent.click(screen.getByRole("button", { name: "Fill in the story bank" }));
    const box = await textareaIn("Task note");
    expect(box.value).toBe(template);

    await sleep(1000);
    expect(puts()).toHaveLength(0);
    expect((await getSnapshot()).noteMeta).toEqual([]);
    expect(stat("day streak")).toBe("0");

    fireEvent.change(box, { target: { value: `${template}\nfirst line` } });
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 3000 });
    await waitFor(async () =>
      expect((await getSnapshot()).noteMeta).toEqual([
        expect.objectContaining({
          target: "task:story-bank",
          fromTemplate: true,
          editedOn: [STORY_DAY],
        }),
      ]),
    );
    await waitFor(() => expect(stat("day streak")).toBe("1"));
    expect(await within(section("Task note")).findByText(/^saved$/)).toBeTruthy();

    fireEvent.click(within(section("Task note")).getByRole("button", { name: "Preview" }));
    const table = within(section("Task note")).getByRole("table");
    expect(within(table).getByText("Posting bullet")).toBeTruthy();
  });
});

describe("autosave", () => {
  it("a burst of typing sends one PUT with the last text", async () => {
    await openToday(`/today?today=2026-09-30`);
    const box = await textareaIn("Day note");
    for (let i = 1; i <= 10; i++) fireEvent.change(box, { target: { value: "x".repeat(i) } });
    await sleep(1200);
    expect(puts()).toHaveLength(1);
    expect(JSON.parse(String(puts()[0]!.init!.body))).toMatchObject({
      body: "xxxxxxxxxx",
      editedOn: "2026-09-30",
    });
    expect(puts()[0]!.url).toContain(encodeURIComponent("day:2026-09-30"));
  });

  it("typing continuously sends at most one PUT per ~800 ms", async () => {
    await openToday(`/today?today=2026-09-30`);
    const box = await textareaIn("Day note");
    const started = Date.now();
    for (let i = 1; i <= 16; i++) {
      fireEvent.change(box, { target: { value: "y".repeat(i) } });
      await sleep(150);
    }
    const typing = Date.now() - started;
    expect(puts().length).toBeLessThanOrEqual(Math.ceil(typing / 800));
    await sleep(1000);
    expect(puts().length).toBeGreaterThanOrEqual(1);
    await waitFor(async () =>
      expect(await getNotes()).toEqual([{ target: "day:2026-09-30", body: "y".repeat(16) }]),
    );
  });

  it.each([
    ["pagehide", () => window.dispatchEvent(new Event("pagehide"))],
    [
      "visibilitychange",
      () => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      },
    ],
  ])("%s flushes at once with keepalive", async (_name, hide) => {
    await openToday(`/today?today=2026-09-30`);
    const box = await textareaIn("Day note");
    fireEvent.change(box, { target: { value: "closing the tab" } });
    expect(puts()).toHaveLength(0);
    hide();
    vi.restoreAllMocks();
    expect(puts()).toHaveLength(1);
    expect(puts()[0]!.init!.keepalive).toBe(true);
    await waitFor(async () =>
      expect(await getNotes()).toEqual([{ target: "day:2026-09-30", body: "closing the tab" }]),
    );
  });

  it("blur flushes at once", async () => {
    await openToday(`/today?today=2026-09-30`);
    const box = await textareaIn("Day note");
    fireEvent.change(box, { target: { value: "blurred" } });
    fireEvent.blur(box);
    expect(puts()).toHaveLength(1);
  });
});

describe("edit-date trail and streak", () => {
  it("editing on two dates gives a trail of two; twice on one date gives one", async () => {
    await openToday(`/today?today=2026-09-29`);
    let box = await textareaIn("Day note");
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: "ab" } });
    fireEvent.blur(box);
    await waitFor(async () =>
      expect((await getSnapshot()).noteMeta[0]?.editedOn).toEqual(["2026-09-29"]),
    );
    cleanup();

    // Next day, the same Day Note through ?day=.
    await openToday(`/today?today=2026-09-30&day=2026-09-29`);
    box = await textareaIn("Day note");
    expect(box.value).toBe("ab");
    fireEvent.change(box, { target: { value: "abc" } });
    fireEvent.blur(box);
    await waitFor(async () =>
      expect((await getSnapshot()).noteMeta[0]?.editedOn).toEqual(["2026-09-29", "2026-09-30"]),
    );
    expect(
      await within(section("Day note")).findByText("edited on tue 29 sep, wed 30 sep"),
    ).toBeTruthy();
  });

  it("a Note edited on a day with no ticks keeps the streak going", async () => {
    await api<TaskStateResponse>("PUT", `/api/enrollments/${id}/tasks/intro-to-llms/state`, {
      status: "done",
      statusDate: "2026-09-29",
    });
    await openToday(`/today?today=2026-09-30`);
    expect(stat("day streak")).toBe("1");
    const box = await textareaIn("Day note");
    fireEvent.change(box, { target: { value: "no ticks today, but notes" } });
    fireEvent.blur(box);
    await waitFor(() => expect(stat("day streak")).toBe("2"));
  });
});

describe("<NoteView>", () => {
  it("shows raw HTML as text, renders GFM, and opens links in a new tab", () => {
    const { container } = render(
      <NoteView
        body={
          "<script>alert(1)</script>\n\nhi <b>bold</b>\n\n- [x] done\n- [ ] open\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nhttps://example.com"
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<b>bold</b>");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.querySelector("table")).not.toBeNull();
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("drawer", () => {
  function renderDrawer(snapshot: Snapshot, target: string, onClose: () => void) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["enrollment", snapshot.id], snapshot);
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/notes?today=2026-09-30"]}>
          <ToastProvider>
            <NoteDrawer snapshot={snapshot} target={target} onClose={onClose} />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("shows the context and prompt; Esc and the backdrop close it; closing saves at once", async () => {
    const snapshot = await getSnapshot();
    const onClose = vi.fn();
    const { unmount } = renderDrawer(snapshot, "task:intro-to-llms", onClose);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/^material · day 1 · overdue$/)).toBeTruthy();
    const box = (await within(dialog).findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "drawer text" } });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);

    unmount(); // the parent closing the drawer
    expect(puts()).toHaveLength(1);
    await waitFor(async () =>
      expect(await getNotes()).toEqual([{ target: "task:intro-to-llms", body: "drawer text" }]),
    );
  });

  it("works for a removed Task's Note, and Delete sits behind a confirmation", async () => {
    await api("PUT", `/api/enrollments/${id}/notes/enrollment`, {
      body: "about the run",
      editedOn: "2026-09-30",
    });
    const snapshot = await getSnapshot();
    renderDrawer(snapshot, "enrollment", () => {});
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "About this run" })).toBeTruthy();
    expect(((await within(dialog).findByRole("textbox")) as HTMLTextAreaElement).value).toBe(
      "about the run",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }));
    expect(await getNotes()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect(await getNotes()).toEqual([]));
    expect(((await within(dialog).findByRole("textbox")) as HTMLTextAreaElement).value).toBe("");
  });
});
