import { downWipe, resetPaths, up } from "./docker.js";

/** A fresh volume and a fresh copy of the fixture, then build and start the container. */
export default function globalSetup() {
  downWipe();
  resetPaths();
  up();
  return () => downWipe(["--rmi", "local"]);
}
