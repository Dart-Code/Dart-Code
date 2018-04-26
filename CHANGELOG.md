# v2.12.0

## Support for Flutter Profile and Release Modes

You can now create launch configurations for `profile` and `release` modes in Flutter apps. For now, this requires you to create a `launch.json` and add the setting there..

<img src="https://dartcode.org/images/release_notes/v2.12/flutter_modes.png" width="700" height="319" />

For more information on using profile and release modes, see [Running Flutter Apps in Profile or Release Modes](/docs/running-flutter-apps-in-profile-or-release-modes/).

## Flutter Memory Usage Monitoring

When running a `profile` build (or if you set [`showMemoryUsage`](/docs/running-flutter-apps-in-profile-or-release-modes/) in your launch configuration) the total memory for your applications heaps will be shown in the status bar.

<img src="https://dartcode.org/images/release_notes/v2.12/flutter_memory_usage.png" width="229" height="79" />

Note: This is heap usage and not total process memory. In debug builds it may not be reflective of actual usage in a release build.

## Progress Notifications for Long Running Tasks

Long running tasks like [`Flutter: Get Packages`](/docs/commands/#flutter-get-packages) and Flutter builds will now show more obvious progress notifications with progress animations.

<img src="https://dartcode.org/images/release_notes/v2.12/long_running_tasks.png" width="700" height="155" />

As part of this, these actions may also now be cancelled from the `x` in the notification.

## Flutter Icons in Tooltips and Completion Descriptions

Flutter icons now show correctly in tooltips and completion descriptions instead of chunks of HTML.

<img src="https://dartcode.org/images/release_notes/v2.12/flutter_icons.png" width="700" height="256" />

## Extract Widget Refactor

An `Extract Widget` refactor is now available on the lightbulb menu that creates a new Widget class and inserts a call to its constructor in the original position.

<img src="https://dartcode.org/images/release_notes/v2.12/extract_widget.png" width="700" height="330" />

## Extract Method Refactor

An `Extract Method` refactor is now available on the lightbulb menu.

<img src="https://dartcode.org/images/release_notes/v2.12/extract_method.png" width="700" height="320" />

## Better Feedback for Failed Renames

Failed renames will now show errors directly in the editor instead of window-scoped notifications that require dismissing. In an upcoming VS Code release we will gain the ability to block the rename input box from appearing at a location that does not support a rename.

<img src="https://dartcode.org/images/release_notes/v2.12/rename_message.png" width="350" height="144" />

## Preview: Better Handling of Windows Paths

A new setting (`dart.previewExperimentalWindowsDriveLetterHandling`) has been added. Setting this value to `true` will cause all drive letters to be converted to uppercase when Dart Code interacts with services like the analysis server. This *should* fix a number of issues affecting Windows users (unexpected errors like `Type 'x' cannot be assigned to type 'x' or completion and errors not updating when referencing code with `package:` imports). In future this behaviour may become the default so please try it out and send feedback!

## Other Changes

- Exception messages shown in popups during debugging are no longer truncated
- Pressing `F5` in a Flutter project will no longer pick `bin/main.dart` to execute over `lib/main.dart`
- More output from `flutter run` will be shown in Debug Console
- The display of lists and maps in the debugger variables pane has been improved
- The `Add to Watch` action on variables (in the debugger variables pane) will now correctly populate watch expressions
- `Slow Mode Banner` is now known as `Debug Mode Banner`
- [@343max](https://github.com/343max) contributed a [`dart.flutterSelectDeviceWhenConnected`](/docs/settings/#dartflutterselectdevicewhenconnected) setting to control whether to automatically select the most recently connected device in Flutter projects
- Organize Imports is now bound to `Alt`+`Shift`+`O` by default
- A new [`dart.organizeDirectivesOnSave`](/docs/settings/#dartorganizedirectivesonsave) setting has been added
- CPU usage while moving the caret/selection around the editor should be much lower
- Code's automatic indentation detection will be disabled for Dart since sometimes it picks 4 spaces based on line contiuation indenting
- A new [`Go to Super Method`](/docs/commands/#dart-go-to-super-method) command has been added
- `Find References` will now also include the decleration
- TODOs will once again appear in the Problems pane if you set the `dart.showTodos` setting
- Formatting of the hover tooltips has been improved
- Tooltips will no longer show on import prefixes (as the information displayed was useless)
- Duplicate code fixes will no longer show in the lightbulb menu when there are multiple on the same line
- [@aemino](https://github.com/aemino) contributed a fix for ligatures not working correctly on `=>` due to them being considered individual tokens
- Analysis of AngularDart now enabled by default (requires a v2 dev SDK) and can be controlled with the [dart.analyzeAngularTemplates](/docs/settings/#dartanalyzeangulartemplates) setting.
- The error message shown when the analysis server fails to start will now be more appropriate

# Past Versions

For full release notes of previous versions, see [dartcode.org/releases](https://dartcode.org/releases/).
