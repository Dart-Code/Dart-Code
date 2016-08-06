"use strict";

import { DiagnosticCollection, Diagnostic, DiagnosticSeverity, Uri, Range, Position } from "vscode";
import { Analyzer } from "./analyzer";
import { toRange } from "./utils";
import * as as from "./analysis_server_types";

export class DartDiagnosticProvider {
	private analyzer: Analyzer;
	private diagnostics: DiagnosticCollection;
	constructor(analyzer: Analyzer, diagnostics: DiagnosticCollection) {
		this.analyzer = analyzer;
		this.diagnostics = diagnostics;

		this.analyzer.registerForAnalysisErrors(es => this.handleErrors(es));
	}

	private handleErrors(notification: as.AnalysisErrorsNotification) {
		this.diagnostics.set(
			Uri.file(notification.file), 
			notification.errors.map(e => this.createDiagnostic(e))
		);
	}

	private createDiagnostic(error: as.AnalysisError): Diagnostic {
		return {
			code: error.code,
			message: error.message,
			range: toRange(error.location),
			severity: this.getSeverity(error.severity),
			source: error.type
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
}