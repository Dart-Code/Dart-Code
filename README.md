## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DanTup.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code

## Features

- Syntax highlighting
- Basic code completion
- Go to Definition (`F12`)
- Find References (`Shift+F12`)
- Excute Dart command line apps (`F5`)
- Organise directives (`Ctrl+Alt+O`)
- Realtime errors/warnings/TODOs reported in problems window (`Ctrl+Shift+M`) and with squiggles
- Format document with custom line length (`Alt+Shift+F`)
- Hovers/tooltip information
- Workspace-wide symbol search (`Ctrl+T`)
- Auto-closing braces/quotes
- Document symbol list/search with highlighting (`Ctrl+Shift+O`)
- `pub get` and `pub upgrade` commands
- Supports strong mode and linting (configured in `analysis_options.yaml` or `.analysis_options`)
- Other references to symbol under cursor are highlighted
- Automatically finds Dart SDK if it is in your `PATH` environment variable

## Extension Settings

- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can enter the path to it here.
- `dart.lineLength`: The maximum length of a line of code. This is used by the document formatter. Defaults to 80.
- `dart.setIndentation`: Forces indenting with two spaces when Dart files are opened. This is on by default because VS Code doesn't currently support per-language settings and most people use tabs/4 spaces for other languages but Convention is 2 spaces. Defaults to true.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to true.
- `dart.allowAnalytics`: Note: We only send a few very basic events and the platform and extension/Dart version numbers :-)

## Analytics

This extension reports some very basic events to help inform development decisions, such as:

- When the extension is loaded
- When you enabled/disable some features (eg. showTodos)

Included in the event is your platform (Win/Linux/Mac) and extension/Dart version numbers.

This can be disabled via the `dart.allowAnalytics` setting.  

## Release Notes

Full release notes can be found [on GitHub](https://github.com/Dart-Code/Dart-Code/releases).
