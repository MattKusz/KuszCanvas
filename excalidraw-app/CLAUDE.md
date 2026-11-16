# excalidraw-app (KuszCanvas web test harness)

- Use this app to check engine rendering without vendoring into Obsidian. Tell the user to run `corepack yarn start` from the repo root; it serves on http://localhost:3001 (`VITE_APP_PORT` in the root `.env.development`), not 3000.
- Without an Obsidian host the engine defaults to tray UI mode, the same default as KuszCanvas-Obsidian. In tray mode the main menu sits bottom-left with the palette and undo/redo; do not move it or restructure tray components to match upstream's full-mode layout.
- Text and hyperlink editing throw `Obsidian Excalidraw host is not configured` here, because they call the host's inline link suggester. Test label and text editing in Obsidian, not in this app.
- To drive the app headless, run Node with the repo's `playwright` package and pass `executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"`; Playwright's bundled Chromium for this version is not installed. Save probe scripts and screenshots in `.tmp/`.
