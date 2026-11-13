// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { Snapshot } from "@learning-tracker/core";
import { api } from "../api";
import { startServer, type TestServer } from "../test/server";
import { renderApp } from "../test/render";

let server: TestServer;
let id: string;

beforeEach(async () => {
  server = await startServer();
  id = (
    await api<Snapshot>("POST", "/api/enrollments", {
      source: { file: "eval-infra-17-weeks.yaml" },
      startDate: "2026-09-07",
    })
  ).id;
  await api("PUT", `/api/enrollments/${id}/notes/${encodeURIComponent("day:2026-09-08")}`, {
    body: "# First day\n\nSet up the repo.",
    editedOn: "2026-09-08",
  });
});

afterEach(async () => {
  cleanup();
  await server.close();
});

describe("Notes export", () => {
  it("the Export link downloads the Markdown for the browser's today", async () => {
    renderApp("/notes?today=2026-09-30");
    const link = (await screen.findByRole("link", { name: "Export .md" })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/api/enrollments/${id}/notes-export?today=2026-09-30`);
    expect(link.getAttribute("download")).toBe(
      "eval-infra-17-weeks_2026-09-07_notes_2026-09-30.md",
    );

    const res = await fetch(link.getAttribute("href")!);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^# 17-Week Plan: Eval Infrastructure Engineer — notes\n/);
    expect(text).toContain("#### Tue 2026-09-08 · day 2\n\n##### First day\n\nSet up the repo.");
  });
});
