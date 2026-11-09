import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { TestSource } from "../../../shared/test/test_model";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { captureTestDebugConfigurations } from "../../debug_helpers";
import { activate, checkTreeNodeResults, clearTestTree, defer, delay, fakeCancellationToken, findProjectNode, findSuiteNode, getExpectedResults, helloWorldExampleSubFolder, helloWorldExampleSubFolderProjectTestFile, helloWorldFolder, helloWorldRenameTestFile, helloWorldTestDiscoveryFile, helloWorldTestDiscoveryLargeFile, helloWorldTestFolder, helloWorldTestMainFile, makeTestTextTree, openFile, privateApi, sb, setTestContent, tryDelete, waitForResult } from "../../helpers";


describe("dart tests", () => {
	beforeEach("activate", () => activate());
	beforeEach("clear test tree", () => clearTestTree());


	it("discovers test when opening a file", async () => {
		// Ensure no results before we start.
		const initialResults = makeTestTextTree({ uriFilter: helloWorldTestDiscoveryFile }).join("\n");
		assert.equal(initialResults, "");


		await openFile(helloWorldTestDiscoveryFile);


		// Try to wait for the tree to update and include the test.
		await waitFor(() => makeTestTextTree({ uriFilter: helloWorldTestDiscoveryFile }).join("\n").includes("test 1"));


		const expectedResults = getExpectedResults();
		const actualResults = makeTestTextTree({ uriFilter: helloWorldTestDiscoveryFile }).join("\n");


		assert.ok(expectedResults);
		assert.ok(actualResults);
		checkTreeNodeResults(actualResults, expectedResults);
	});


	it("matches runtime nodes only to dynamic Outline nodes of the same kind and full name", () => {
		const model = privateApi.testModel;
		const suitePath = path.join(path.dirname(fsPath(helloWorldTestDiscoveryFile)), "dynamic_node_matching_test.dart");
		const session = "dynamic_node_matching";
		const suite = model.suiteDiscovered(session, suitePath);


		const staticGroup = model.groupDiscovered(session, suitePath, TestSource.Outline, 1, "auth", undefined, suitePath, undefined);
		const dynamicGroup = model.groupDiscovered(session, suitePath, TestSource.Outline, 2, "group $name suffix", undefined, suitePath, undefined);
		const dynamicTestWithGroupName = model.testDiscovered(session, suitePath, TestSource.Outline, 1, "cross $name", undefined, suitePath, undefined, undefined);
		const dynamicTest = model.testDiscovered(session, suitePath, TestSource.Outline, 2, "test $name suffix", undefined, suitePath, undefined, undefined);
		// A different node kind with the same exact name must not block a
		// matching dynamic Outline node of the requested kind.
		const dynamicGroupWithExactTest = model.groupDiscovered(session, suitePath, TestSource.Outline, 3, "paired group $name", undefined, suitePath, undefined);
		const exactTestWithGroupName = model.testDiscovered(session, suitePath, TestSource.Outline, 3, "paired group alpha", undefined, suitePath, undefined, undefined);
		const dynamicTestWithExactGroup = model.testDiscovered(session, suitePath, TestSource.Outline, 4, "paired test $name", undefined, suitePath, undefined, undefined);
		const exactGroupWithTestName = model.groupDiscovered(session, suitePath, TestSource.Outline, 4, "paired test alpha", undefined, suitePath, undefined);
		// Even when the dynamic pattern appears first, an exact same-kind sibling
		// must keep the result node as a sibling rather than capture it.
		model.groupDiscovered(session, suitePath, TestSource.Outline, 20, "group $name", undefined, suitePath, undefined);
		model.groupDiscovered(session, suitePath, TestSource.Outline, 21, "alpha", undefined, suitePath, undefined);
		const exactGroupAfterDynamic = model.groupDiscovered(session, suitePath, TestSource.Result, 22, "alpha", undefined, suitePath, undefined);


		// Matching also applies below a real GroupNode, reached via groupID.
		const nestedParent = model.groupDiscovered(session, suitePath, TestSource.Outline, 30, "nested parent", undefined, suitePath, undefined);
		const nestedDynamicTest = model.testDiscovered(session, suitePath, TestSource.Outline, 30, "nested $name", 30, suitePath, undefined, undefined);
		const nestedResult = model.testDiscovered(session, suitePath, TestSource.Result, 31, "nested alpha", 30, suitePath, undefined, undefined);


		const prefixMatch = model.groupDiscovered(session, suitePath, TestSource.Result, 11, "auth_service", undefined, suitePath, undefined);
		const partialDynamicGroupMatch = model.groupDiscovered(session, suitePath, TestSource.Result, 12, "group alpha suffix extra", undefined, suitePath, undefined);
		const matchingDynamicGroup = model.groupDiscovered(session, suitePath, TestSource.Result, 13, "group alpha suffix", undefined, suitePath, undefined);
		const wrongKindForGroup = model.groupDiscovered(session, suitePath, TestSource.Result, 14, "cross alpha", undefined, suitePath, undefined);
		const matchingDynamicTest = model.testDiscovered(session, suitePath, TestSource.Result, 11, "test alpha suffix", undefined, suitePath, undefined, undefined);
		const wrongKindForTest = model.testDiscovered(session, suitePath, TestSource.Result, 12, "group alpha suffix", undefined, suitePath, undefined, undefined);
		model.groupDiscovered(session, suitePath, TestSource.Result, 15, "result $name", undefined, suitePath, undefined);
		const resultNodeShouldNotMatch = model.groupDiscovered(session, suitePath, TestSource.Result, 16, "result actual", undefined, suitePath, undefined);
		const matchingGroupDespiteExactTest = model.groupDiscovered(session, suitePath, TestSource.Result, 17, "paired group alpha", undefined, suitePath, undefined);
		const matchingTestDespiteExactGroup = model.testDiscovered(session, suitePath, TestSource.Result, 13, "paired test alpha", undefined, suitePath, undefined, undefined);


		assert.equal(prefixMatch.parent, suite.node, "static group prefixes should not capture runtime groups");
		assert.equal(partialDynamicGroupMatch.parent, suite.node, "dynamic group patterns should match the full name");
		assert.equal(matchingDynamicGroup.parent, dynamicGroup);
		assert.equal(wrongKindForGroup.parent, suite.node, "a dynamic TestNode must not capture a runtime GroupNode");
		assert.equal(matchingDynamicTest.parent, dynamicTest);
		assert.equal(wrongKindForTest.parent, suite.node, "a dynamic GroupNode must not capture a runtime TestNode");
		assert.equal(resultNodeShouldNotMatch.parent, suite.node, "Result nodes must not be used as dynamic patterns");
		assert.equal(matchingGroupDespiteExactTest.parent, dynamicGroupWithExactTest, "an exact-name TestNode must not block a dynamic GroupNode");
		assert.equal(matchingTestDespiteExactGroup.parent, dynamicTestWithExactGroup, "an exact-name GroupNode must not block a dynamic TestNode");
