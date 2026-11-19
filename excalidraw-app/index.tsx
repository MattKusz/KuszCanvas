import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";
// the Obsidian bundle loads these via obsidianEntry.ts; tray mode (the default
// without an Obsidian host) depends on them for its layout
import "../packages/excalidraw/css/obsidianStylingOverrides.css";

import ExcalidrawApp from "./App";
import { installHarnessHosts } from "./harnessHost";

// the entry's JavaScript and CSS loaded and ran (`scripts/stats/perf.mjs`)
performance.mark("excalidraw:app-start");

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
// TEST HARNESS ONLY: a stub Obsidian host so text/hyperlink editing and
// Mermaid work in the browser; `?blackboard=1&markdown=1` turns on the
// render flags. Installed once, before the editor mounts. See harnessHost.ts.
installHarnessHosts(window.location.search);

const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
// No StrictMode: its dev mount-unmount-remount hits the zsviczian
// componentWillUnmount teardown, which nulls actionManager.app/library/store,
// so the second mount crashes and the page renders blank
void StrictMode;
root.render(<ExcalidrawApp />);
