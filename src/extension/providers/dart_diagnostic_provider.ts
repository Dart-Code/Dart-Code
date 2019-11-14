import { Diagnostic, DiagnosticCollection, DiagnosticRelatedInformation, DiagnosticSeverity, DiagnosticTag, Location, Range, Uri } from "vscode";
import * as as from "../../shared/analysis_server_types";
import { toRangeOnLine } from "../../shared/vscode/utils";
import { DasAnalyzerClient } from "../analysis/analyzer_das";
import { config } from "../config";

// TODO: This is not a provider?
export class DartDiagnosticProvider {
	private lastErrorJson: string | undefined;
	constructor(private readonly analyzer: DasAnalyzerClient, private readonly diagnostics: DiagnosticCollection) {
		this.analyzer.registerForAnalysisErrors((es) => this.handleErrors(es));

		// Fired when files are deleted
		this.analyzer.registerForAnalysisFlushResults((es) => this.flushResults(es));
	}

	private handleErrors(notification: as.AnalysisErrorsNotification) {
		const notificationJson = JSON.stringify(notification);

		// As a workaround for https://github.com/Dart-Code/Dart-Code/issues/1678, if
		// the errors we got are exactly the same as the previous set, do not give
		// them to VS Code. This avoids a potential loop of refreshing the error view
		// which triggers a request for Code Actions, which could result in analysis
		// of the file (which triggers errors to be sent, which triggers a refresh
		// of the error view... etc.!).
		if (this.lastErrorJson === notificationJson) {
			// TODO: Come up with a better fix than this!
			// log("Skipping error notification as it was the same as the previous one");
			return;
		}

		let errors = notification.errors;
		if (!config.showTodos)
			errors = errors.filter((error) => error.type !== "TODO");
		this.diagnostics.set(
			Uri.file(notification.file),
			errors.map((e) => DartDiagnosticProvider.createDiagnostic(e)),
		);
		this.lastErrorJson = notificationJson;
	}

	public static createDiagnostic(error: as.AnalysisError): Diagnostic {
		const diag = new DartDiagnostic(
			toRangeOnLine(error.location),
			error.message,
			DartDiagnosticProvider.getSeverity(error.severity, error.type),
			error.type,
		);
		diag.code = error.code;
		diag.source = "dart";
		diag.tags = DartDiagnosticProvider.getTags(error);
		if (error.correction)
			diag.message += `\n${error.correction}`;
		if (error.contextMessages && error.contextMessages.length)
			diag.relatedInformation = error.contextMessages.map(DartDiagnosticProvider.createRelatedInformation);
		return diag;
	}

	public static createRelatedInformation(related: as.DiagnosticMessage) {
		return new DiagnosticRelatedInformation(
			new Location(
				Uri.file(related.location.file),
				toRangeOnLine(related.location),
			),
			related.message,
		);
	}

	public static getSeverity(severity: as.AnalysisErrorSeverity, type: as.AnalysisErrorType): DiagnosticSeverity {
		switch (severity) {
			case "ERROR":
				return DiagnosticSeverity.Error;
			case "WARNING":
				return DiagnosticSeverity.Warning;
			case "INFO":
				switch (type) {
					case "TODO":
						return DiagnosticSeverity.Information; // https://github.com/Microsoft/vscode/issues/48376
					default:
						return DiagnosticSeverity.Information;
				}
			default:
				throw new Error("Unknown severity type: " + severity);
		}
	}

	public static getTags(error: as.AnalysisError): DiagnosticTag[] {
		const tags: DiagnosticTag[] = [];
		if (error.code === "dead_code" || error.code === "unused_local_variable" || error.code === "unused_import")
			tags.push(DiagnosticTag.Unnecessary);
		if (error.code === "deprecated_member_use" || error.code === "deprecated_member_use_from_same_package")
			tags.push(DiagnosticTag.Deprecated);
		return tags;
	}

	private flushResults(notification: as.AnalysisFlushResultsNotification) {
		this.lastErrorJson = undefined;
		const entries = notification.files.map<[Uri, Diagnostic[] | undefined]>((file) => [Uri.file(file), undefined]);
		this.diagnostics.set(entries);
	}
}

export class DartDiagnostic extends Diagnostic {
	constructor(
		range: Range,
		message: string,
		severity: DiagnosticSeverity,
		public readonly type: string,
	) {
		super(range, message, severity);
	}
}
