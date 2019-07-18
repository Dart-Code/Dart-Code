"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		if (sourceFile.fileName.indexOf("src/extension/") === -1 && sourceFile.fileName.indexOf("src/test/") === -1 && sourceFile.fileName.indexOf("/vscode") === -1) {
			return this.applyWithWalker(new NoVsCode(sourceFile, this.getOptions()));
		}
	}
}
Rule.FAILURE_STRING = "Do not import vscode/dependent code into files that are not in a vscode folder or the extension folder.";

class NoVsCode extends Lint.RuleWalker {
	visitImportDeclaration(node) {
		if (node.moduleSpecifier.text === "vscode" || node.moduleSpecifier.text.indexOf("/vscode") !== -1) {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.FAILURE_STRING));
		}
	}
}

exports.Rule = Rule;
