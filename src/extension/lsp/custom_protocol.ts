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

export interface ClosingLabelsParams {
	readonly uri: string;
	readonly labels: ClosingLabel[];
}

export interface ClosingLabel {
	readonly label: string;
	readonly range: Range;
}
