export type FlutterErrorData = DiagnosticsNode;

export interface DiagnosticsNode {
	type: DiagnosticsNodeType;
	description: string;
	name: string;
	showName: boolean | undefined;
	showSeparator: boolean | undefined;
	properties: DiagnosticsNode[];
	children: DiagnosticsNode[];
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
