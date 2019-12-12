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
