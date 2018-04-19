"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const Lint = require("tslint");

class Rule extends Lint.Rules.AbstractRule {
	apply(sourceFile) {
		return this.applyWithWalker(new NoFsPathWalker(sourceFile, this.getOptions()));
	}
}
Rule.FAILURE_STRING = "Do not use Uri.fsPath, use fsPath() instead";

class NoFsPathWalker extends Lint.RuleWalker {
	visitPropertyAccessExpression(node) {
		if (node.name.text === "fsPath") {
			this.addFailure(this.createFailure(node.getStart(), node.getWidth(), Rule.FAILURE_STRING));
		}
		super.visitPropertyAccessExpression(node);
	}
}

exports.Rule = Rule;
