[![Gitter Chat](https://img.shields.io/badge/chat-online-blue.svg)](https://gitter.im/dart-code/Dart-Code) [![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode) [![Contribute to Dart Code](https://img.shields.io/badge/help-contribute-551A8B.svg)](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md) [![Linux & Mac build status](https://img.shields.io/travis/Dart-Code/Dart-Code/master.svg?label=mac+%26+linux)](https://travis-ci.org/Dart-Code/Dart-Code) [![Windows build status](https://img.shields.io/appveyor/ci/DanTup/Dart-Code/master.svg?label=windows&logoWidth=-1)](https://ci.appveyor.com/project/DanTup/dart-code)

## Introduction

Dart Code extends [VS Code](https://code.visualstudio.com/) with support for the
[Dart](https://www.dartlang.org/) programming language, and provides tools for
effectively editing, refactoring, running, and reloading [Flutter](https://flutter.io/)
mobile apps, and [AngularDart](https://angulardart.org) web apps.

## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Dart-Code.dart-code) or by [searching within VS Code](https://code.visualstudio.com/docs/editor/extension-gallery#_search-for-an-extension).


## Features

- Debug Dart command line apps
- Debug Flutter mobile apps
- Support for flutter `hot reload` (use the debugger `Restart` button)
- Select from multiple devices for Flutter debugging (select from the status bar)
- Support for debugging "just my code" or SDK/libraries too (`dart.debugSdkLibraries` and `dart.debugExternalLibraries`)
- Automatically finds Dart and Flutter SDKs from `PATH` or workspace folders
- Notification of new stable Dart SDK releases
- Syntax highlighting
- Code completion
- Snippets
- Realtime errors/warnings/TODOs reported in problems window and with squiggles
- Hovers/tooltip information
- Go to Definition
- Find References
- Code fixes/lightbulb
- Type hierarchy
- Rename refactoring
- Organize directives
- Sort members
- Flutter Doctor command
- Format document
- Support for format-on-save (`editor.formatOnSave`)
- Support for format-on-type (`editor.formatOnType`)
- Workspace-wide symbol search
- Automatic closing braces/quotes
- Document symbol list/search with highlighting
- Generation of analysis error reports for easy reporting to the Dart team 
- `pub get` and `pub upgrade` commands (and flutter equivilents)
- Automatically run `pub get` when `pubspec.yaml` is saved
- Supports strong mode and linting (configured in `analysis_options.yaml` or `.analysis_options`)
- Other references to symbol under cursor are highlighted


## Extension Settings

A full list of settings is [available here](https://dartcode.org/docs/settings).


## Refactorings and Code Fixes

A full list of supported refactors is [available here](https://dartcode.org/docs/refactorings-and-code-fixes).


## Analytics

This extension reports some analytics such as:

- Extension load and analysis times
- Whether you have disabled some settings (such as showing TODOs in Problems Window or Closing Labels)
- Frequency of use of features like Hot Reload, Full Restart and Open Observatory
- Crashes in the Dart analysis server
- Platform and Dart/Flutter SDK versions

Reporting can be disabled via the `dart.allowAnalytics` setting.


## Release Notes

For full release notes, see [the changelog](https://dartcode.org/releases/).
