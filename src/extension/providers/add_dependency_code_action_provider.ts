import * as fs from "fs";
import * as path from "path";
import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProviderMetadata, Diagnostic, DocumentSelector, Range, Selection, TextDocument } from "vscode";
import * as YAML from "yaml";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { locateBestProjectRoot } from "../../shared/vscode/project";
import { PubPackage } from "../commands/add_dependency";
import { isAnalyzableAndInWorkspace } from "../utils";
import { getDiagnosticErrorCode } from "../utils/vscode/diagnostics";
import { RankedCodeActionProvider } from "./ranking_code_action_provider";

const applicableErrorCodes = ["uri_does_not_exist", "conditional_uri_does_not_exist", "depend_on_referenced_packages"];
const packageUriSourceCodePattern = new RegExp(`r?['"]+package:([\\w\\-]+)\\/`);

export class AddDependencyCodeActionProvider implements RankedCodeActionProvider {
	constructor(public readonly selector: DocumentSelector) { }

	public readonly rank = 90;

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.QuickFix],
	};

	public provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, _token: CancellationToken): CodeAction[] | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return;

		// If we were only asked for specific action types and that doesn't include
		// quickfix (which is all we supply), bail out.
		if (context?.only && !CodeActionKind.QuickFix.contains(context.only))
			return;

		if (!context?.diagnostics?.length)
			return;

		let diagnosticsWithPackageNames = context.diagnostics
			.filter((d) => d.range.intersection(range) && d.source === "dart")
			.map((diagnostic) => ({ diagnostic, packageName: this.extractPackageNameForUriNotFoundDiagnostic(document, diagnostic) }))
			.filter((d) => d.packageName);
		if (!diagnosticsWithPackageNames.length)
			return;

		const projectRoot = locateBestProjectRoot(fsPath(document.uri));
		if (!projectRoot)
			return;

		const pubspecPath = path.join(projectRoot, "pubspec.yaml");
		const includeDevDependencies = !(document.uri.path.includes("/lib/") || document.uri.path.includes("/bin/"));

		// Next, filter out any already in pubspec, as that suggests the URI is incorrect
		// for another reason (and we wouldn't want to try to add something that exists).
		const existingPackageNames = this.getDependenciesForPubspec(pubspecPath, { includeDevDependencies });
		if (!existingPackageNames) // undefined = failed to parse, don't show any fixes
			return;
		diagnosticsWithPackageNames = diagnosticsWithPackageNames
			.filter((obj) => obj.packageName && !existingPackageNames.has(obj.packageName));

		// Next, remove any diagnostics that have the same package name and overlap with the same range.
		// https://github.com/Dart-Code/Dart-Code/issues/4896
		for (let i = 0; i < diagnosticsWithPackageNames.length; i++) {
			const packageName = diagnosticsWithPackageNames[i].packageName;
			const range = diagnosticsWithPackageNames[i].diagnostic.range;

			for (let j = i + 1; j < diagnosticsWithPackageNames.length; j++) {
				const packageName2 = diagnosticsWithPackageNames[i].packageName;
				const range2 = diagnosticsWithPackageNames[i].diagnostic.range;

				if (packageName === packageName2 && !range.intersection(range2)?.isEmpty) {
					diagnosticsWithPackageNames.splice(j, 1);
					j--;
				}
			}
		}

		if (!diagnosticsWithPackageNames.length)
			return;

		return flatMap(diagnosticsWithPackageNames, (item) => this.createActions(document, item.diagnostic, item.packageName!, { includeDevDependencies }));
	}

	private getDependenciesForPubspec(pubspecPath: string, { includeDevDependencies }: { includeDevDependencies: boolean }): Set<string> | undefined {
		const existingPackageNames = new Set<string>();

		try {
			const pubspecContent = fs.readFileSync(pubspecPath).toString();
			const yaml = YAML.parse(pubspecContent);
			const dependencies = yaml?.dependencies && typeof yaml.dependencies === "object" ? Object.keys(yaml.dependencies as object) : [];
			const devDependencies = includeDevDependencies && yaml?.dev_dependencies && typeof yaml.dev_dependencies === "object" ? Object.keys(yaml.dev_dependencies as object) : [];
			[...dependencies, ...devDependencies].forEach((d) => existingPackageNames.add(d));
		} catch {
			return undefined;
		}

		return existingPackageNames;
	}

	/// Checks if the diagnostic is a uri_does_not_exist and the URI is a package:
	/// URI and returns the package name.
	private extractPackageNameForUriNotFoundDiagnostic(document: TextDocument, diag: Diagnostic): string | undefined {
		const errorCode = getDiagnosticErrorCode(diag);
		if (!errorCode)
			return;

		if (!applicableErrorCodes.includes(errorCode))
			return;

		// Finally, ensure the URI is a package: URI and something that exists in the pub cache list
		// we have.
		const uriSourceCode = document.getText(diag.range);
		const match = packageUriSourceCodePattern.exec(uriSourceCode);
		if (!match)
			return;

		return match[1];
	}

	private createActions(document: TextDocument, diagnostic: Diagnostic, packageName: string, { includeDevDependencies }: { includeDevDependencies: boolean }): CodeAction[] {
		const createAction = (isDevDependency: boolean) => {
			const dependencyTypeName = isDevDependency ? "dev_dependencies" : "dependencies";
			const title = `Add '${packageName}' to ${dependencyTypeName}`;
			const action = new CodeAction(title, CodeActionKind.QuickFix);
			action.command = {
				arguments: [
					[document.uri],
					{ packageNames: packageName } as PubPackage,
					isDevDependency,
				],
				command: "_dart.addDependency",
				title,
			};
			return action;
		};
		const actions = [createAction(false)];

		if (includeDevDependencies)
			actions.push(createAction(true));

		return actions;
	}
}
