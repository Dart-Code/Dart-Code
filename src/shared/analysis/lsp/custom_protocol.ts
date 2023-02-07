import { Location, NotificationType, Range, RequestType, RequestType0, TextDocumentPositionParams, WorkspaceEdit } from "vscode-languageclient";

export class AnalyzerStatusNotification {
	public static type = new NotificationType<AnalyzerStatusParams>("$/analyzerStatus");
}

export interface AnalyzerStatusParams {
	readonly isAnalyzing: boolean;
}

export class PublishClosingLabelsNotification {
	public static type = new NotificationType<ClosingLabelsParams>("dart/textDocument/publishClosingLabels");
}

export class PublishOutlineNotification {
	public static type = new NotificationType<OutlineParams>("dart/textDocument/publishOutline");
}

export class PublishFlutterOutlineNotification {
	public static type = new NotificationType<FlutterOutlineParams>("dart/textDocument/publishFlutterOutline");
}

export class SuperRequest {
	public static type = new RequestType<TextDocumentPositionParams, Location | null, void>("dart/textDocument/super");
}

export class DiagnosticServerRequest {
	public static type = new RequestType0<{ port: number }, void>("dart/diagnosticServer");
}

export class RunThroughputBenchmarkRequest {
	public static type = new RequestType<{ kind: string, data?: string }, void, void>("dart/throughputBenchmark");
}

export class ReanalyzeRequest {
	public static type = new RequestType0<void, void>("dart/reanalyze");
}

export class CompleteStatementRequest {
	public static type = new RequestType<TextDocumentPositionParams, WorkspaceEdit | null, void>("dart/completeStatement");
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
	readonly attributes?: FlutterOutlineAttribute[];
	readonly variableName?: string;
	readonly className?: string;
	readonly label?: string;
	readonly dartElement?: Element;
	readonly range: Range;
	readonly codeRange: Range;
	readonly children?: FlutterOutline[];
	readonly kind: string;
}

export interface FlutterOutlineAttribute {
	name: string;
	label: string;
	valueRange: Range;
}

export interface Element {
	readonly name: string;
	readonly range: Range | undefined;
	readonly kind: string;
	readonly parameters?: string;
	readonly typeParameters?: string;
	readonly returnType?: string;
}
