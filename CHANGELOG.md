# v2.2.0

- When running on Mac OS + iOS breakpoints should work from first launch without having to `hot reload` first
- A new `Sort Members` command has been added
- `Start without debugging` will no longer error if this is the first time running a project (where the `.vscode\launch.json` file does not exist)
- A new option `sdkContainer` has been added which can be used for fast SDK switching - set to a folder that contains multiple SDKs and the Dart SDK version in the status bar will become clickable


# v2.1.0

- [Flutter] A new command has been added to the command palette to run `flutter doctor`
- Dart and Flutter SDKs are now found in `PATH` even when they start with `~/` for a users home directory
- All path names in config (log files, analyzer path, SDK path) now support starting with `~/` for a users home directory
- When enabled, debug logging should now flush correctly before terminating to reduce the changes of data not being recorded
- A new option has been introduced (`showLintNames`) which will prefix lint/hint names into messages in the `Problems` pane to make it easier to `// ignore` them if you wish

# v2.0.0 - Flutter Run/Debug/Reload Support!

**Note:** If you previously installed a beta version of Dart Code to help with testing Flutter integration, please uninstall it and close **all** Code instances before installing v2.0 from the marketplace.

- [Flutter] When opening a Flutter project your selected device will be shown in the status bar
- [Flutter] If you have more than one connected device you will be able to switch between them by clicking on the device in the status bar
- [Flutter] Pressing `F5` will build and launch your app on the selected device
- [Flutter] The usual debugging experience is available for Flutter apps, including breakpoints, call stacks, watch window etc.
- [Flutter] The debugger's `Restart` button (or `Ctrl+Shift+F5`) has been mapped to Flutter's `hot reload` and will update the running application without needing to rebuild
- [Flutter] Code completion for Widgets will no longer show trailing commas in the list (though they will still be inserted)
- Clicking the debugger's restart button for a Dart CLI app will no longer crash but instead provide a more useful message about being unable to restart when VS Code does not supply toe correct configuration (this issue is fixed for VS Code 1.14 coming soon)
- Stack frame text when stopped in the debugger is now improved and will show async gaps
- Cursor placement after code fixes and assists should now be more accurate

The [contributing](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md) file has also been updated to make it easier to get started with contributing to Dart Code.

# v1.4.2

**Note:** This version requires Visual Studio Code 1.13.

- Code completion will now show types for named arguments more reliably
- Argument placeholders will now (again) insert placeholder text instead of empty strings
- Completing methods that take no arguments will no longer place the cursor between the parens as if there are arguments to type
- When selecting items from the code completion list the cursor will now more reliably move to the expected location after insertion
- New snippets have been added for `test` and `group` methods defined in the `test` package
- Dart Code will now activate when opening workspaces that include a `pubspec.yaml` anywhere in the tree, not just in the workspace root folder
- Debug logging will no longer appear in the `Debug Output` window when launching a debug session
- Snippets now have *slightly* more verbose descriptions of their functionality


# v1.4.1

- Identifiers that start or end with `$` symbols will now highlight correctly
- Highlighting of variables inside interpolated strings is now more accurate
- Configuration snippets have been added to make adding additional debug configs to `launch.json` easier

# v1.4.0

- Code assists are now available and will show up as lightbulbs similar to existing code fixes (for example, `Wrap in new widget` in Flutter projects)
- Code completion will now refresh on certain key presses (`space`, `(`, `=`) which should result in more accurate results more often
- Code completion results are now sorted by relevance rather than alphabetically
- Cursor position should now be better maintained when executing code fixes
- `pubspec.yaml` and `analysisoptions.yaml` will once again use the built-in YAML language/highlighting
- When opening a flutter project, the `.packages` file will now also be used when trying to locate the Flutter SDK
- The error message shown when unable to locate the Flutter SDK has been simplified and a link to the Flutter download page added
- The environment variable `FLUTTER_HOME` is not recommended for use and will no longer be used to locate a Flutter SDK (`FLUTTER_ROOT` is still checked)

# v1.3.0

- When opening a Flutter project, the below locations will be checked for a Flutter SDK and the embedded Dart SDK will be used (if no flutter SDK is found an error message will be shown)
  - `.\bin\flutter(.bat)`
  - `(FLUTTER_ROOT)\bin\flutter(.bat)`
  - All folders in `PATH`
- Dart SDK update checks are now disabled for Flutter projects due to the embedded Dartk SDK
- Pub commands are now generally replaced with Flutter equivilents when a Flutter project is open (note: Pub commands still appear in the command palette for familiarity but will execute flutters versions)
- When `flutter: sdk: flutter` is added to/removed from `pubspec.yaml` you will be prompted to reload to switch between Dart/Flutter SDKs
- Pub commands will no longer appear in the command palette when a Dart project is not open

# v1.2.0

- The change made in v1.1.0 to support opening the Flutter repo introduced some new issues and has been reverted except for specific workspaces. The issue is caused by using a folder named `packages` which is [not currently supported by the analyzer](https://github.com/dart-lang/sdk/issues/29414). In order to fix the issue for the Flutter repo the workaround will be triggered by the presence of a `.\packages\.gitignore` file (which exists in the Flutter repo but not in `packages` folders created by `pub`). This workaround will be removed once the Analyzer has been updated.

# v1.1.0

- Opening a folder that is not itself a Dart package but contains others (such as the Flutter repository) will no longer give false errors/warnings caused by incorrect package resolution
- Setting Dart SDK/libraries as debuggable/non-debuggable will now work correctly with SDK 1.23 which has different debugging defaults
- The `launch.json` file should now be much simpler than before and not contain internal Dart Code settings that are not relevant to the user *
- The `launch.json` file now properly supports default so `checkedMode: true` and `args: []` are not longer required unless being changed *

\* Your launch.json file should automatically be tidied up when you first open your project.

# v1.0.2

- `interface` has been removed from the list of keywords for syntax highlighting. It has not been a Dart keyword for sometime and resulted in incorrect colouring when using it as a variable name
- Expressions in interpolated strings should now be highlighted even when containing properties and method calls

# v1.0.1

- Opening a Dart file from the Dart SDK (such as navigating via `Go to Definition` on an SDK type) when using a dev-version 1.23 Dart SDK will no longer result in an infinite analyzing loop causing `Analyzing...` to flicker on the status bar

# v1.0.0

- Pressing F5 to launch Dart programs after upgrading to Code 1.10 will no longer fail with an error about an unexpected token in `launch.json`
- Pressing F5 to launch Dart programs will now use Dart's `checked mode` by default
- A new option has been introduced (`pubAdditionalArgs`) that allows additional arguments to be passed to `pub` in the `Pub Get` and `Pub Upgrade` commands (this may be useful if you wish to use `--packages-dir`)
- The order of items in error reports have been tweaked slightly to move more useful stuff further up

# v0.15.1

- Fixed an issue introduced in v0.15.0 where `null` would something appear in tooltips for items with no doc comments.

# v0.15.0

- Tooltips will now show include the name of the library that a type comes from.
- When the `Organize Directives` command fails (eg. due to a compile error) the correct message will be displayed instead of `[Object object]`

# v0.14.9

- Completing named arguments that already have values will no longer cause the argument name to be inserted twice.

# v0.14.8

- An error message about the "new driver" will no longer appear when using version v1.22.0-dev.5.0 or later of the Dart SDK.

# v0.14.7

**Note:** This version requires Visual Studio Code 1.8.

- Code completion will no longer insert underscore characters after upgrading to Code 1.8.

# v0.14.6

- Using the experimental analysis driver will no longer result multiple error reports being offered when an error occurs 

# v0.14.5

- Passing additional arguments to the analysis server via the hidden setting `dart.analyzerAdditionalArgs` now works as expected
- Generated error reports will now include which analysis server arguments were used 
- Generated error reports will now include which type of request the server was processing
- Generated error reports may now include additional diagnostic information from the analysis server
- Generated error reports will now include some intro text encouraging the user to review the report for any sensitive information

# v0.14.4

- Some additional debugging settings have been added to help track down analysis server issues
- Changing analysis server debug settings will now prompt you to reload the project to restart the analysis server
- Some minor tweaks have been made to the error report generation when the analysis service crashes
- Exception analytics should no longer sometimes include users source code paths/filenames in logs

# v0.14.3

- When changing the `dart.sdkPath` setting you will now be prompted (and given a button) to reload the project
- If the analysis service crashes and analytics are enabled, the first line of the error message will be included in an analytics event 

# v0.14.2

- Fix to fix for analytics :(
- Add timings for extension activation and analysis server startup

# v0.14.1

- Minor update to improve session handling for analytics

# v0.14.0

Note: Due to use of new APIs, Dart Code v0.14 requires Visual Studio Code v1.6 or newer.

## Debug Just My Code

New options have been added controlling whether to step into SDK and external library code when debugging. When first opening Dart Code with this change you will be prompted to choose whether to "Debug just my code" or "Debug all code". You can change this at any time with the `dart.debugSdkLibraries` and `dart.debugExternalLibraries` options.

## Analysis Server Error Reporting

If the analysis server encounters an error you will now be prompted (up to 3 times per session) to report the issue to the Dart team. Clicking "Generate error report" will build a document of markdown that you can simple copy/paste directly into the Dart SDK issue tracker (linked at the top of the report).

## Misc

- A small change was made to ensure [debugging compatibility with future versions of the Dart SDK](https://groups.google.com/a/dartlang.org/forum/#!msg/announce/VxSw-V5tx8k/wPV0GfX7BwAJ).
- If the Dart SDK is not found on your machine, the error message will now include a button to launch the [Dart installation page](https://www.dartlang.org/install).
- As of Visual Studio Code v1.7, the `editor.formatOnSave` setting will work correctly for Dart files.  

# v0.13.1

- Code completion should no longer occasionally fail showing `Loading...`
- Invoking `Go to Definition` on import statements should no longer occasionally fail silently

# v0.13.0

- Support has been added to format documents while typing (you must enable `editor.formatOnType`). This currently triggers when you type `;` or `}`. **Please send feedback!**

# v0.12.0

- A new "type hierarchy" feature has been added (`F4`) 
- The "Preview" tag has been removed from Dart Code
- The VS Code version number is now included in analytics to help make decisions about when code supporting older versions of Code can be removed

# v0.11.2

- If the Dart analysis server crashes you will now be prompted to save and reload the project (rather than everything being silently broken)

# v0.11.1

- An option has been added (`dart.insertArgumentPlaceholders`) to turn off placeholder insertion during completion operations
- More improvements have been made to hovers (these appear best in Code 1.6, currently the Insiders build)
- Large lists will now be "paged" in the debugger locals/watch windows to improve performance
- The SDK update notification now has a button to jump directly to the Dart SDK download page

# v0.11.0

- Code fixes have been added! Use `Ctrl`+`.` for the lightbulb menu or `F8` for diagnostics widget 
- `pub get` will run automatically when you save `pubspec.yaml` (can be disabled with the `dart.runPubGetOnPubspecChanges` setting)
- Completion for methods/constructors now adds placeholders for mandatory arguments
- Completion for named arguments now adds a placeholder for the value
- Pressing `<ENTER>` in a triple-slash comment (`/// ...`)  will now pre-complete the comment markers for the next line
- Pressing `<ENTER>` in an old-style multiline comment (`/** ... */`) will now pre-complete following lines and place the closing marker (`*/`) in the right position
- Hovers will no longer contain hyperlinks that don't work when docs reference other elements
- Display improvements to hovers/tooltips (these are not finished and will continue to be improvedin future releases)
- Completion now shows when an element is `deprecated`
- Hovers will now show when an element is `deprecated` (note: requires Dart SDK 1.20, currently unreleased)

Additionally there were some performance improvements, the beginning of automated testing and some additional diagnostic settings (to help users provide more detailed information if they encounter bugs).

Many bugs have been fixed by Microsoft and the Dart team that affect Dart Code so please be sure to upgrade to the latest versions of Code (`1.5`) and the Dart SDK (`1.19.1`).

# v0.10.0

- Debug support has been added! Breakpoints, hover evaluation, watch window, call stack etc. should all work (with some minor known issues)
- Rename (`F2`) now works for most items
- The update check for SDKs now connects to the internet to check for updates instead of using a hard-coded last-known-update value
- A new option has been added to disable SDK update checks/notifications (`dart.checkForSdkUpdates`)
- Properties will now display better in completion/symbol lists and not as callable methods
- SDK paths that have been removed from settings will no longer continue to be searched at startup
- Indent settings for `pubspec.yaml` and `analysis_options.yaml` will now also be forced into 2-spaces at load (if `dart.setIndentation` has not been set to `false`)

# v0.9.0

- A warning will be shown at startup if your Dart SDK is older than the one the current Dart Code was tested with
- If you have multiple open Dart projects using different versions of the SDK, running a command line app (`F5`) will no longer use the SDK from the last Dart project opened
- Various improvements have been made to the display of search results and code-completion items
- Snippets have been added for common code (`main`, `try`, `switch`, `import`, `class`, `typedef` and more!)
- Errors will no longer occur trying to run `pub get` or `pub upgrade` if your SDK is in a path that contains spaces

# v0.8.2

- The display of symbols in the workspace symbol search (`Ctrl+T`) has been improved \*
- The Dart language service will no longer crash when you enter symbols into the (`Ctrl+T`) search box
- Pressing `F5` will now allow you to run a Dart command line application (you will need to set the path in `.vscode\launch.json`) \*\*
- Organize Directives (`ctrl+alt+o`) has been added

# v0.7.0

- Workspace symbol search (`Ctrl+T`) now includes more symbols from your workspace including imported packages
- Document symbol list/search has been implemented (`Ctrl+Shift+O`)
- Document highlights have been implemented (selected a symbol will highlight other instances)
- Commands for `pub get` and `pub ugprade` have been added
- Errors and warnings from files that are deleted when not open will no longer hang around in the problems view

# v0.6.2

- Find References (`Shift+F12`) has been added
- Open files are given higher priority for analysis operations
- The extension no longer tries (and fails) to analyze open files that are outside of workspace folder

Additionally, a new option `dart.allowAnalytics` was added to control if analytics are sent. Only very basic events are captured (such as extension activation and if you toggle certain features) and are sent along with the extention version/platform. No code, filenames, project names or personal information will be sent. Source code for all analytics is visible [here](https://github.com/DanTup/Dart-Code/blob/master/src/analytics.ts).

# v0.6.1

- A new option `dart.showTodos` (default: `true`) has been added to show/hide TODO messages from the Problems list
- "Analyzing…" will now show in the status bar when files are being analyzed
- Go to Definition is now supported within your project (though does not yet work with SDK classes)
- The Dart SDK version number will now show in the bottom right status bar
- Dart files will automatically be set to 2-space indenting when you open them
- A new option `dart.setIndentation` (default: `true`) has been added to enable/disable automatic indent settings 
- Symbol search is now case-insensitive and also supports better filtering (eg. "TA" will match "TwitterApi")
- Tooltips reading `undefined` will no longer appear for some items (eg. string literals)
- Tooltip formatting/display has been greatly improved

# v0.5.2

- SDK detection is more reliable on Linux/Mac
- Name changed from "Dart-Code" to "Dart Code"
- Setting added to control line-width passed to formatter
- Last used SDK path is cached to improve startup performance
- Tooltip hovers now indicate the range that they apply to
- Braces/quotes now automatically close
- Pressing enter between a set of braces will automatically indent

# v0.1.0

- Syntax highlighting
- Code-completion
- Diagnostics (errors/warnings/hints)
- Workspace-wide symbol search
- Reformatting document
- Tooltips
