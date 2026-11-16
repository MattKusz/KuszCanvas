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
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
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
- Keep the tree clean before vendoring: the consumer's vendor script refuses uncommitted changes. Scratch files go in `.tmp/` (locally excluded via `.git/info/exclude`).
- Renderer and host-adapter changes are an internal protocol with the consumer: bump the protocol version and update the consumer adapter in the same checkpoint.
- The development bundle (`excalidraw.development.js`) is not byte-reproducible against the published package; verify reproducibility on the production `.js`/`.css` only.
