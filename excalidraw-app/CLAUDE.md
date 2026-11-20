# excalidraw-app (KuszCanvas web test harness)

- Use this app to check engine behaviour without vendoring into Obsidian. Tell Matt to run `corepack yarn start` from the repo root; it serves on http://localhost:3001 (`VITE_APP_PORT` in the root `.env.development`), not 3000. Vite reloads engine source changes live.
- Matt's server usually runs on 3001: never stop it. For your own probes start a second server from `excalidraw-app/` with `corepack yarn vite --port <other port>` and stop it when done. Stopping the background shell leaves Vite's `node.exe` listening: check the port with `netstat -ano`, confirm the PID's command line is your `vite.js --port <other port>`, and stop that PID.
- Drive the app headless with the repo's `playwright` package and `executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"`; Playwright's bundled Chromium is not installed. Save probe scripts and screenshots in `.tmp/`.
- Without an Obsidian host the engine runs in tray UI mode, as in KuszCanvas-Obsidian: the main menu sits bottom-left with the palette and undo/redo. Don't move it or restructure tray components to match upstream's full-mode layout.
- Tell Matt to switch render flags with the main-menu Blackboard mode / Render Markdown switches, or start with them on by URL query `?blackboard=1&markdown=1`; set the Markdown tag colour with `&accent=e83e8c`.
- To probe exports, import `/@fs/<repo root>/packages/excalidraw/obsidianExport.ts` inside `page.evaluate` and call `exportToCanvas`/`exportToSvg`.
- Wait about 300 ms after a click before a screenshot: switches and menus animate, and an early shot shows the old state.
