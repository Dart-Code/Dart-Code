// This is currently a string because a Symbol seems to have become broken in
// VS Code. We can revert this if it gets fixed.
// https://github.com/Microsoft/vscode/issues/57513
export const internalApiSymbol = "private-API"; // Symbol();
