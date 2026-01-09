import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// hello_world
//     test/short_test.dart [1/1 passed] Passed
//         group1 [1/1 passed] Passed
//             test1 Passed
// == /EXPECTED RESULTS ==

void main() {
  group("group1", () {
    test("test1", () {});
  });
}
