import * as assert from "assert";
import { DebugClient } from "vscode-debugadapter-testsupport";

export async function getVariables(dc: DebugClient, scope: "Exception" | "Locals") {
	const threads = await dc.threadsRequest();
	assert.equal(threads.body.threads.length, 1);
	const stack = await dc.stackTraceRequest({ threadId: threads.body.threads[0].id });
	const scopes = await dc.scopesRequest({ frameId: stack.body.stackFrames[0].id });
	const exceptionScope = scopes.body.scopes.find((s) => s.name === scope);
	assert.ok(exceptionScope);
	const variables = await dc.variablesRequest({ variablesReference: exceptionScope.variablesReference });
	return variables;
}
