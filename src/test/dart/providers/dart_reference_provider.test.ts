
import * as assert from "assert";
import * as vs from "vscode";
import { activate, currentDoc, ensureLocation, everythingFile, extApi, getDefinition, getPackages, positionOf, rangeFor, rangeOf, uriFor } from "../../helpers";

describe("dart_reference_provider", () => {

	// We have tests that read tooltips from external packages so we need to ensure packages have been fetched.
	before("get packages", () => getPackages());
	beforeEach("activate everythingFile", () => activate(everythingFile));

	async function getReferencesFor(searchText: string): Promise<vs.Location[] | undefined> {
		const position = positionOf(searchText);
		return (await vs.commands.executeCommand("vscode.executeReferenceProvider", currentDoc().uri, position)) as vs.Location[];
	}

	it("returns expected location for definition of field reference", async () => {
		const definition = await getDefinition(positionOf("a.myTestNum^Field"));
		assert.deepStrictEqual(uriFor(definition).toString(), currentDoc().uri.toString());
		assert.deepStrictEqual(rangeFor(definition), extApi.isLsp ? rangeOf("|num myTestNumField|;") : rangeOf("num |myTestNumField|;"));
		// assert.deepStrictEqual(definition.targetUri.toString(), currentDoc().uri.toString());
		// assert.deepStrictEqual(definition.targetRange, rangeOf("num |myNumField|;"));
		// assert.deepStrictEqual(definition.originSelectionRange, rangeOf("a.|myNumField|"));
	});

	it("returns expected location for references of field reference", async () => {
		const references = await getReferencesFor("void meth^odTakingString(String a)");
		assert.ok(references);
		assert.equal(references.length, 3);
		const expectedUri = currentDoc().uri;
		ensureLocation(references, expectedUri, rangeOf(`b.|methodTakingString|("Hello")`));
		ensureLocation(references, expectedUri, rangeOf(`b.|methodTakingString|("World!")`));
		// Expect the decleratoin itself, since VS includes them by default.
		ensureLocation(references, expectedUri, rangeOf("void |methodTakingString|(String a)"));
	});
});
