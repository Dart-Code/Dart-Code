# Dart-Code Documentation

This folder contains maintainer and contributor documentation for the Dart-Code and Flutter VS Code extensions, serving as the source of truth for high-level concepts, processes, and design decisions.

> **Maintaining these docs:** Keep documentation high-level and focused on concepts, invariants, and *why* decisions were made rather than duplicating implementation details from code. Whenever a change alters documented behavior or introduces an important new design decision, update the relevant doc (and ensure any new doc is indexed below) in the same PR.

## Contents

- **[Releasing (Step-by-Step Guide)](releasing.md)**: Instructions for maintainers performing a pre-release, stable minor release, or patch release, as well as how to recover from a failed release run.
- **[Release Process (Technical Details)](release-process.md)**: Technical overview of how the versioning scheme, `.github/workflows/release.yml`, safety guards, and VS Code Marketplace Trusted Publishing work under the hood.
