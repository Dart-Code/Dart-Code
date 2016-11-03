## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DanTup.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code

## New in 0.13.1

- Code completion should no longer occasionally fail showing `Loading...`
- Invoking `Go to Definition` on import statements should no longer occasionally fail silently

## Features

- Syntax highlighting
- Code completion
- Realtime errors/warnings/TODOs reported in problems window (`Ctrl`+`Shift`+`M`) and with squiggles
- Hovers/tooltip information
- Go to Definition (`F12`)
- Find References (`Shift`+`F12`)
- Excute Dart command line apps (`F5`)
- Debugging support for command line apps (`F5`)
- Code fixes/lightbulb (`Ctrl`+`.` and `F8`)
- Notification of new stable Dart SDK releases
- Type hierarchy (`F4`)
- Rename refactoring (`F2`)
- Organise directives (`Ctrl`+`Alt`+`O`)
- Format document with custom line length (`Alt`+`Shift`+`F`)
- Support for formatting-during-typing
- Workspace-wide symbol search (`Ctrl`+`T`)
- Auto-closing braces/quotes
- Document symbol list/search with highlighting (`Ctrl`+`Shift`+`O`)
- `pub get` and `pub upgrade` commands
- Automatically run `pub get` when `pubspec.yaml` is saved
- Supports strong mode and linting (configured in `analysis_options.yaml` or `.analysis_options`)
- Other references to symbol under cursor are highlighted
- Automatically finds Dart SDK if it is in your `PATH` environment variable

## Extension Settings

- `dart.allowAnalytics`: Note: We only send a few very basic events and the platform and extension/Dart version numbers :-)
- `dart.checkForSdkUpdates`: Whether to check you are using the latest version of the Dart SDK at startup. Defaults to `true`.
- `dart.insertArgumentPlaceholders`: Whether to insert argument placeholders during code completions. Defaults to `true`.
- `dart.lineLength`: The maximum length of a line of code. This is used by the document formatter. Defaults to `80`.
- `dart.runPubGetOnPubspecChanges`: Whether to automatically run `pub get` whenever pubspec.yaml is saved. Defaults to `true`.
- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can enter the path to it here.
- `dart.setIndentation`: Forces indenting with two spaces when Dart files are opened. This is on by default because VS Code doesn't currently support per-language settings. Defaults to `true`.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to `true`.

## Analytics

This extension reports some very basic events to help inform development decisions, such as:

- When the extension is loaded
- When you enabled/disable some features (eg. showTodos)

Included in the event is your platform (Win/Linux/Mac) and extension/Dart version numbers.

This can be disabled via the `dart.allowAnalytics` setting.  

## Release Notes

Full release notes can be found [on GitHub](https://github.com/Dart-Code/Dart-Code/releases).
