[![Linux & Mac build status](https://img.shields.io/travis/Dart-Code/Dart-Code/master.svg?label=mac+%26+linux)](https://travis-ci.org/Dart-Code/Dart-Code) [![Windows build status](https://img.shields.io/appveyor/ci/DanTup/Dart-Code/master.svg?label=windows&logoWidth=-1)](https://ci.appveyor.com/project/DanTup/dart-code) [![Gitter Chat](https://img.shields.io/badge/chat-online-blue.svg)](https://gitter.im/dart-code/Dart-Code) [![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode) [![Contribute to Dart Code](https://img.shields.io/badge/help-contribute-551A8B.svg)](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md)

## Introduction

Dart Code extends [VS Code](https://code.visualstudio.com/) with support for the
[Dart](https://www.dartlang.org/) programming language, and provides tools for
effectively editing, refactoring, running, and reloading [Flutter](https://flutter.io/)
mobile apps, and [AngularDart](https://angulardart.org) web apps.

## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Dart-Code.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code


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

Dart Code has a number of configuration options, including:

- `dart.allowAnalytics`: Whether to send analytics such as startup timings, frequency of use of features and analysis server crashes
- `dart.closingLabels`: Whether to show annotations against constructor, method invocations and lists that span multiple lines
- `dart.debugSdkLibraries`: Whether SDK libraries should be marked as debuggable. Defaults to `false`.
- `dart.debugExternalLibraries`: Whether libraries should be marked as debuggable. Defaults to `false`.
- `dart.flutterSdkPath`: Override the detected Flutter SDK to allow you to run from another location.
- `dart.promptToGetPackages`: Whether to prompt to get packages when opening a project with out of date packages. Defaults to `true`.
- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can enter the path to it here.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to `true`.

The full list of settings is [available here](https://dartcode.org/docs/settings).


## Refactorings and Code Fixes

`Ctrl`+`.` in Code opens the "lightbulb" menu showing all code fixes/refactors. Code v1.20 [gained the ability to keybind quickfixes](https://code.visualstudio.com/updates/v1_20#_keybindings-for-quick-fixes-and-code-actions). To do this you should edit your `keybindings.json` file and include the ID of the refactor to bind. If the `kind` for the keybind is set to just a segment of the ID (for example 'refactor.surround') then all actions sharing that prefix will appear in a filtered menu (or if only one, the action invoked immediately). You can control this behaviour with the `apply` argument [see docs](https://code.visualstudio.com/updates/v1_20#_keybindings-for-quick-fixes-and-code-actions).

The full list of supporting refactors is [available here](https://dartcode.org/docs/refactorings-and-code-fixes).


## Analytics

This extension reports some analytics such as:

- Extension load and analysis times
- Whether you have disabled some settings (such as showing TODOs in Problems Window or Closing Labels)
- Frequency of use of features like Hot Reload, Full Restart and Open Observatory
- Crashes in the Dart analysis server
- Platform and Dart/Flutter SDK versions

Reporting can be disabled via the `dart.allowAnalytics` setting.


## Release Notes

For full release notes, see [the changelog](https://github.com/Dart-Code/Dart-Code/blob/master/CHANGELOG.md).
