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
- Organise Directives (`ctrl+alt+o`) has been added

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