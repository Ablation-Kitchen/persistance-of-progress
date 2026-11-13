import { rmSync } from "node:fs";
import { TMP, downWipe, resetPaths, up } from "./docker.js";

/** A fresh volume and a fresh copy of the fixture, then build and start the container. */
export default function globalSetup() {
  downWipe();
  resetPaths();
  const teardown = () => {
    downWipe(["--rmi", "local"]);
    rmSync(TMP, { recursive: true, force: true }); // the fixture copy and the downloaded backup
  };
  try {
    up();
  } catch (e) {
    // Playwright only runs the returned teardown after setup succeeds.
    teardown();
    throw e;
  }
  return teardown;
}
