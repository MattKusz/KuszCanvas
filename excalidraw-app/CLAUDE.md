# excalidraw-app (KuszCanvas web test harness)

- Use this app to check engine behaviour without vendoring into Obsidian. Tell Matt to run `corepack yarn start` from the repo root; it serves on http://localhost:3001 (`VITE_APP_PORT` in the root `.env.development`), not 3000. Vite reloads engine source changes live.
- Matt's server usually runs on 3001: never stop it. For your own probes start a second server from `excalidraw-app/` with `corepack yarn vite --port <other port>` and stop it when done.
- Drive the app headless with the repo's `playwright` package and `executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"`; Playwright's bundled Chromium is not installed. Save probe scripts and screenshots in `.tmp/`.
- Without an Obsidian host the engine runs in tray UI mode, as in KuszCanvas-Obsidian: the main menu sits bottom-left with the palette and undo/redo. Don't move it or restructure tray components to match upstream's full-mode layout.
- `harnessHost.ts` is a test-only stub host; never import it outside this app. It has no `[[` link suggestions, vault fonts, or LaTeX/file/card/Lucide/SVG-import actions; test those in Obsidian.
- Turn on render flags with the URL query `?blackboard=1&markdown=1`.
