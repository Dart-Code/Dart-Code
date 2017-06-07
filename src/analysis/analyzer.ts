"use strict";

import * as vs from "vscode";
import * as child_process from "child_process";
import * as as from "./analysis_server_types";
import * as fs from "fs";
import { AnalyzerGen } from "./analyzer_gen";
import { config } from "../config";
import { log, logError, extensionVersion } from "../utils";
import { Request, UnknownResponse, UnknownNotification } from "../services/stdio_service";

export class Analyzer extends AnalyzerGen {
	private observatoryPort = config.analyzerObservatoryPort;
	private diagnosticsPort = config.analyzerDiagnosticsPort;
	private additionalArgs = config.analyzerAdditionalArgs;
	private lastDiagnostics: as.ContextData[];
	private launchArgs: string[];

	constructor(dartVMPath: string, analyzerPath: string) {
		super(config.analyzerLogFile);

		let args = [];

		// Optionally start Observatory for the analyzer.
		if (this.observatoryPort)
			args.push(`--observe=${this.observatoryPort}`);

		args.push(analyzerPath);

		// Optionally start the analyzer's diagnostic web server on the given port.
		if (this.diagnosticsPort)
			args.push(`--port=${this.diagnosticsPort}`);

		// Add info about the extension that will be collected for crash reports etc.
		args.push(`--client-id=DanTup.dart-code`);
		args.push(`--client-version=${extensionVersion}`);

		// The analysis server supports a verbose instrumentation log file.
		if (config.analyzerInstrumentationLogFile)
			args.push(`--instrumentation-log-file=${config.analyzerInstrumentationLogFile}`);

		// Allow arbitrary args to be passed to the analysis server.
		if (this.additionalArgs)
			args = args.concat(this.additionalArgs);

		this.launchArgs = args.slice(1); // Trim the first one as it's just snapshot path.
		log(`Starting ${analyzerPath} with args: ` + this.launchArgs.join(' '));

		this.createProcess(dartVMPath, args);

		this.serverSetSubscriptions({
			subscriptions: ["STATUS"]
		});

		// Hook error subscriptions so we can try and get diagnostic info if this happens.
		this.registerForServerError(e => this.requestDiagnosticsUpdate());
		this.registerForRequestError(e => this.requestDiagnosticsUpdate());
	}

	protected sendMessage<T>(json: string) {
		try {
			super.sendMessage(json);
		}
		catch (e) {
			const reloadAction: string = "Reload Project";
			vs.window.showErrorMessage(`The Dart Analyzer has terminated. Save your changes then reload the project to resume.`, reloadAction).then(res => {
				if (res == reloadAction)
					vs.commands.executeCommand("workbench.action.reloadWindow");
			});
			throw e;
		}
	}

	private requestDiagnosticsUpdate() {
		this.lastDiagnostics = null;

		// New drive is default in SDK 1.22, so just skip this until it has diagnostics implemented.
		// See https://github.com/Dart-Code/Dart-Code/issues/244
		return;

		// this.diagnosticGetDiagnostics()
		// 	.then(resp => this.lastDiagnostics = resp.contexts);
	}

	getLastDiagnostics(): as.ContextData[] {
		return this.lastDiagnostics;
	}

	getAnalyzerLaunchArgs(): string[] {
		return this.launchArgs;
	}
}

export function getSymbolKindForElementKind(kind: as.ElementKind): vs.SymbolKind {
	// TODO: Review if these are all mapped as well as possible.
	switch (kind) {
		case "CLASS":
			return vs.SymbolKind.Class;
		case "CLASS_TYPE_ALIAS":
			return vs.SymbolKind.Class;
		case "COMPILATION_UNIT":
			return vs.SymbolKind.Module;
		case "CONSTRUCTOR":
			return vs.SymbolKind.Constructor;
		case "ENUM":
			return vs.SymbolKind.Enum;
		case "ENUM_CONSTANT":
			return vs.SymbolKind.Enum;
		case "FIELD":
			return vs.SymbolKind.Field;
		case "FILE":
			return vs.SymbolKind.File;
		case "FUNCTION":
			return vs.SymbolKind.Function;
		case "FUNCTION_TYPE_ALIAS":
			return vs.SymbolKind.Function;
		case "GETTER":
			return vs.SymbolKind.Property;
		case "LABEL":
			return vs.SymbolKind.Module;
		case "LIBRARY":
			return vs.SymbolKind.Namespace;
		case "LOCAL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "METHOD":
			return vs.SymbolKind.Method;
		case "PARAMETER":
			return vs.SymbolKind.Variable;
		case "PREFIX":
			return vs.SymbolKind.Variable;
		case "SETTER":
			return vs.SymbolKind.Property;
		case "TOP_LEVEL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "TYPE_PARAMETER":
			return vs.SymbolKind.Variable;
		case "UNIT_TEST_GROUP":
			return vs.SymbolKind.Module;
		case "UNIT_TEST_TEST":
			return vs.SymbolKind.Method;
		case "UNKNOWN":
			return vs.SymbolKind.Object;
		default:
			throw new Error("Unknown kind: " + kind);
	}
}
