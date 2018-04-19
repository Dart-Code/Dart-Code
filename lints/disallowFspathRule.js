"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		return this.applyWithWalker(new NoFsPathWalker(sourceFile, this.getOptions()));
	}
}
Rule.FAILURE_STRING = "Do not use Uri.fsPath or TextDocument.fileName because they lowercase Windows drive letters causing issues with interop with other tools. Use fsPath(uri) instead.";

class NoFsPathWalker extends Lint.RuleWalker {
	visitPropertyAccessExpression(node) {
		// TODO: Figure out how to get parent type to avoid false positives.
		if (node.name.text === "fsPath" || node.name.text === "fileName") {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.FAILURE_STRING));
		}
		super.visitPropertyAccessExpression(node);
	}
}

exports.Rule = Rule;
