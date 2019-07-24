export interface FlutterErrorData extends DiagnosticsNode {
	errorsSinceReload: number | undefined;
}

export interface DiagnosticsNode {
	type: DiagnosticsNodeType;
	level: DiagnosticsNodeLevel;
	description: string;
	name: string;
	showName: boolean | undefined;
	showSeparator: boolean | undefined;
	properties: DiagnosticsNode[];
	children: DiagnosticsNode[];
	style: DiagnosticsNodeStyle;
}

// If we have per-type properties, handle them like this.
// export interface DescriptionDiagnosticsNode {
// 	type: DiagnosticsNodeType.ErrorDescription;
// }

export enum DiagnosticsNodeType {
	ErrorDescription = "ErrorDescription",
	ErrorSpacer = "ErrorSpacer",
	DiagnosticsStackTrace = "DiagnosticsStackTrace",
}

export enum DiagnosticsNodeLevel {
	Error = "error",
	Summary = "summary",
	Hint = "hint",
}

export enum DiagnosticsNodeStyle {
	Flat = "flat",
	Shallow = "shallow",
}
