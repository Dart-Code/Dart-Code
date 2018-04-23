import { Analyzer } from "../analysis/analyzer";
import { DiagnosticCollection, Diagnostic, DiagnosticSeverity, Uri, Range, Position } from "vscode";
import { toRange } from "../utils";
import { config } from "../config";
import * as as from "../analysis/analysis_server_types";

export class DartDiagnosticProvider {
	private analyzer: Analyzer;
	private diagnostics: DiagnosticCollection;
	constructor(analyzer: Analyzer, diagnostics: DiagnosticCollection) {
		this.analyzer = analyzer;
		this.diagnostics = diagnostics;

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
		const message = ((error.type === "HINT" || error.type === "LINT") && config.showLintNames ? `${error.code}: ` : "") + error.message;
		const diag = new Diagnostic(
			toRange(error.location),
			message,
			DartDiagnosticProvider.getSeverity(error.severity, error.type),
		);
		diag.code = error.code;
		diag.source = "dart";
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

	private flushResults(notification: as.AnalysisFlushResultsNotification) {
		const entries = notification.files.map<[Uri, Diagnostic[]]>((file) => [Uri.file(file), undefined]);
		this.diagnostics.set(entries);
	}
}
