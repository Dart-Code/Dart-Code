[![Linux & Mac build status](https://img.shields.io/travis/Dart-Code/Dart-Code.svg?label=mac+%26+linux)](https://travis-ci.org/Dart-Code/Dart-Code) [![Windows build status](https://img.shields.io/appveyor/ci/DanTup/Dart-Code.svg?label=windows&logoWidth=-1)](https://ci.appveyor.com/project/DanTup/dart-code) [![Gitter Chat](https://img.shields.io/badge/chat-online-blue.svg)](https://gitter.im/dart-code/Dart-Code) [![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode) [![Contribute to Dart Code](https://img.shields.io/badge/help-contribute-551A8B.svg)](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md) [![Contribute to Dart Code](https://img.shields.io/badge/help-donate-551A8B.svg)](https://www.paypal.me/DanTup)

## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DanTup.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

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

- `dart.allowAnalytics`: Note: We only send a few basic events and version numbers (see below) :-)
- `dart.checkForSdkUpdates`: Whether to check you are using the latest version of the Dart SDK at startup. Defaults to `true`.
- `dart.debugSdkLibraries`: Whether SDK libraries should be marked as debuggable. Defaults to `false`.
- `dart.debugExternalLibraries`: Whether libraries should be marked as debuggable. Defaults to `false`.
- `dart.flutterHotReloadOnSave`: Whether to automatically send a 'hot reload' request during a Flutter debug session when saving files. Defaults to `false`.
- `dart.insertArgumentPlaceholders`: Whether to insert argument placeholders during code completions. Defaults to `true`.
- `dart.lineLength`: The maximum length of a line of code. This is used by the document formatter. Defaults to `80`.
- `dart.pubAdditionalArgs`: Additional args to pass to `pub get` and `pub upgrade` commands (eg. `--packages-dir`).
- `dart.runPubGetOnPubspecChanges`: Whether to automatically run `pub get` whenever pubspec.yaml is saved. Defaults to `true`.
- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can enter the path to it here.
- `dart.sdkContainer`: If you often switch between multiple Dart SDKs, setting this option to a folder that contains multiple Dart SDKs in sub-folders will allow fast switching by clicking the Dart SDK version in the status bar.
- `dart.showLintNames`: Whether to show the names of linter rules in the problems panel to make it easier to `// ignore:`.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to `true`.


## Analytics

This extension reports some basic events and timings to help inform development decisions, such as:

- Extension is loaded
- Some settings (TODOs shown, whether you're debugging all code / your code)
- Timings (how long did extension take to load / how long till analysis server was ready)
- Crashes in the Dart analysis server

Included in the event is your platform (Win/Linux/Mac) and extension/Dart version numbers.

This can be disabled via the `dart.allowAnalytics` setting.  


## Release Notes

For full release notes, see [the changelog](https://github.com/Dart-Code/Dart-Code/blob/master/CHANGELOG.md).
