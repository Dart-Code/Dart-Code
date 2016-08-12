# Contributing to Dart Code

[![Linux & Mac build status](https://travis-ci.org/Dart-Code/Dart-Code.svg?branch=master)](https://travis-ci.org/Dart-Code/Dart-Code)
[![Windows build status](https://ci.appveyor.com/api/projects/status/github/Dart-Code/Dart-Code?svg=true)](https://ci.appveyor.com/api/projects/status/github/Dart-Code/Dart-Code)

## Issues

[Create an issue](https://github.com/Dart-Code/Dart-Code/issues/new) for bugs, questions, suggestions or other feedback. Please try to keep one issue per item. All feedback is appreciated! Please try to include as much information as possible and a screenshot if appropriate.

## Code

If you're going to work on an issue, please add a comment to the issue so others know it's being looked at. If there isn't an issue for the work you want to do, please create one. The [up-for-grabs](https://github.com/Dart-Code/Dart-Code/labels/up-for-grabs) issues might make good starting points for new contributors.

- If you end up with a large number of commits for tidying up/fixing, consider squashing
- Try to keep the bulk of work out of `extension.ts` by creating new files/classes but do keep the wire-up code in `extension.ts` as a central place to know what's set up
- Try not to force functionality on users, add options to disable things that everyone might not want (eg. TODOs and Linting in problems view)
- Code Style
  - Use PascalCase for type names
  - Do not use `I` as a prefix for interface names
  - Use PascalCase for enum values
  - Use camelCase for function names
  - Use camelCase for property names and local variables
  - Do not use `_` as a prefix for private properties
  - Use whole words in names when possible
  - Prefer double quotes `"` over single quotes `'` as they're easier to distinguise from backticks `` ` `` (which TS uses for Template Strings)
  - Prefer positively-named booleans/settings (`showTodos`) and set defaults accordingly rather than negatively-named (`disableLogging`) to avoid double-negatives (`if (!disableLogging) { log(); }`).
  - Indent with tabs
  - Reformat files (`Alt+Shift+F`) before committing
  - Use arrow functions over anonymous function expressions
  - Only surround arrow function parameters with parens when necessary
