import { strict as assert } from "assert";
import { mock } from "node:test";
import * as vscode from "vscode";
import { ClientCapabilities, LanguageClient } from "vscode-languageclient/node";
import { FileExistence, FileType, FormField, InteractiveFormsFeature, ValidationSeverity } from "../../../extension/analysis/form";

describe("interactive forms", () => {
	afterEach("reset mocks", () => mock.reset());

	it("fills client capabilities with supported inputs", () => {
		const mockClient = {
			clientOptions: {},
			initializeResult: {}
		} as unknown as LanguageClient;

		const feature = new InteractiveFormsFeature(mockClient);
		const capabilities = {} as ClientCapabilities;
		feature.fillClientCapabilities(capabilities);

		assert.deepEqual(capabilities.experimental?.interactiveResolve, {
			inputTypes: ["bool", "file", "enum", "lazyEnum", "number", "string"],
			validators: {
				// eslint-disable-next-line id-blacklist
				string: ["regex"]
			}
		});
	});

	it("forwards through middleware when not supported", async () => {
		const flow = await runInteractiveFormTest({
			serverCapabilities: {},
			command: "fooCommand",
			commandArguments: ["barArg", "bazArg"],
		});

		// We expect the middleware to forward the request on to nextMock.
		assert.equal(flow.nextMock.mock.callCount(), 1);
		assert.deepEqual(flow.nextMock.mock.calls[0].arguments, ["fooCommand", ["barArg", "bazArg"]]);
	});

	describe("field types", () => {
		describe("string", () => {
			it("handles and validates required", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: vscode.InputBoxOptions) => {
					assert.equal(options.prompt, "What is your name?");
					assert.equal(options.value, "Alice");

					// Check validation.
					// eslint-disable-next-line @typescript-eslint/unbound-method
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), error("Please enter a value"));
					assert.deepStrictEqual(options.validateInput(" "), error("Please enter a value"));
					assert.deepStrictEqual(options.validateInput("Bob"), null);
					assert.deepStrictEqual(options.validateInput("foo"), error('Cannot be "foo"'));
					assert.deepStrictEqual(options.validateInput("bar"), warning('Should not be "bar"'));
					assert.deepStrictEqual(options.validateInput("baz"), warning("Should begin with a capital B"));

					return "Bob";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "name",
							description: "What is your name?",
							type: {
								kind: "string",
								validators: [
									{
										kind: "regex",
										pattern: "^bar$", matchIsValid: false, severity: ValidationSeverity.Warning,
										message: 'Should not be "bar"'
									},
									{
										kind: "regex",
										pattern: "^B", matchIsValid: true, severity: ValidationSeverity.Warning,
										message: "Should begin with a capital B"
									},
									{
										kind: "regex",
										pattern: "^foo$", matchIsValid: false, severity: ValidationSeverity.Error,
										message: 'Cannot be "foo"'
									},
									{
										kind: "regex",
										pattern: "[[[[[[[[[[[[[[[[[[[", matchIsValid: true, severity: ValidationSeverity.Warning,
										message: "Invalid regex to ensure we don't crash"
									},
									{
										kind: "unknown_future_validator",
									} as any,
								]
							},
							required: true,
							default: "Alice"
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.equal(flow.nextMock.mock.callCount(), 0);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "name", value: "Bob" }
				]);
			});

			it("handles and validates optional", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "What is your nickname?");

					// All inputs are allowed for optional fields.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), null);
					assert.deepStrictEqual(options.validateInput(" "), null);
					assert.deepStrictEqual(options.validateInput("Bob"), null);
					assert.deepStrictEqual(options.validateInput("foo"), error('Cannot be "foo"'));

					return "   ";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "nickname",
							description: "What is your nickname?",
							type: {
								kind: "string",
								validators: [
									{
										kind: "regex",
										pattern: "^foo$", matchIsValid: false, severity: ValidationSeverity.Error,
										message: 'Cannot be "foo"'
									}
								]
							},
							required: false
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "nickname", value: null }
				]);
			});
		});

		describe("number", () => {
			it("handles and validates required", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "How old are you?");
					assert.equal(options.value, "25");

					// Check validation.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput("not-a-number"), error("Please enter a valid number"));
					assert.deepStrictEqual(options.validateInput(""), error("Please enter a number"));
					assert.deepStrictEqual(options.validateInput("  "), error("Please enter a number"));
					assert.deepStrictEqual(options.validateInput("42"), null);
					assert.deepStrictEqual(options.validateInput("42.12"), null); // Currently we don't validate whole numbers.

					return "30";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "age",
							description: "How old are you?",
							type: { kind: "number" },
							required: true,
							default: 25
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "age", value: 30 }
				]);
			});

			it("handles and validates optional", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "What is your favorite number?");

					// All inputs are allowed for optional fields, but they
					// must still be numbers.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), null);
					assert.deepStrictEqual(options.validateInput(" "), null);
					assert.deepStrictEqual(options.validateInput("not-a-number"), error("Please enter a valid number"));
					assert.deepStrictEqual(options.validateInput("7"), null);

					return "";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "favNumber",
							description: "What is your favorite number?",
							type: { kind: "number" },
							required: false
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "favNumber", value: null }
				]);
			});
		});

		describe("boolean", () => {
			it("handles using QuickPick", async () => {
				const showQuickPickMock = mock.method(vscode.window, "showQuickPick", async (items: any, options: any) => {
					assert.equal(options.placeHolder, "Enable feature?");
					assert.deepEqual(items, [
						{ label: "Yes", value: true },
						{ label: "No", value: false }
					]);
					return { label: "Yes", value: true };
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "enable",
							description: "Enable feature?",
							type: { kind: "bool" },
							required: true
						}
					],
				});

				assert.equal(showQuickPickMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "enable", value: true }
				]);
			});
		});

		describe("enum", () => {
			it("handles using QuickPick", async () => {
				const showQuickPickMock = mock.method(vscode.window, "showQuickPick", async (items: any, options: any) => {
					assert.equal(options.placeHolder, "Select environment");
					assert.deepEqual(items, [
						{ label: "Production environment", description: "prod", value: "prod" },
						{ label: "Staging environment", description: "staging", value: "staging" }
					]);
					return { label: "Production environment", value: "prod" };
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "env",
							description: "Select environment",
							type: {
								kind: "enum",
								entries: [
									{ value: "prod", description: "Production environment" },
									{ value: "staging", description: "Staging environment" }
								]
							},
							required: true
						}
					],
				});

				assert.equal(showQuickPickMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "env", value: "prod" }
				]);
			});
		});

		describe("lazy enum", () => {
			it("handles using createQuickPick", async () => {
				const onDidChangeValueCallbacks: Array<(v: string) => void> = [];
				const onDidAcceptCallbacks: Array<() => void> = [];
				const onDidHideCallbacks: Array<() => void> = [];

				const quickPickMock = {
					title: "",
					placeholder: "",
					matchOnDescription: false,
					busy: false,
					items: [] as any[],
					onDidChangeValue: (cb: (v: string) => void) => {
						onDidChangeValueCallbacks.push(cb);
						return { dispose: () => { } };
					},
					onDidAccept: (cb: () => void) => {
						onDidAcceptCallbacks.push(cb);
						return { dispose: () => { } };
					},
					onDidHide: (cb: () => void) => {
						onDidHideCallbacks.push(cb);
						return { dispose: () => { } };
					},
					show: () => { },
					hide: () => {
						onDidHideCallbacks.forEach((cb) => cb());
					},
					dispose: () => { },
					selectedItems: [] as any[]
				};

				const createQuickPickMock = mock.method(vscode.window, "createQuickPick", () => quickPickMock);

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "lazy",
							description: "Search things",
							type: {
								kind: "lazyEnum",
								source: "workspace/symbols"
							},
							required: true
						}
					],
					lazyEnumEntries: [
						{ value: "custom-lazy-val", description: "Custom Lazy Value" }
					],
					async mockUserInteraction() {
						// Wait until the form implementation has registered the callbacks.
						let attempts = 100;
						while (!onDidAcceptCallbacks.length && attempts-- > 0) {
							await new Promise((resolve) => setTimeout(resolve, 10));
						}

						quickPickMock.selectedItems = [{ label: "Custom Lazy Value", value: "custom-lazy-val" }];
						onDidAcceptCallbacks.forEach((cb) => cb());
					}
				});

				assert.equal(createQuickPickMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "lazy", value: "custom-lazy-val" }
				]);
			});
		});

		describe("file input", () => {
			it("handles for existing resource using showOpenDialog", async () => {
				const showOpenDialogMock = mock.method(vscode.window, "showOpenDialog", async (options: any) => {
					assert.equal(options.canSelectFiles, true);
					assert.equal(options.canSelectFolders, false);
					assert.equal(options.title, "Select existing workspace file");
					assert.deepEqual(options.filters, { "Supported Files": ["dart"] });
					return [vscode.Uri.parse("file:///workspace/app.dart")];
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "existingFile",
							description: "Select existing workspace file",
							type: {
								kind: "file",
								existence: FileExistence.Existing,
								type: FileType.Regular,
								filters: ["dart"]
							},
							required: true
						}
					],
				});

				assert.equal(showOpenDialogMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "existingFile", value: "file:///workspace/app.dart" }
				]);
			});

			it("handles for new resource using showSaveDialog", async () => {
				const showSaveDialogMock = mock.method(vscode.window, "showSaveDialog", async (options: any) => {
					assert.equal(options.title, "Create new output file");
					return vscode.Uri.parse("file:///workspace/output.dart");
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "newFile",
							description: "Create new output file",
							type: {
								kind: "file",
								existence: FileExistence.New,
								type: FileType.Regular
							},
							required: true
						}
					],
				});

				assert.equal(showSaveDialogMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "newFile", value: "file:///workspace/output.dart" }
				]);
			});

			it("handles for existing or new resource via additional QuickPick", async () => {
				const showQuickPickMock = mock.method(vscode.window, "showQuickPick", async <T>(items: T[]) => items[0]);

				const showOpenDialogMock = mock.method(vscode.window, "showOpenDialog", async () => [vscode.Uri.parse("file:///workspace/selected.dart")]);

				// eslint-disable-next-line no-bitwise
				const combinationExistence = FileExistence.New | FileExistence.Existing;

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "anyFile",
							description: "Pick any file",
							type: {
								kind: "file",
								existence: combinationExistence,
								type: FileType.Regular
							},
							required: true
						}
					],
				});

				assert.equal(showQuickPickMock.mock.callCount(), 1);
				assert.equal(showOpenDialogMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "anyFile", value: "file:///workspace/selected.dart" }
				]);
			});
		});

		describe("list", () => {
			it("handles and validates required strings", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "Tags (comma separated)");

					// Check validation.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), error("Please enter at least one item"));
					assert.deepStrictEqual(options.validateInput(" "), error("Please enter at least one item"));
					assert.deepStrictEqual(options.validateInput("apple, banana"), null);
					assert.deepStrictEqual(options.validateInput("apple, foo"), warning('Should not be "foo"'));
					// Error validation should come first, even across multiple items.
					assert.deepStrictEqual(options.validateInput("apple, foo, bar"), error('Cannot be "bar"'));

					return "apple, banana, cherry";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "tags",
							description: "Tags",
							type: {
								kind: "list",
								elementType: {
									kind: "string",
									validators: [
										{
											kind: "regex",
											pattern: "^foo$", matchIsValid: false, severity: ValidationSeverity.Warning,
											message: 'Should not be "foo"'
										},
										{
											kind: "regex",
											pattern: "^bar$", matchIsValid: false, severity: ValidationSeverity.Error,
											message: 'Cannot be "bar"'
										}
									]
								}
							},
							required: true
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "tags", value: ["apple", "banana", "cherry"] }
				]);
			});

			it("handles and validates optional strings", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "Tags (comma separated)");

					// All inputs are allowed for optional fields.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), null);
					assert.deepStrictEqual(options.validateInput("   "), null);

					return "   ";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "tags",
							description: "Tags",
							type: {
								kind: "list",
								elementType: { kind: "string" }
							},
							required: false
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "tags", value: null }
				]);
			});

			it("handles and validates required numbers", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "Ages (comma separated)");

					// Check validation.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), error("Please enter at least one item"));
					assert.deepStrictEqual(options.validateInput(" "), error("Please enter at least one item"));
					assert.deepStrictEqual(options.validateInput("10, not a number, 20"), error("Please enter only valid numbers"));
					assert.deepStrictEqual(options.validateInput("10, 20"), null);

					return "10, 20";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "ages",
							description: "Ages",
							type: {
								kind: "list",
								elementType: { kind: "number" }
							},
							required: true
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "ages", value: [10, 20] }
				]);
			});

			it("handles and validates optional numbers", async () => {
				const showInputBoxMock = mock.method(vscode.window, "showInputBox", async (options: any) => {
					assert.equal(options.prompt, "Ages (comma separated)");

					// All inputs are allowed for optional fields, but they
					// must still be numbers.
					assert.ok(options.validateInput);
					assert.deepStrictEqual(options.validateInput(""), null);
					assert.deepStrictEqual(options.validateInput("   "), null);
					assert.deepStrictEqual(options.validateInput("10, not a number, 20"), error("Please enter only valid numbers"));

					return "";
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "ages",
							description: "Ages",
							type: {
								kind: "list",
								elementType: { kind: "number" }
							},
							required: false
						}
					],
				});

				assert.equal(showInputBoxMock.mock.callCount(), 1);
				assert.deepEqual(flow.executeCallRequestParams.formAnswers, [
					{ id: "ages", value: null }
				]);
			});

			it("warns and fails when list elements are unsupported", async () => {
				const showErrorMessageMock = mock.method(vscode.window, "showErrorMessage", async (msg: string) => {
					assert.ok(msg.includes("List input for bool is not supported"));
					return undefined;
				});

				const flow = await runInteractiveFormTest({
					formFields: [
						{
							id: "boolList",
							description: "Bools",
							type: {
								kind: "list",
								elementType: { kind: "bool" }
							},
							required: true
						}
					],
				});

				assert.equal(showErrorMessageMock.mock.callCount(), 1);
				assert.equal(flow.executeCallRequestParams, null);
			});
		});
	});

	describe("validation and errors", () => {
		it("shows warning messages for validation errors from the server", async () => {
			const showWarningMessageMock = mock.method(vscode.window, "showWarningMessage", async () => undefined);

			const showInputBoxMock = mock.method(vscode.window, "showInputBox", async () => "user-attempt");

			const flow = await runInteractiveFormTest({
				formFields: [
					{
						id: "username",
						description: "Username",
						type: { kind: "string" },
						required: true,
						error: "Username is already taken"
					}
				],
				mockUserInteraction() { }
			});

			assert.ok(flow);
			assert.equal(showInputBoxMock.mock.callCount(), 1);
			const warnings = showWarningMessageMock.mock.calls.map((c: any) => c.arguments[0] as string);
			assert.ok(warnings.includes("Question 1: Username is already taken"));
		});

		it("aborts when the server exceeds maximum retry attempts", async () => {
			const showWarningMessageMock = mock.method(vscode.window, "showWarningMessage", async () => undefined);

			mock.method(vscode.window, "showInputBox", async () => "some-input");

			const flow = await runInteractiveFormTest({
				formFields: [
					{
						id: "forever",
						description: "Try again",
						type: { kind: "string" },
						required: true
					}
				],
				returnFormFieldsIndefinitely: true,
			});

			assert.equal(flow.result, undefined);
			assert.equal(flow.resolveCallCount, 5);

			const warnings = showWarningMessageMock.mock.calls.map((c: any) => c.arguments[0] as string);
			assert.ok(warnings.some((w: string) => w.includes("exceeds the maximum allowed attempts")));
		});

		it("cancels execution if the user cancels an input prompt", async () => {
			const showInputBoxMock = mock.method(vscode.window, "showInputBox", async () => undefined);

			const flow = await runInteractiveFormTest({
				formFields: [
					{
						id: "cancelled",
						description: "Enter string",
						type: { kind: "string" },
						required: true
					}
				],
				mockUserInteraction() { }
			});

			assert.equal(showInputBoxMock.mock.callCount(), 1);
			assert.equal(flow.executeCallRequestParams, null);
			assert.equal(flow.result, undefined);
		});
	});
});


/**
 * Helper to run form tests and verify command execution/resolution flow.
 */
async function runInteractiveFormTest(params: {
	// Fields to return from `/resolve`.
	formFields?: FormField[];
	// Function to call to allow the test to simulate user interaction.
	mockUserInteraction?: () => void;
	// If testing lazy enum, the mock response to return from `interactive/listEnum`.
	lazyEnumEntries?: Array<{ value: string; description: string }>;
	// Server capabilities. If not supplied, we assume interactive forms are supported.
	serverCapabilities?: any;
	// Whether `/resolve` should keep returning formFields indefinitely. If not set, will
	// only return formFields on the first request.
	returnFormFieldsIndefinitely?: boolean;
	// The command to execute.
	command?: string;
	// The arguments to pass to the command.
	commandArguments?: string[];
}) {
	// Options passed to the client. Our middleware gets installed here.
	const clientOptions: any = {};

	// How many times `/resolve` was called.
	let resolveCallCount = 0;

	// Capture the params send to the underlying execute command for test
	// validation.
	let executeCallRequestParams: any = null;

	const serverCapabilities = params.serverCapabilities ?? {
		experimental: {
			interactiveResolveProvider: {
				kinds: ["command"]
			}
		}
	};

	const mockClient = {
		clientOptions,
		initializeResult: {
			capabilities: serverCapabilities
		},
		sendRequest: async (method: string, requestParams: any) => {
			if (method === "command/resolve") {
				resolveCallCount++;
				if (resolveCallCount === 1 || params.returnFormFieldsIndefinitely) {
					return {
						command: requestParams.command,
						arguments: requestParams.arguments,
						formFields: params.formFields,
						formAnswers: requestParams.formAnswers
					};
				} else {
					return {
						command: requestParams.command,
						arguments: requestParams.arguments,
						formAnswers: requestParams.formAnswers
					};
				}
			}
			if (method === "interactive/listEnum") {
				assert.ok(requestParams.source);
				assert.notEqual(requestParams.query, undefined); // Will be empty string for initial request.
				return params.lazyEnumEntries;
			}
			if (method === "workspace/executeCommand") {
				assert.ok(requestParams.command);
				assert.ok(requestParams.arguments);
				executeCallRequestParams = requestParams;
				return { success: true };
			}
			throw new Error(`Unknown request to mock client: ${method}`);
		},
		handleFailedRequest: (_type: any, _value: any, error: any, _token: any) => {
			throw error;
		}
	} as unknown as LanguageClient;

	new InteractiveFormsFeature(mockClient);

	// Trigger any mock user interaction function provided by the test.
	if (params.mockUserInteraction)
		params.mockUserInteraction();

	// Execute the middleware with a stub next function.
	const executeCommand = clientOptions.middleware.executeCommand;
	const nextMock = mock.fn();
	const result = await executeCommand(params.command ?? "testCommand", params.commandArguments ?? ["testArg1"], nextMock);

	// Return anything that the test may require to verify against.
	return {
		result, // executeCommand response.
		executeCallRequestParams, // params passed to the final executeCommand() after form completion.
		nextMock, // Mock used as the next() implementation (called in middleware when not completing forms).
		resolveCallCount, // The number of times `/resolve` was called.
	};
}

function error(message: string) {
	return { message, severity: vscode.InputBoxValidationSeverity.Error };
}

function warning(message: string) {
	return { message, severity: vscode.InputBoxValidationSeverity.Warning };
}

