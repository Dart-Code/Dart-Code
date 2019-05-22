"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		if (sourceFile.fileName.indexOf("src/test/") !== -1) {
			return this.applyWithWalker(new NoExtensionCodeInTests(sourceFile, this.getOptions()));
		}
	}
}
Rule.FAILURE_STRING = "Do not import extension code into test files because the extension packing will mean duplicate definitions and state.";

class NoExtensionCodeInTests extends Lint.RuleWalker {
	visitImportDeclaration(node) {
		if (node.moduleSpecifier.text.indexOf("../extension/") !== -1) {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.FAILURE_STRING));
		}
	}
}

exports.Rule = Rule;
