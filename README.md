<img src="./media/icon.png" align="left" />

# Dart Code

Dart support for Visual Studio Code.

<br clear="both" />

## Features

- Detects SDK location from PATH
- Syntax highlighting
- Basic code completion
- Realtime errors/warnings/hints reported in error window and with squiggles
- Format document with custom line length
- Hovers/tooltip information
- Workspace-wide symbol search (`Ctrl+T`)
- Auto-closing braces/quotes

## Requirements

The Dart SDK must be available on your machine and added to your `PATH` or set in the extensions configuration.

## Extension Configuration

`dart.sdkPath`: If the Dart SDK is not automatically found on your machine you can set the path to it here.

## Known Issues

- Tooltip positioning is bad
- Multi-cursor edits may be much slower than single-cursor
- Code completion doesn't provide parameter help

## Release Notes

### [v0.5.0](https://github.com/DanTup/Dart-Code/releases/tag/v0.1.0) *(2016-08-04)*

Another preview release to gather feedback on important things missing for v1. This version should be installed from the marketplace.

- SDK detection is more reliable on Linux/Mac
- Name changed from "Dart-Code" to "Dart Code"
- Setting added to control line-width passed to formatter
- Last used SDK path is cached to improve startup performance
- Tooltip hovers now indicate the range that they apply to
- Braces/quotes now automatically close
- Pressing enter between a set of braces will automatically indent


### [v0.1.0](https://github.com/DanTup/Dart-Code/releases/tag/v0.1.0) *(2016-08-04)*

Super-early preview release to get some testing from other people. The next preview will be distributed in the store but I wanted to get a little feedback from others before I publish it there.

- Detects SDK location from PATH
- Syntax highlighting
- Basic code completion
- Realtime errors/warnings/hints reported in error window and with squiggles
- Format document
- Hovers/tooltip information
- Workspace-wide symbol search (`Ctrl+T`)
