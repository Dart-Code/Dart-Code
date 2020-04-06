"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		return this.applyWithWalker(new NoNonSharedCode(sourceFile, this.getOptions()));
	}
}
Rule.DEBUG_FAILURE_STRING = "Do not import debugger code because it is expected to run in another process.";
Rule.EXTENSION_FAILURE_STRING = "Do not import extension code because the extension packing will mean duplicate definitions and state.";

class NoNonSharedCode extends Lint.RuleWalker {
	visitImportDeclaration(node) {
		// TODO: Remove first part of this condition when DAs are not running in process.
		// https://github.com/Dart-Code/Dart-Code/issues/1876
		if (this.sourceFile.fileName.indexOf("debug_config_provider") === -1
			&& node.moduleSpecifier.text.indexOf("../debug/") !== -1) {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.DEBUG_FAILURE_STRING));
		}

		if (node.moduleSpecifier.text.indexOf("../extension/") !== -1) {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.EXTENSION_FAILURE_STRING));
		}
	}
}

exports.Rule = Rule;
