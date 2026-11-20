# CLAUDE.md

Work on branch `kusch/whiteboard`. Build here the engine that the sibling `../KuszCanvas-Obsidian` plugin vendors; this repo forks zsviczian/excalidraw, which forks excalidraw.

## Module map

- `packages/excalidraw/` — editor React component, published by this repo as `@zsviczian/excalidraw`; `obsidian*.ts` holds the Obsidian host integration.
- `packages/element/` — element model, geometry, frames and the canvas renderer (`renderElement.ts`, `shape.ts`).
- `packages/common/`, `packages/math/`, `packages/utils/`, `packages/fractional-indexing/`, `packages/laser-pointer/` — shared helpers; `packages/common/src/commonObsidianHost.ts` is the render-side host contract.
- `excalidraw-app/` — web test harness, not excalidraw.com; see `excalidraw-app/CLAUDE.md`.
- `scripts/` — build scripts; `buildObsidianPackage.js` produces the consumer build.

## Naming and conventions

- Put new editor interaction code in an `App.<concern>.ts` file next to `App.tsx` and keep `App.tsx` to thin call sites.
- Put pure logic in `packages/element/src/<feature>.ts` with tests in `packages/element/tests/<feature>.test.ts`; keep timers, animation frames and scene mutation in the `App.*` file.
- Mark changes inside upstream files with a `KuszCanvas:` comment; `//zsviczian` marks the parent fork's changes. Keep both when merging upstream.
- Import internal packages by their `@excalidraw/*` name; `vitest.config.mts` and the tsconfigs alias them to source.
- Commit messages use `type(scope): summary` (e.g. `feat(stickynote): …`, `docs(claude): …`).
- Write LF line endings (`.gitattributes` sets `eol=lf`). Python and some Windows tools write CRLF by default; pass `newline="\n"` or convert back before finishing.

## Contracts with the consumer

- Renderer and host-adapter changes are an internal protocol with `../KuszCanvas-Obsidian`: bump the protocol version and update the consumer adapter in the same change. The consumer restates the number in three files listed in its `CLAUDE.md`.
- Tests that configure the common host use `OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION`, never a literal, so a bump only fails tests of the old contract.
- The consumer vendors `packages/excalidraw/dist/obsidian/` and `types/` with its `npm run vendor:excalidraw`, which refuses a dirty engine tree. Commit before vendoring; never copy artifacts by hand or publish to npm.
- New engine exports reach the consumer's types only after vendoring: expect `tsc` errors for them in the consumer until then, and never edit its vendored types.

## Cross-file invariants

- In blackboard mode a sticky note and its label keep light-theme colours (`isPaperRender` in `packages/element/src/blackboard.ts`). Anything new that paints or shows a note's colours must honour it, as the canvas renderer, SVG export, text editor and colour picker (`getColorSwatchTheme`) do.
- Take a new container label's alignment from `getDefaultBoundTextAlign` (sticky notes top-left, other containers centre-centre); typing, binding and `convertToExcalidrawElements` all use it.
- After any change to the blackboard shader's output (`packages/element/src/blackboardShader.ts`), render it, set `BLACKBOARD_BASE_COLOR` in `packages/element/src/blackboard.ts` to the measured mean colour, and retune `BLACKBOARD_SVG_TEXTURE` in `packages/excalidraw/renderer/chalkSvg.ts` to the same mean, so the canvas, PNG and SVG boards match. Tests only bound the colour loosely.

## Commands

- `yarn` is not on PATH: run everything as `corepack yarn …`.
- `corepack yarn test:typecheck` — TypeScript check.
- `corepack yarn vitest run <file>` — targeted tests. `corepack yarn test` starts watch mode and never exits.
- `corepack yarn build:obsidian` in `packages/excalidraw` — consumer build. Verify reproducibility on the production `.js`/`.css` only; the development bundle is not byte-reproducible.
- `corepack yarn fix` — format and lint fixes.
- ESLint's default formatter fails to load (`Cannot use import statement outside a module`), which hides lint results; lint specific files with `node_modules/.bin/eslint -f json <files>`.

## Avoid

- Never run `test:update` across the suite: about 1,500 tests fail at baseline (snapshot mismatches and `App` not mounting) and it would rewrite those snapshots. Update only snapshots you have inspected.
- Don't rely on App-mounting tests (`h.elements` is undefined at baseline); test pure functions, or drive the harness with Playwright.
- Regression check: compare sorted `FAIL` lines, not counts. Get the baseline from a clean worktree of HEAD outside the repo (`git worktree add --detach ../KuszCanvas-baseline HEAD`, then `corepack yarn install --frozen-lockfile --prefer-offline`), not `git stash`, which destroys work when other agents share the tree. Strip ANSI, `grep '^ FAIL '`, strip trailing `NNNms`, and sort both lists with `LC_ALL=C sort -u` before `comm`.
- Flaky: `interactivity.test.tsx > programmatic viewport API still works` and the two `hostAbstraction.test.tsx > headless (server-side) export` tests, `scrollConstraints.test.tsx > clears both active and pending locks with setViewport(null)`, and the two `MermaidToExcalidrawLib.test.ts > host-provided Mermaid loading` tests when run alongside other component tests (rerun them alone).
- When several agents share the working tree: no `git stash`/`reset`/`checkout --`/`clean`, one full-suite run at a time, and claim shared `App.tsx` regions in a coordination log under `.tmp/` before editing. Timestamp log entries with plain `date`: Git Bash has no zoneinfo, so `TZ=Australia/Sydney date` prints UTC.
- Quote every path in shell commands, including `$(pwd)` and `$(basename …)`: the repo path contains a space (`Python scripts`).
- Scratch files go in `.tmp/` (ignored), but never name one `*.test.ts(x)`: vitest has no exclude for `.tmp/` and the full suite would run it.
- Don't create render-path canvas contexts with `willReadFrequently`: drawing a CPU-backed canvas onto a GPU canvas uploads it on every draw (it made blackboard freehand lag 4×). Read pixels back only on a separate canvas, off the per-frame path.
- `vitest-canvas-mock` canvas methods (`getContext` etc.) are already spies: `vi.spyOn` returns the same spy and a wrapper calling the original recurses. Patch the prototype by hand and restore it in `afterAll`.
- To find where interaction time goes, profile instead of guessing: see the lag probe in `excalidraw-app/CLAUDE.md`.
