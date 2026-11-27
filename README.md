# Dart for Visual Studio Code

[![Discord Chat](https://img.shields.io/badge/chat-discord-blue.svg)](https://discord.gg/xSTPEqm)
[![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode)
[![Follow on Bluesky](https://img.shields.io/badge/bluesky-dartcode.org-blue.svg)](https://bsky.app/profile/dartcode.org)
[![Contribute to Dart Code](https://img.shields.io/badge/help-contribute-551A8B.svg)](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md)
[![Coverage](https://codecov.io/github/Dart-Code/Dart-Code/graph/badge.svg?token=EPDiJkMrZM)](https://codecov.io/github/Dart-Code/Dart-Code)

Adds support for the [Dart](https://dart.dev/) programming language to [Visual Studio Code](https://code.visualstudio.com/), including rich editing, refactoring, debugging, testing, and tooling integration.

If you are developing [Flutter](https://flutter.dev/) apps, install the [Flutter extension](https://marketplace.visualstudio.com/items?itemName=Dart-Code.flutter), which depends on and automatically installs this extension.

## Features

- **Editing & Navigation** — Syntax and semantic highlighting, code completion, hover documentation, real-time diagnostics, snippets, Go to Definition, Find References, Call/Type Hierarchy, and closing labels.
- **Refactoring & Formatting** — Quick fixes, refactorings (rename, extract method, organize imports, sort members, fix all), and formatting via `dart format` (including format-on-save and format-on-type).
- **Debugging** — Launch and attach debugging for Dart apps with breakpoints, expression evaluation, hot reload, and configurable "Just My Code" debugging (with options to step into packages or SDK code).
- **Testing** — Integrated with VS Code's Test Explorer to discover, run, debug, and view results and coverage for Dart tests.
- **Packages & SDK Management** — Automatic Dart SDK discovery from `PATH`, quick SDK switching, project creation (**Dart: Create New Project**), Pub package commands, automatic `pub get` on `pubspec.yaml` changes, and a **Dependencies** view in the Explorer.
- **DevTools & AI Tooling** — Integration with [Dart DevTools](https://dart.dev/tools/dart-devtools) (CPU profiler, memory, network, logging) and AI agent support via the Dart SDK [MCP server](https://dart.dev/tools/mcp-server) and VS Code language model tools.

## Getting Started

1. Install this extension from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Dart-Code.dart-code), [Open VSX](https://open-vsx.org/extension/Dart-Code/dart-code), or by searching for **Dart** in the VS Code Extensions view.
2. Install the [Dart SDK](https://dart.dev/get-dart) and make sure it is on your `PATH` (for Flutter projects, the [Flutter SDK](https://flutter.dev/) includes Dart and can be downloaded automatically by the extension if not already installed).
3. Open a folder containing a Dart or Flutter project (or run **Dart: Create New Project** from the Command Palette) and press `F5` to run and debug.

## Documentation

- [Documentation Overview](https://dartcode.org/docs/)
- [Extension Settings](https://dartcode.org/docs/settings/)
- [Commands](https://dartcode.org/docs/commands/) & [Key Bindings](https://dartcode.org/docs/key-bindings/)
- [Refactorings & Code Fixes](https://dartcode.org/docs/refactorings-and-code-fixes/)
- [Frequently Asked Questions](https://dartcode.org/faq/)
- [Release Notes / Changelog](https://dartcode.org/releases/)

## Feedback & Contributing

- **Issues & Feature Requests**: Report bugs or request features for both the Dart and Flutter extensions on [GitHub Issues](https://github.com/Dart-Code/Dart-Code/issues/new/choose). When reporting a bug, attaching a log file ([instructions](https://dartcode.org/docs/logging/)) is often very helpful.
- **Community**: Ask questions or chat in the [Dart-Code Discord](https://discord.gg/xSTPEqm).
- **Contributing**: See [CONTRIBUTING.md](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md) for instructions on building, running, and testing the extension locally.

## Telemetry

This extension collects basic anonymous usage analytics — such as extension, editor, and SDK versions, platform, certain commands and debug session types, and a few feature settings — to help guide development.

A complete list of collected events and properties is available in the [analytics documentation](https://dartcode.org/docs/analytics/) and [`telemetry.json`](https://github.com/Dart-Code/Dart-Code/blob/master/telemetry.json). Reporting can be disabled via VS Code's **Telemetry: Telemetry Level** setting (and also respects `DO_NOT_TRACK=1` and Dart/Flutter tooling telemetry opt-out).
