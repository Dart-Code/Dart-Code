"use strict";

import * as vs from "vscode";
import { FlutterWidgetItem } from "../flutter/flutter_outline_view";

export const flutterOutlineCommands = [
	"refactor.flutter.wrap.center",
	"refactor.flutter.wrap.padding",
	"refactor.flutter.wrap.column",
	"refactor.flutter.move.up",
	"refactor.flutter.move.down",
	"refactor.flutter.removeWidget",
];

export class FlutterOutlineCommands {
	constructor(private readonly tree: vs.TreeView<FlutterWidgetItem>, context: vs.ExtensionContext) {
		for (const id of flutterOutlineCommands) {
			context.subscriptions.push(
				vs.commands.registerCommand("_flutter.outline." + id, () => this.applyRefactoring(id)),
			);
		}
	}

	private applyRefactoring(refactorType: string): void {
		if (!this.tree.selection || this.tree.selection.length !== 1) {
			console.error(`Invalid selection when running Flutter Outline refactor: ${refactorType}`);
			return;
		}

		const widget = this.tree.selection[0];
		const fix = widget.fixes.filter((f) => f.command).find((f) => f.kind.value.endsWith(refactorType));
		if (fix) {
			vs.commands.executeCommand(fix.command.command, ...fix.command.arguments);
		} else {
			console.error(`Unable to find command for Flutter Outline: ${refactorType}`);
		}
	}
}
