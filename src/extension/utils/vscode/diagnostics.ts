import { Diagnostic } from "vscode";

export function getDiagnosticErrorCode(diag: Diagnostic): string | undefined {
	const code = diag.code;
	if (!code)
		return;

	const errorCode = typeof code === "string" || typeof code === "number"
		? code.toString()
		: ("value" in code)
			? code.value.toString()
			: undefined;

	return errorCode;
}
