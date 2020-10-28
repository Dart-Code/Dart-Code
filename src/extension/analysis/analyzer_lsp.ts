import * as path from "path";
import * as stream from "stream";
import { window } from "vscode";
import { LanguageClient, LanguageClientOptions, Location, StreamInfo, TextDocumentPositionParams, WorkspaceEdit } from "vscode-languageclient";
import { AnalyzerStatusNotification, CompleteStatementRequest, DiagnosticServerRequest, ReanalyzeRequest, SuperRequest } from "../../shared/analysis/lsp/custom_protocol";
import { Analyzer } from "../../shared/analyzer";
import { DartCapabilities } from "../../shared/capabilities/dart";
import { dartVMPath } from "../../shared/constants";
import { LogCategory } from "../../shared/enums";
import { DartSdks, Logger } from "../../shared/interfaces";
import { CategoryLogger } from "../../shared/logging";
import { WorkspaceContext } from "../../shared/workspace";
import { config } from "../config";
import { reportAnalyzerTerminatedWithError } from "../utils/misc";
import { safeToolSpawn } from "../utils/processes";
import { getAnalyzerArgs } from "./analyzer";
import { LspFileTracker } from "./file_tracker_lsp";

export class LspAnalyzer extends Analyzer {
	public readonly client: LanguageClient;
	public readonly fileTracker: LspFileTracker;

	constructor(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities, wsContext: WorkspaceContext) {
		super(new CategoryLogger(logger, LogCategory.Analyzer));
		this.client = createClient(this.logger, sdks, dartCapabilities, wsContext);
		this.fileTracker = new LspFileTracker(logger, this.client, wsContext);
		this.disposables.push(this.client.start());
		this.disposables.push(this.fileTracker);

		// tslint:disable-next-line: no-floating-promises
		this.client.onReady().then(() => {
			// Reminder: These onNotification calls only hold ONE handler!
			// https://github.com/microsoft/vscode-languageserver-node/issues/174
			this.client.onNotification(AnalyzerStatusNotification.type, (params) => {
				this.onAnalysisStatusChangeEmitter.fire({ isAnalyzing: params.isAnalyzing });
			});
			this.onReadyCompleter.resolve();
		});
	}

	public async getDiagnosticServerPort(): Promise<{ port: number }> {
		return this.client.sendRequest(DiagnosticServerRequest.type, undefined);
	}

	public async forceReanalyze(): Promise<void> {
		try {
			return await this.client.sendRequest(ReanalyzeRequest.type, undefined);
		} catch (e) {
			window.showErrorMessage("Reanalyze is not supported by this version of the Dart SDK's LSP server.");
		}
	}

	public async getSuper(params: TextDocumentPositionParams): Promise<Location | null> {
		return this.client.sendRequest(
			SuperRequest.type,
			params,
		);
	}

	public async completeStatement(params: TextDocumentPositionParams): Promise<WorkspaceEdit | null> {
		return this.client.sendRequest(
			CompleteStatementRequest.type,
			params,
		);
	}
}

function createClient(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities, wsContext: WorkspaceContext): LanguageClient {
	const clientOptions: LanguageClientOptions = {
		initializationOptions: {
			// 	onlyAnalyzeProjectsWithOpenFiles: true,
			closingLabels: config.closingLabels,
			flutterOutline: wsContext.hasAnyFlutterProjects,
			outline: true,
		},
		outputChannelName: "LSP",
	};

	const client = new LanguageClient(
		"dartAnalysisLSP",
		"Dart Analysis Server",
		() => spawnServer(logger, sdks, dartCapabilities),
		clientOptions,
	);

	return client;
}

function spawnServer(logger: Logger, sdks: DartSdks, dartCapabilities: DartCapabilities): Promise<StreamInfo> {
	// TODO: Replace with constructing an Analyzer that passes LSP flag (but still reads config
	// from paths etc) and provide it's process.
	const vmPath = path.join(sdks.dart, dartVMPath);
	const args = getAnalyzerArgs(logger, sdks, dartCapabilities, true);

	logger.info(`Spawning ${vmPath} with args ${JSON.stringify(args)}`);
	const process = safeToolSpawn(undefined, vmPath, args);
	logger.info(`    PID: ${process.pid}`);

	const reader = process.stdout.pipe(new LoggingTransform(logger, "<=="));
	const writer = new LoggingTransform(logger, "==>");
	writer.pipe(process.stdin);

	process.stderr.on("data", (data) => logger.error(data.toString()));
	process.on("exit", (code, signal) => {
		if (code)
			reportAnalyzerTerminatedWithError();
	});

	return Promise.resolve({ reader, writer });
}

class LoggingTransform extends stream.Transform {
	constructor(private readonly logger: Logger, private readonly prefix: string, opts?: stream.TransformOptions) {
		super(opts);
	}
	public _transform(chunk: any, encoding: string, callback: () => void): void {
		this.logger.info(`${this.prefix} ${chunk}`);
		this.push(chunk, encoding);
		callback();
	}
}
