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
- Code in `src/extension/` must not be imported outside of that folder (enforce by lints).
- All extension settings use the format `dart.*` or `dart.flutter*` and are accessed through a wrapper in `src/extension/config.ts`.

### Code Style

- Use double quotes for strings.
- No trailing spaces.
- Include full stops on comment sentences.
- Avoid braces for simple one-line if/else blocks.


## Existing Errors / Warnings

There are some existing lint warnings that are expected and should be ignored:

- "Property NOTE is not allowed.": This is a note about the following item.
- "Property id is not allowed.": This is for backwards compatibility with older versions of VS Code.


## Components

- **LSP**: The Language Server Protocol. A lot of language functionality is provided by an LSP server that lives in the Dart SDK.
- **DAP**: The Debug Adapter Protocol. Debugging functionality is provided by Debug Adapters that live in the Dart and Flutter SDKs. A legacy TypeScript version of these debug adapters lives in `src/debug/` for older versions of the SDKs.
- **DTD** or **The Dart Tooling Daemon**: A daemon spawned by the extension to communicate (in both directions) with some other Dart tools.
- **Flutter Device Daemon**: A daemon spawned by the extension to get updates about available target devices and emulators for Flutter applications.
- **Pub**: The package managed for Dart, used to manage dependencies.


## Useful Commands

Here are some useful commands when working on the project.

- `npm install`: Installs dependencies. This may need to be run if dependencies appear to be missing.
- `npm run lint`: Run the linter (`eslint`) to ensure code conforms to enabled lints. Pass a relative file path to lint only that file.
- `npm run lint:fix`: Fixes lints that can be fixed automatically.
- `npm run build`: Builds the extension.
- `npm run test <...test-file-globs>`: Runs tests for the given glob (or file path). This should be used while working on an individual feature because it is faster than running all tests.
- `npm run test`: Runs _all_ automatic tests for _all_ bots. This can be run with the `BOT` env variable set to (as defined in `test_all.ts`, for example to `"dart"`) to run only a single bots tests. The test suite is large and this can be slow.
- `npm run test-grammar`: Runs snapshot tests for the textmate grammar.
- `npm run update-grammar-snapshots`: Updates the textmate grammar snapshots.
