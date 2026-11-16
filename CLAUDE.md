# CLAUDE.md

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** - Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** - Full-featured web application (excalidraw.com) that uses the library
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`
- **`examples/`** - Integration examples (NextJS, browser script)

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-app/` for app-specific features
3. **Testing**: Run the tests you touched before committing. On this fork, do not run `test:update` across the whole suite; see the KuszCanvas section below
4. **Type Safety**: Use `corepack yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
corepack yarn test:typecheck          # TypeScript type checking
corepack yarn vitest run <file>       # Run targeted tests
corepack yarn fix                     # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration

## KuszCanvas fork (Obsidian consumer)

- Work on branch `kusch/whiteboard`. The consumer is the sibling `../KuszCanvas-Obsidian` repo; it vendors this repo's `packages/excalidraw/dist/obsidian/` output and `types/` through its `npm run vendor:excalidraw`. Do not publish to npm or copy artifacts by hand.
- `yarn` is not on PATH on this machine; run it as `corepack yarn …` (e.g. `corepack yarn build:obsidian` in `packages/excalidraw`).
- Keep the tree clean before vendoring: the consumer's vendor script refuses uncommitted changes. Scratch files go in `.tmp/` (ignored by `.gitignore`).
- Renderer and host-adapter changes are an internal protocol with the consumer: bump the protocol version and update the consumer adapter in the same checkpoint.
- The development bundle (`excalidraw.development.js`) is not byte-reproducible against the published package; verify reproducibility on the production `.js`/`.css` only.
- Run the full suite with `corepack yarn vitest run`; `corepack yarn test` starts watch mode and never exits. The full suite has about 1,500 pre-existing failures (snapshot mismatches and `App` not mounting). Do not run `test:update` across it, as that rewrites those snapshots. To check for regressions, run the suite with your changes stashed (`git stash push -u`), then with them, and diff the sorted `FAIL` lines; do not compare counts alone. `interactivity.test.tsx > programmatic viewport API still works` is flaky.
- Tests that configure the common host must use `OBSIDIAN_COMMON_HOST_PROTOCOL_VERSION`, not a literal, so a protocol bump only fails tests that exercise the old contract. The consumer restates the number in three files listed in its `CLAUDE.md`.
