import { strict as assert } from "assert";
import { mock } from "node:test";
import * as vs from "vscode";
import { LanguageClient, LanguageClientOptions } from "vscode-languageclient/node";
import { CachingMiddlewareFeature } from "../../../extension/analysis/caching_middleware";
import { PromiseCompleter } from "../../../shared/utils";
import { defer, fakeCancellationToken } from "../../helpers";

describe("caching middleware", () => {
	afterEach("reset mocks", () => mock.reset());

	describe("document symbols", () => {
		function createTestHarness() {
			const clientOptions: LanguageClientOptions = {};
			const mockClient = {
				clientOptions,
			} as unknown as LanguageClient;

			const feature = new CachingMiddlewareFeature(mockClient);
			defer("dispose feature", () => feature.dispose());

			const provideDocumentSymbols = clientOptions.middleware!.provideDocumentSymbols!;

			return { feature, provideDocumentSymbols, clientOptions };
		}

		function createFakeDocument(uriString: string, version = 1, isClosed = false): vs.TextDocument {
			return {
				uri: vs.Uri.parse(uriString),
				version,
				isClosed,
			} as unknown as vs.TextDocument;
		}

		function createFakeSymbol(name: string): vs.DocumentSymbol {
			const range = new vs.Range(new vs.Position(0, 0), new vs.Position(0, 10));
			return new vs.DocumentSymbol(name, "", vs.SymbolKind.Class, range, range);
		}

		it("returns the same promise and serves the same results for concurrent requests for the same doc/version", async () => {
			const { provideDocumentSymbols } = createTestHarness();
			const doc = createFakeDocument("file:///test/a.dart", 1);
			const symbols = [createFakeSymbol("MyClass")];

			const completer = new PromiseCompleter<vs.DocumentSymbol[]>();
			const nextMock = mock.fn(() => completer.promise);

			const promise1 = provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			const promise2 = provideDocumentSymbols(doc, fakeCancellationToken, nextMock);

			assert.strictEqual(promise1, promise2);
			assert.equal(nextMock.mock.callCount(), 1);

			completer.resolve(symbols);

			const [res1, res2] = await Promise.all([promise1, promise2]);
			assert.strictEqual(res1, symbols);
			assert.strictEqual(res2, symbols);
			assert.equal(nextMock.mock.callCount(), 1);
		});

		it("serves cached results for subsequent requests for the same doc/version", async () => {
			const { provideDocumentSymbols } = createTestHarness();
			const doc = createFakeDocument("file:///test/a.dart", 1);
			const symbols = [createFakeSymbol("MyClass")];
			const nextMock = mock.fn(async () => symbols);

			const res1 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			const res2 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);

			assert.strictEqual(res1, symbols);
			assert.strictEqual(res2, symbols);
			assert.equal(nextMock.mock.callCount(), 1);
		});

		it("re-fetches when document version changes", async () => {
			const { provideDocumentSymbols } = createTestHarness();
			const docV1 = createFakeDocument("file:///test/a.dart", 1);
			const docV2 = createFakeDocument("file:///test/a.dart", 2);
			const symbolsV1 = [createFakeSymbol("MyClassV1")];
			const symbolsV2 = [createFakeSymbol("MyClassV2")];

			let callCount = 0;
			const nextMock = mock.fn(async () => ++callCount === 1 ? symbolsV1 : symbolsV2);

			const res1 = await provideDocumentSymbols(docV1, fakeCancellationToken, nextMock);
			const res2 = await provideDocumentSymbols(docV2, fakeCancellationToken, nextMock);
			const res3 = await provideDocumentSymbols(docV2, fakeCancellationToken, nextMock);

			assert.strictEqual(res1, symbolsV1);
			assert.strictEqual(res2, symbolsV2);
			assert.strictEqual(res3, symbolsV2);
			assert.equal(nextMock.mock.callCount(), 2);
		});

		it("caches independently per document", async () => {
			const { provideDocumentSymbols } = createTestHarness();
			const docA = createFakeDocument("file:///test/a.dart", 1);
			const docB = createFakeDocument("file:///test/b.dart", 1);
			const symbolsA = [createFakeSymbol("ClassA")];
			const symbolsB = [createFakeSymbol("ClassB")];

			const nextMock = mock.fn(async (d: vs.TextDocument) => d.uri.toString().endsWith("a.dart") ? symbolsA : symbolsB);

			const resA1 = await provideDocumentSymbols(docA, fakeCancellationToken, nextMock);
			const resB1 = await provideDocumentSymbols(docB, fakeCancellationToken, nextMock);
			const resA2 = await provideDocumentSymbols(docA, fakeCancellationToken, nextMock);
			const resB2 = await provideDocumentSymbols(docB, fakeCancellationToken, nextMock);

			assert.strictEqual(resA1, symbolsA);
			assert.strictEqual(resA2, symbolsA);
			assert.strictEqual(resB1, symbolsB);
			assert.strictEqual(resB2, symbolsB);
			assert.equal(nextMock.mock.callCount(), 2);
		});

		it("invalidates cache when document is edited", async () => {
			const { provideDocumentSymbols } = createTestHarness();
			const doc = await vs.workspace.openTextDocument({ content: "class A {}", language: "dart" });
			const editor = await vs.window.showTextDocument(doc);

			const symbols1 = [createFakeSymbol("A")];
			const symbols2 = [createFakeSymbol("B")];
			let callCount = 0;
			const nextMock = mock.fn(async () => ++callCount === 1 ? symbols1 : symbols2);

			const res1 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			assert.strictEqual(res1, symbols1);
			assert.equal(nextMock.mock.callCount(), 1);

			await editor.edit((eb) => eb.replace(new vs.Range(new vs.Position(0, 0), new vs.Position(0, 10)), "class B {}"));

			const res2 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			assert.strictEqual(res2, symbols2);
			assert.equal(nextMock.mock.callCount(), 2);
		});

		it("removes cached symbols when document closes", async () => {
			let closeListener: ((doc: vs.TextDocument) => void) | undefined;
			mock.method(vs.workspace, "onDidCloseTextDocument", (listener: (doc: vs.TextDocument) => void) => {
				closeListener = listener;
				return { dispose: () => { } };
			});

			const { provideDocumentSymbols } = createTestHarness();
			const doc = createFakeDocument("file:///test/close.dart", 1);
			const symbols1 = [createFakeSymbol("First")];
			const symbols2 = [createFakeSymbol("Second")];

			let callCount = 0;
			const nextMock = mock.fn(async () => ++callCount === 1 ? symbols1 : symbols2);

			const res1 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			assert.strictEqual(res1, symbols1);
			assert.equal(nextMock.mock.callCount(), 1);

			// Simulate document close event.
			assert.ok(closeListener);
			closeListener(doc);

			// Requesting again (even with version 1) should re-fetch because it was evicted on close.
			const res2 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			assert.strictEqual(res2, symbols2);
			assert.equal(nextMock.mock.callCount(), 2);
		});

		it("does not cache if request fails or returns null", async () => {
			const { provideDocumentSymbols } = createTestHarness();
			const doc = createFakeDocument("file:///test/null.dart", 1);
			const symbols = [createFakeSymbol("Recovered")];

			let callCount = 0;
			const nextMock = mock.fn(async () => {
				callCount++;
				if (callCount === 1)
					return null;
				if (callCount === 2)
					throw new Error("Request failed");
				return symbols;
			});

			const res1 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			assert.equal(res1, null);

			await assert.rejects(async () => provideDocumentSymbols(doc, fakeCancellationToken, nextMock), /Request failed/);

			const res3 = await provideDocumentSymbols(doc, fakeCancellationToken, nextMock);
			assert.strictEqual(res3, symbols);
			assert.equal(nextMock.mock.callCount(), 3);
		});
	});
});
