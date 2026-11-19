# CLAUDE.md

KuszCanvas is a fork of zsviczian/excalidraw (itself a fork of excalidraw) that builds the engine for the sibling `../KuszCanvas-Obsidian` plugin. Work on branch `kusch/whiteboard`.

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

## Commands

- `yarn` is not on PATH: run everything as `corepack yarn …`.
- `corepack yarn test:typecheck` — TypeScript check.
- `corepack yarn vitest run <file>` — targeted tests. `corepack yarn test` starts watch mode and never exits.
- `corepack yarn build:obsidian` in `packages/excalidraw` — consumer build. Verify reproducibility on the production `.js`/`.css` only; the development bundle is not byte-reproducible.
- `corepack yarn fix` — format and lint fixes.
- ESLint's default formatter fails to load (`Cannot use import statement outside a module`), which hides lint results; lint specific files with `node_modules/.bin/eslint -f json <files>`.
- Tell Matt to run `corepack yarn start` for the web harness (details in `excalidraw-app/CLAUDE.md`).

## Avoid

- Never run `test:update` across the suite: about 1,500 tests fail at baseline (snapshot mismatches and `App` not mounting) and it would rewrite those snapshots. Update only snapshots you have inspected.
- Don't rely on App-mounting tests (`h.elements` is undefined at baseline); test pure functions, or drive the harness with Playwright.
- Regression check: compare sorted `FAIL` lines, not counts. Get the baseline from a clean worktree of HEAD outside the repo (`git worktree add --detach ../KuszCanvas-baseline HEAD`, then `corepack yarn install --frozen-lockfile --prefer-offline`), not `git stash`, which destroys work when other agents share the tree. Strip ANSI, `grep '^ FAIL '`, strip trailing `NNNms`, and sort both lists with `LC_ALL=C sort -u` before `comm`.
- Flaky: `interactivity.test.tsx > programmatic viewport API still works` and the two `hostAbstraction.test.tsx > headless (server-side) export` tests, and `scrollConstraints.test.tsx > clears both active and pending locks with setViewport(null)`.
- When several agents share the working tree: no `git stash`/`reset`/`checkout --`/`clean`, one full-suite run at a time, and claim shared `App.tsx` regions in a coordination log under `.tmp/` before editing.
- Scratch files go in `.tmp/` (ignored).
