import * as fs from "fs";
import * as path from "path";
import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeActionProviderMetadata, Diagnostic, DocumentSelector, Range, Selection, TextDocument } from "vscode";
import { flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { locateBestProjectRoot } from "../project";
import { isAnalyzableAndInWorkspace } from "../utils";
import { RankedCodeActionProvider } from "./ranking_code_action_provider";

const applicableErrorCodes = ["uri_does_not_exist", "conditional_uri_does_not_exist"];
const packageUriSourceCodePattern = new RegExp(`r?['"]+package:(.*)\\/`);

export class AddDependencyCodeActionProvider implements RankedCodeActionProvider {
	constructor(public readonly selector: DocumentSelector) { }

	public readonly rank = 90;

	public readonly metadata: CodeActionProviderMetadata = {
		providedCodeActionKinds: [CodeActionKind.QuickFix],
	};

	public provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, token: CancellationToken): CodeAction[] | undefined {
		if (!isAnalyzableAndInWorkspace(document))
			return;

		// If we were only asked for specific action types and that doesn't include
		// quickfix (which is all we supply), bail out.
		if (context && context.only && !CodeActionKind.QuickFix.contains(context.only))
			return;

		if (!context || !context.diagnostics || !context.diagnostics.length)
			return;

		const projectRoot = locateBestProjectRoot(fsPath(document.uri));
		if (!projectRoot)
			return;

		let diagnosticsWithPackageNames = context.diagnostics
			.filter((d) => d.range.intersection(range) && d.source === "dart")
			.map((diagnostic) => ({ diagnostic, packageName: this.extractPackageNameForUriNotFoundDiagnostic(document, diagnostic) }))
			.filter((d) => d.packageName);
		if (!diagnosticsWithPackageNames.length)
			return;

		const pubspec = path.join(projectRoot, "pubspec.yaml");
		const pubspecContent = fs.existsSync(pubspec) ? fs.readFileSync(pubspec).toString() : undefined;

		if (!pubspecContent)
			return;

		// Next, filter out any already in pubspec, as that suggests the URI is incorrect
		// for another reason (and we wouldn't want to try to add something that exists).
		diagnosticsWithPackageNames = diagnosticsWithPackageNames
			.filter((obj) => obj.packageName && !pubspecContent.includes(`  ${obj.packageName}`));

		if (!diagnosticsWithPackageNames.length)
			return;

		return flatMap(diagnosticsWithPackageNames, (item) => this.createActions(document, item.diagnostic, item.packageName!));
	}

	/// Checks if the diagnostic is a uri_does_not_exist and the URI is a package:
	/// URI and returns the package name.
	private extractPackageNameForUriNotFoundDiagnostic(document: TextDocument, diag: Diagnostic): string | undefined {
		const code = diag.code;
		if (!code)
			return;

		const errorCode = typeof code === "string" || typeof code === "number"
			? code.toString()
			: ("value" in code)
				? code.value.toString()
				: undefined;
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

	private createActions(document: TextDocument, diagnostic: Diagnostic, packageName: string): CodeAction[] {
		const createAction = (isDevDependency: boolean) => {
			const dependencyTypeName = isDevDependency ? "dev_dependencies" : "dependencies";
			const title = `Add '${packageName}' to ${dependencyTypeName} in pubspec.yaml`;
			const action = new CodeAction(title, CodeActionKind.QuickFix);
			action.command = {
				arguments: [
					document.uri,
					packageName,
					isDevDependency,
				],
				command: "_dart.addDependency",
				title,
			};
			return action;
		};
		const actions = [createAction(false)];

		// When outside of lib, dev_dependency is an option too.
		if (!document.uri.path.includes("/lib/"))
			actions.push(createAction(true));

		return actions;
	}
}
