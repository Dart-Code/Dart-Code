## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DanTup.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code

## New in 0.11

- Code fixes have been added! Use `Ctrl+.` for the lightbulb menu or `F8` for a diagnostics widget 
- Pub run will run automatically when you save `pubspec.yaml` (this can be disabled with the `dart.runPubGetOnPubspecChanges` setting)
- Completion for methods/constructors now adds placeholders for mandatory arguments
- Completion for named arguments now adds a placeholder for the value
- Pressing `<ENTER>` in a triple-slash comment (`/// ...`)  will now pre-complete the comment markers for the next line
- Pressing `<ENTER>` in an old-style multiline comment (`/** ... */`) will now pre-complete following lines and place the closing marker (`*/`) in the right position
- Hovers will no longer contain hyperlinks that don't work where docs reference other elements
- Display improvements to hovers/tooltips (these are not finished and be improved again in a future release)
- Completion now shows when an element is deprecated
- Hovers will now show when an element is deprecated (note: requires Dart SDK 1.20, currently unreleased)

Additionally there were some performance improvements, the beginning of automated testing and some additional diagnostics to help users provide more detailed information if they encounter bugs.

Many bugs have been fixed by Microsoft and the Dart team that affect Dart Code so please be sure to upgrade to the latest versions of Code and the Dart SDK.

## Features

- Syntax highlighting
- Code completion
- Realtime errors/warnings/TODOs reported in problems window (`Ctrl+Shift+M`) and with squiggles
- Hovers/tooltip information
- Go to Definition (`F12`)
- Find References (`Shift+F12`)
- Excute Dart command line apps (`F5`)
- Debugging support for command line apps (`F5`)
- Code fixes/lightbulb (`Ctrl+.` and `F8`)
- Notification of new stable Dart SDK releases
- Rename refactoring (`F2`)
- Organise directives (`Ctrl+Alt+O`)
- Format document with custom line length (`Alt+Shift+F`)
- Workspace-wide symbol search (`Ctrl+T`)
- Auto-closing braces/quotes
- Document symbol list/search with highlighting (`Ctrl+Shift+O`)
- `pub get` and `pub upgrade` commands
- Supports strong mode and linting (configured in `analysis_options.yaml` or `.analysis_options`)
- Other references to symbol under cursor are highlighted
- Automatically finds Dart SDK if it is in your `PATH` environment variable

## Extension Settings

- `dart.allowAnalytics`: Note: We only send a few very basic events and the platform and extension/Dart version numbers :-)
- `dart.checkForSdkUpdates`: Whether to check you are using the latest version of the Dart SDK at startup. Defaults to `true`.
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
