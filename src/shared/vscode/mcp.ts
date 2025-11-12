import * as path from "path";
import * as vs from "vscode";
import { DartCapabilities } from "../capabilities/dart";
import { IAmDisposable } from "../interfaces";
import { DartToolingDaemon } from "../services/tooling_daemon";
import { disposeAll } from "../utils";

export class McpTools implements IAmDisposable {
	private readonly disposables: vs.Disposable[] = [];

	constructor(
		private readonly dartCapabilities: DartCapabilities,
		private readonly dartToolingDaemon: DartToolingDaemon | undefined,
	) {
		this.disposables.push(vs.lm.registerTool("get_dart_tooling_daemon_dtd_uri", {
			invoke: async () => {
				if (!dartCapabilities.supportsToolingDaemon)
					throw new Error("DTD is not available for this version of Flutter/Dart, please upgrade.");
				const dtdUri = await dartToolingDaemon?.dtdUri;
				return dtdUri
					? new vs.LanguageModelToolResult([new vs.LanguageModelTextPart(dtdUri)])
					: undefined;
			},
		}));

		this.disposables.push(vs.lm.registerTool("dart_format", {
			invoke: async (options) => {
				const input = options.input as any;
				const filePath = input?.filePath;
				if (typeof filePath !== "string")
					throw new Error("The Dart format tool requires a string 'filePath' property.");
				if (!path.isAbsolute(filePath))
					throw new Error("The Dart format tool requires an absolute path for the 'filePath' property.");
				if (!filePath.toLowerCase().endsWith(".dart"))
					throw new Error("The Dart format tool can only format .dart files.");

				const fileUri = vs.Uri.file(filePath);
				const document = await vs.workspace.openTextDocument(fileUri);
				await vs.window.showTextDocument(document, undefined, true);
				await vs.commands.executeCommand("editor.action.formatDocument");
				await document.save();

				return new vs.LanguageModelToolResult([new vs.LanguageModelTextPart(`Formatted '${filePath}'. You may need to re-read this file to get the latest content before making further changes.`)]);
			},
			prepareInvocation: (options) => {
				const input = options.input as any;
				const filePath = input?.filePath;
				return {
					invocationMessage:
						typeof filePath === "string"
							? `Formatting ${path.basename(filePath)}`
							: "Formatting Dart file",
				};
			}
		}));

		this.disposables.push(vs.lm.registerTool("dart_fix", {
			invoke: async (options) => {
				const input = options.input as any;
				const filePath = input?.filePath;
				if (filePath) {
					if (typeof filePath !== "string")
						throw new Error("The Dart fix tool only accepts string or falsy 'filePath' property.");
					if (!path.isAbsolute(filePath))
						throw new Error("The Dart fix tool requires an absolute path for the 'filePath' property if provided.");
					if (!filePath.toLowerCase().endsWith(".dart"))
						throw new Error("The Dart fix tool can only fix .dart files.");
				}

				if (filePath) {
					const fileUri = vs.Uri.file(filePath as string);
					const document = await vs.workspace.openTextDocument(fileUri);
					await vs.window.showTextDocument(document, undefined, true);
					await vs.commands.executeCommand("editor.action.fixAll");
					await document.save();

					return new vs.LanguageModelToolResult([new vs.LanguageModelTextPart(`Fixed '${filePath}'. You may need to re-read this file to get the latest content before making further changes.`)]);
				} else {
					await vs.commands.executeCommand("dart.edit.fixAllInWorkspace");

					return new vs.LanguageModelToolResult([new vs.LanguageModelTextPart(`Fixed all in workspace. You may need to re-read files to get the latest content before making further changes.`)]);
				}

			},
			prepareInvocation: (options) => {
				const input = options.input as any;
				const filePath = input?.filePath;
				return {
					invocationMessage:
						typeof filePath === "string" && filePath
							? `Fixing ${path.basename(filePath)}`
							: "Fixing all in workspace",
				};
			}
		}));
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}

