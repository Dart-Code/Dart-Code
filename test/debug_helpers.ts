import * as assert from "assert";
import { Variable } from "vscode-debugadapter";
import { DebugClient } from "vscode-debugadapter-testsupport";

export async function getTopFrameVariables(dc: DebugClient, scope: "Exception" | "Locals"): Promise<Variable[]> {
	const threads = await dc.threadsRequest();
	assert.equal(threads.body.threads.length, 1);
	const stack = await dc.stackTraceRequest({ threadId: threads.body.threads[0].id });
	const scopes = await dc.scopesRequest({ frameId: stack.body.stackFrames[0].id });
	const exceptionScope = scopes.body.scopes.find((s) => s.name === scope);
	assert.ok(exceptionScope);
	const variables = await dc.variablesRequest({ variablesReference: exceptionScope.variablesReference });
	return variables.body.variables;
}

export async function getVariables(dc: DebugClient, variablesReference: number): Promise<Variable[]> {
	const variables = await dc.variablesRequest({ variablesReference });
	return variables.body.variables;
}

export function ensureVariable(variables: Variable[], name: string, value: string) {
	assert.ok(variables);
	const v = variables.find((v) => v.name === name);
	assert.ok(
		v,
		`Couldn't find variable ${name} in\n`
		+ variables.map((v) => `        ${v.name}: ${v.value}`).join("\n"),
	);
	assert.equal(v.value, value);
}
