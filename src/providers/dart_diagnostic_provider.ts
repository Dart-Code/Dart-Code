import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, DiagnosticTag, Uri } from "vscode";
import * as as from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { config } from "../config";
import { toRangeOnLine } from "../utils";

// TODO: This is not a provider?
export class DartDiagnosticProvider {
	constructor(private readonly analyzer: Analyzer, private readonly diagnostics: DiagnosticCollection) {
		this.analyzer.registerForAnalysisErrors((es) => this.handleErrors(es));

		// Fired when files are deleted
		this.analyzer.registerForAnalysisFlushResults((es) => this.flushResults(es));
	}

	private handleErrors(notification: as.AnalysisErrorsNotification) {
		let errors = notification.errors;
		if (!config.showTodos)
			errors = errors.filter((error) => error.type !== "TODO");
		this.diagnostics.set(
			Uri.file(notification.file),
			errors.map((e) => DartDiagnosticProvider.createDiagnostic(e)),
		);
	}

	public static createDiagnostic(error: as.AnalysisError): Diagnostic {
		const diag = new DartDiagnostic(
			toRangeOnLine(error.location),
			error.message,
			DartDiagnosticProvider.getSeverity(error.severity, error.type),
		);
		diag.code = error.code;
		diag.source = "dart";
		diag.tags = DartDiagnosticProvider.getTags(error);
		diag.type = error.type;
		return diag;
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
		return tags;
	}

	private flushResults(notification: as.AnalysisFlushResultsNotification) {
		const entries = notification.files.map<[Uri, Diagnostic[]]>((file) => [Uri.file(file), undefined]);
		this.diagnostics.set(entries);
	}
}

export class DartDiagnostic extends Diagnostic {
	public type: string;
}
