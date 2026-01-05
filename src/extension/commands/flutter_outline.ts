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

	private async applyRefactoring(refactorType: string): Promise<void> {
		if (this.tree.selection?.length !== 1) {
			console.error(`Invalid selection when running Flutter Outline refactor: ${refactorType}`);
			return;
		}

		const widget = this.tree.selection[0];
		const fix = widget.fixes.find((f) => f.kind?.value.endsWith(refactorType));
		if (fix) {
			if (fix.command?.arguments)
				await vs.commands.executeCommand(fix.command.command, ...fix.command.arguments); // eslint-disable-line @typescript-eslint/no-unsafe-argument
			else if (fix.edit)
				await vs.workspace.applyEdit(fix.edit);
			else
				console.error(`Flutter Outline fix was missing command/arguments`);
		} else {
			console.error(`Unable to find command for Flutter Outline: ${refactorType}`);
		}
	}
}
