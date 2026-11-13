import { useState } from "react";
import { applyTheme, currentTheme, nextTheme } from "./theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const target = nextTheme(theme);
  return (
    <button
      type="button"
      className="pill sm"
      aria-label={`Switch to ${target} theme`}
      onClick={() => {
        applyTheme(target);
        setTheme(target);
      }}
    >
      <span className="mono">{theme === "dark" ? "dark" : "light"}</span>
    </button>
  );
}
