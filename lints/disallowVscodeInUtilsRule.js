"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		if (sourceFile.fileName.indexOf("src/extension/utils/") !== -1 && sourceFile.fileName.indexOf("src/extension/utils/vscode/") === -1) {
			return this.applyWithWalker(new NoVsCodeInUtils(sourceFile, this.getOptions()));
		}
	}
}
Rule.FAILURE_STRING = "Do not import vscode into utils files that are not in utils/vscode as when imported into the Debug Adapters they may run in a separate process to VS Code.";

class NoVsCodeInUtils extends Lint.RuleWalker {
	visitImportDeclaration(node) {
		if (node.moduleSpecifier.text === "vscode") {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.FAILURE_STRING));
		}
	}
}

exports.Rule = Rule;
