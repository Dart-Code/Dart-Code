"use strict";

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

		this.analyzer.registerForAnalysisErrors(es => this.handleErrors(es));

		// Fired when files are deleted
		this.analyzer.registerForAnalysisFlushResults(es => this.flushResults(es));
	}

	private handleErrors(notification: as.AnalysisErrorsNotification) {
		let errors = notification.errors;
		if (!config.showTodos)
			errors = errors.filter((error) => error.type != "TODO");
		this.diagnostics.set(
			Uri.file(notification.file), 
			errors.map(e => this.createDiagnostic(e))
		);
	}

	private createDiagnostic(error: as.AnalysisError): Diagnostic {
		return {
			code: error.code,
			message: error.message,
			range: toRange(error.location),
			severity: this.getSeverity(error.severity),
			source: "dart"
		};
	}

	private getSeverity(severity: as.AnalysisErrorSeverity): DiagnosticSeverity {
		switch (severity) {
			case "ERROR":
				return DiagnosticSeverity.Error;
			case "WARNING":
				return DiagnosticSeverity.Warning;
			case "INFO":
				return DiagnosticSeverity.Information;
			default:
				throw new Error("Unknown severity type: " + severity); 
		}
	}

	private flushResults(notification: as.AnalysisFlushResultsNotification) {
		let entries = notification.files.map<[Uri, Diagnostic[]]>(file => [Uri.file(file), undefined]);
		this.diagnostics.set(entries);
	}
}