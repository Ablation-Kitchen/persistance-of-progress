export type Theme = "light" | "dark";

const KEY = "theme";

/** The theme in force: an explicit choice on <html>, else the OS preference. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const set = root.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}
