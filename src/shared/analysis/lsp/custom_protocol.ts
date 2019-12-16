import { Location, NotificationType, Range, RequestType, TextDocumentPositionParams } from "vscode-languageclient";

export class AnalyzerStatusNotification {
	public static type = new NotificationType<AnalyzerStatusParams, void>("$/analyzerStatus");
}

export interface AnalyzerStatusParams {
	readonly isAnalyzing: boolean;
}

export class PublishClosingLabelsNotification {
	public static type = new NotificationType<ClosingLabelsParams, void>("dart/textDocument/publishClosingLabels");
}

export class PublishOutlineNotification {
	public static type = new NotificationType<OutlineParams, void>("dart/textDocument/publishOutline");
}

export class PublishFlutterOutlineNotification {
	public static type = new NotificationType<FlutterOutlineParams, void>("dart/textDocument/publishFlutterOutline");
}

export class SuperRequest {
	public static type = new RequestType<TextDocumentPositionParams, Location | null, void, void>("dart/textDocument/super");
}

export class DiagnosticServerRequest {
	public static type = new RequestType<void, { port: number }, void, void>("dart/diagnosticServer");
}

export interface ClosingLabelsParams {
	readonly uri: string;
	readonly labels: ClosingLabel[];
}

export interface ClosingLabel {
	readonly label: string;
	readonly range: Range;
}

export interface OutlineParams {
	readonly uri: string;
	readonly outline: Outline;
}

export interface Outline {
	readonly element: Element;
	readonly range: Range;
	readonly codeRange: Range;
	readonly children: Outline[] | undefined;
}

export interface FlutterOutlineParams {
	readonly uri: string;
	readonly outline: FlutterOutline;
}

export interface FlutterOutline {
	readonly dartElement: Element | undefined;
	readonly range: Range;
	readonly codeRange: Range;
	readonly children: FlutterOutline[] | undefined;
	readonly kind: string;
}

export interface Element {
	readonly name: string;
	readonly range: Range | undefined;
	readonly kind: string;
}
