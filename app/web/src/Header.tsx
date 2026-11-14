import { NavLink } from "react-router";
import { SwitcherMenu } from "./enroll/Switcher";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { to: "/today", label: "Today" },
  { to: "/path", label: "Path" },
  { to: "/notes", label: "Notes" },
];

export function Header() {
  return (
    <header>
      <nav className="wrap" aria-label="Main">
        <span className="brand">
          <span className="dot" aria-hidden="true" />
          learning<b>/</b>tracker
        </span>
        <div className="navlinks">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `navlink${isActive ? " on" : ""}`}
            >
              <span>{l.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="navtools">
          <SwitcherMenu />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
