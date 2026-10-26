# Dart-Code VS Code Extension Agent Guide

This document provides an overview of the Dart-Code VS Code extension project for AI assistants.

## Project Overview

This project is the source code for the **Dart** and **Flutter** Visual Studio Code extensions, which provides rich support for the [Dart](https://dart.dev) and [Flutter](https://flutter.dev) frameworks.

The extension is written in **TypeScript** and interacts with the Dart SDK and Flutter SDK tools to provide features to the user.

The owner and repository name are both **Dart-Code** with the repository hosted at `https://github.com/Dart-Code/Dart-Code/`. These values should be used when interacting with GitHub unless another repository is specifically given.


## Project Structure

- `src/extension/`: Contains the main extension logic.
- `src/extension/extension.ts`: The main entry point to the extension (`activate()`).
- `src/debug/`: Legacy debug adapters that should not be modified. DAP debug adapters now live inside the Dart and Flutter SDKs.
- `src/shared/`: Contains code that may be shared between the extension code, legacy debug adapters and tests. Any code that uses the VS Code APIs must be inside a `vscode` sub-folder.
- `src/test/`: Contains automated tests for the extension, shared into tests for different areas.
- `src/test/test_projects/`: Sample Dart/Flutter projects that are used by the automated tests.
- `out/`: Compiled TypeScript output that should not be examined or modified.


## Rules

### General Project Rules

- All code must be cross-platform, working on Windows, macOS and Linux. This means using things like `path.join()` and taking care when spawning processes.
- Never access `.fsPath` (on `Uri`) or `.fileName` (on `TextDocument`) directly (enforced by lints). Always use the `fsPath()` helper in `src/shared/utils/fs.ts` (for example `fsPath(uri)` or `fsPath(doc.uri)`), which normalizes Windows drive letters and path casing.
- Code in `src/extension/` and `src/debug/` must not be imported outside of their respective folders (enforced by lints).
- Code in `src/shared/` must not contain global/singleton state or classes checked with `instanceof`, because `src/extension/` is bundled with Webpack (`out/dist/`) while tests run unpacked (`out/src/`), which would duplicate definitions and state during test runs.
- All extension settings use the format `dart.*` or `dart.flutter*` and are accessed through a wrapper in `src/extension/config.ts`.

### Code Style

- Indent with tabs.
- Use double quotes for strings.
- No trailing spaces.
- Include full stops on comment sentences.
- Avoid braces for simple one-line if/else blocks.


## Components

- **LSP**: The Language Server Protocol. A lot of language functionality is provided by an LSP server that lives in the Dart SDK.
- **DAP**: The Debug Adapter Protocol. Debugging functionality is provided by Debug Adapters that live in the Dart and Flutter SDKs. A legacy TypeScript version of these debug adapters lives in `src/debug/` for older versions of the SDKs.
- **DTD** or **The Dart Tooling Daemon**: A daemon spawned by the extension to communicate (in both directions) with some other Dart tools.
- **Flutter Device Daemon**: A daemon spawned by the extension to get updates about available target devices and emulators for Flutter applications.
- **Pub**: The package manager for Dart, used to manage dependencies.
- **MCP & Language Model Tools**: `DartMcpServerDefinitionProvider` registers the Dart SDK MCP server (`dart mcp-server`) with VS Code, and `languageModelTools` in `package.json` exposes IDE-integrated tools (such as `dart_format`, `dart_fix`, and `get_dart_tooling_daemon_dtd_uri`) to AI agents.


## Useful Commands

Here are some useful commands when working on the project.

- `npm install`: Installs dependencies. This may need to be run if dependencies appear to be missing.
- `npm run lint`: Run the linter (`eslint`) to ensure code conforms to enabled lints. Pass a relative file path to lint only that file.
- `npm run lint:fix`: Fixes lints that can be fixed automatically.
- `npm run build`: Builds the extension bundle (`src/extension/` and `src/debug/`) with Webpack.
- `npm run build-tests`: Compiles and typechecks `src/test/` and `src/shared/` (`tsc -p ./tsconfig.build.json`), which are not compiled by `npm run build`.
- `npm run test <...test-file-globs>`: Runs tests matching the given glob or file path (for example `BOT=dart npm run test src/test/dart/utils/fs.test.ts`). This should be used while working on an individual feature because it is faster than running all tests. Note that `npm test` sets `MOCHA_FORBID_ONLY=true`, so use CLI file filters rather than `.only`.
- `npm run test`: Runs _all_ automatic tests for _all_ bots. This can be run with the `BOT` env variable set to (as defined in `test_all.ts`, for example to `"dart"`) to run only a single bot's tests. The test suite is large and this can be slow.
- `npm run test-grammar`: Runs snapshot tests for the textmate grammar.
- `npm run update-grammar-snapshots`: Updates the textmate grammar snapshots.
