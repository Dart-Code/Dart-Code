"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

// These files aren't part of the debug adapters and
// TODO: should probably be separated into another folder at some point.
const excludedPaths = ["src/debug/flutter_run.ts", "src/debug/flutter_test.ts"]

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		if (sourceFile.fileName.indexOf("src/debug/") !== -1 && excludedPaths.indexOf(sourceFile.fileName) === -1) {
			return this.applyWithWalker(new NoVsCodeInDebuggers(sourceFile, this.getOptions()));
		}
	}
}
Rule.FAILURE_STRING = "Do not import vscode into debug adapters as they may be run in a separate process to VS Code.";

class NoVsCodeInDebuggers extends Lint.RuleWalker {
	visitImportDeclaration(node) {
		if (node.moduleSpecifier.text === "vscode") {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.FAILURE_STRING));
		}
	}
}

exports.Rule = Rule;
