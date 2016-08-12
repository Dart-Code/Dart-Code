## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DanTup.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code

## Features

### Syntax highlighting

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/syntax highlighting.gif" />

### Basic code completion

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/code completion.gif" />

### Go to Definition

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/go to definition.gif" />

### Find References

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/find references.gif" />

### Realtime errors/warnings/hints reported in error window and with squiggles

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/diagnostics.gif" />

### Format document with custom line length

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/format code.gif" />

### Hovers/tooltip information

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/tooltips.gif" />

### Workspace-wide symbol search (`Ctrl+T`)

<img src="https://github.com/Dart-Code/Dart-Code/raw/master/media/screenshots/search.gif" />

### Additionally: 

- Auto-closing braces/quotes
- Document symbol list/search with highlighting
- `pub get` and `pub upgrade` commands
- Other symbol references to current symbol are highlighted


### Automatically Detects Dart SDK

As long as Dart is in your `PATH` environment variable, Dart Code will find it automatically.

## Requirements

The Dart SDK must be available on your machine and added to your `PATH` or set in the extensions configuration.

## Extension Configuration

- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can set the path to it here.
- `dart.lineLength`: The maximum length of a line of code. This is used by the document formatter. Defaults to 80.
- `dart.setIndentation`: Forces indenting with two spaces when Dart files are opened. This is on by default because VS Code doesn't support per-language settings and most people use tabs/4 spaces for other languages. Defaults to true.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to true.
- `dart.allowAnalytics`: Note: We only send a few very basic events and the platform and extension/Dart version numbers :-)

## Known Issues

- Tooltip positioning is sometimes bad
- Tooltips sometimes show stale data
- Code completion doesn't provide parameter help
- Cursor position may not be correctly preserved during reformat operations

## Analytics

This extension reports some very basic events to help inform development decisions, such as:

- When the extension is loaded
- When you enabled/disable some features (eg. showTodos)

Included in the event is your platform (Win/Linux/Mac) and extension/Dart version numbers.

This can be disabled via the `dart.allowAnalytics` setting.  

## Release Notes

### v0.7.0 *(2016-08-12)*

- Workspace symbol search (`Ctrl+T`) now includes more symbols from your workspace including imported packages
- Document symbol list/search has been implemented (`Ctrl+Shift+O`)
- Document highlights have been implemented (selected a symbol will highlight other instances)
- Commands for `pub get` and `pub ugprade` have been added
- Errors and warnings from files that are deleted when not open will no longer hang around in the problems view

Additionally, some non-features:

- Dart-Code now builds continiously on Jenkins (Mac OSX + Linux) and AppVeyor (Windows)
- Analaytics now include Dart SDK and Analysis Server version numbers to help us understand what features we can use and/or drop support for 

### v0.6.2 *(2016-08-08)*

- Find References (`Shift+F12`) has been added
- Open files are given higher priority for analysis operations
- The extension no longer tries (and fails) to analyze open files that are outside of workspace folder

Additionally, a new option `dart.allowAnalytics` was added to control if analytics are sent. Only very basic events are captured (such as extension activation and if you toggle certain features) and are sent along with the extension version/platform. No code, filenames, project names or personal information will be sent. Source code for all analytics is visible [here](https://github.com/Dart-Code/Dart-Code/blob/master/src/analytics.ts).

### v0.6.1 *(2016-08-07)*

- A new option `dart.showTodos` (default: `true`) has been added to show/hide TODO messages from the Problems list
- "Analyzing…" will now show in the status bar when files are being analyzed
- Go to Definition is now supported within your project (though does not yet work with SDK classes)
- The Dart SDK version number will now show in the bottom right status bar
- Dart files will automatically be set to 2-space indenting when you open them
- A new option `dart.setIndentation` (default: `true`) has been added to enable/disable automatic indent settings 
- Symbol search is now case-insensitive and also supports better filtering (eg. "TA" will match "TwitterApi")
- Tooltips reading `"undefined"` will no longer appear for some items (eg. string literals)
- Tooltip formatting/display has been greatly improved

### v0.5.2 *(2016-08-05)*

- SDK detection is more reliable on Linux/Mac
- Name changed from "Dart-Code" to "Dart Code"
- Setting added to control line-width passed to formatter
- Last used SDK path is cached to improve startup performance
- Tooltip hovers now indicate the range that they apply to
- Braces/quotes now automatically close
- Pressing enter between a set of braces will automatically indent

### v0.1.0 *(2016-08-04)*

- Detects SDK location from PATH
- Syntax highlighting
- Basic code completion
- Realtime errors/warnings/hints reported in error window and with squiggles
- Format document
- Hovers/tooltip information
- Workspace-wide symbol search (`Ctrl+T`)
