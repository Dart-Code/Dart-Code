Dart-Code is a Visual Studio Code extension that provides rich support for the Dart language and Flutter framework.

## Getting Started

### Prerequisites and Setup

- Node.js v22
- Dart SDK (stable)
- npm

All prerequisites have already been installed and set up by the copilot-setup-steps.yml workflow.

## NPM Scripts

- `npm run lint` — Lint the codebase using ESLint. This should be run to ensure no errors before committing changes.
- `npm run build` — Build the extension. This should be run to ensure no build errors before committing changes.
- `BOT=dart && npm test` — Run the basic Dart tests. This should be run to ensure basica extension functionality works before committing changes.

## Contributing

- Main extension entry point: `src/extension/extension.ts`
- Source code is organized into `src/extension`, `src/shared`, `src/test`, and `src/tool`.
- `src/debug` is the legacy debug adapter that generally should not be modified. This has been superseded by the new Debug Adapter implementations in the Dart and Flutter SDKs.
- There should be no lint errors, build errors, or test failures when comitting code unless there is no way for you to resolve them.
