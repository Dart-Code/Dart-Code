"use strict";

import { ExtensionContext } from "vscode";

export class Context {
	private context: ExtensionContext;

	private constructor(context: ExtensionContext) {
		this.context = context;
	}

	public static for(context: ExtensionContext): Context {
		return new Context(context);
	}

	get newFlutterProject() { return this.context.globalState.get("newFlutterProject") as string; }
	set newFlutterProject(value: string) { this.context.globalState.update("newFlutterProject", value); }
}
