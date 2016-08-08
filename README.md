## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DanTup.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code

## Features

### Syntax highlighting

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/syntax highlighting.gif" />

### Basic code completion

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/code completion.gif" />

### Go to Definition

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/go to definition.gif" />

### Find References

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/find references.gif" />

### Realtime errors/warnings/hints reported in error window and with squiggles

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/diagnostics.gif" />

### Format document with custom line length

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/format code.gif" />

### Hovers/tooltip information

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/tooltips.gif" />

### Workspace-wide symbol search (`Ctrl+T`)

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/search.gif" />

### Auto-closing braces/quotes

<img src="https://github.com/DanTup/Dart-Code/raw/master/media/braces.gif" />

### Automatically Detects Dart SDK

As long as Dart is in your `PATH` environment variable, Dart Code will find it automatically.

## Requirements

The Dart SDK must be available on your machine and added to your `PATH` or set in the extensions configuration.

## Extension Configuration

- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can set the path to it here.
- `dart.lineLength`: The maximum length of a line of code. This is used by the document formatter. Defaults to 80.
- `dart.setIndentation`: Forces indenting with two spaces when Dart files are opened. This is on by default because VS Code doesn't support per-language settings and most people use tabs/4 spaces for other languages. Defaults to true.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to true.
- `dart.allowAnalytics`: Note: We only send a few very basic events and the extension version number/platform :-)

## Known Issues

- Tooltip positioning is sometimes bad
- Tooltips sometimes show stale data
- Code completion doesn't provide parameter help
- Cursor position may not be correctly preserved during reformat operations

## Analytics

This extension reports some very basic events to help inform development decisions, such as:

- When the extension is loaded
- When you enabled/disable some features (eg. showTodos)

Included in the event is your platform (Win/Linux/Mac) and the extensions version number.

This can be disabled via the `dart.allowAnalytics` setting.  

## Release Notes

### v0.6.2 *(2016-08-08)*

- Find References (`Shift+F12`) has been added
- Open files are given higher priority for analysis operations
- The extension no longer tries (and fails) to analyze open files that are outside of workspace folder

Additionally, a new option `dart.allowAnalytics` was added to control if analytics are sent. Only very basic events are captured (such as extension activation and if you toggle certain features) and are sent along with the extention version/platform. No code, filenames, project names or personal information will be sent. Source code for all analytics is visible [here](https://github.com/DanTup/Dart-Code/blob/master/src/analytics.ts).

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
