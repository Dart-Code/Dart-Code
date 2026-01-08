import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// hello_world
//     test/broken_test.dart [1/2 passed] Failed
//         might fail [1/2 passed] Failed
//             today Failed
//             not today Passed
// == /EXPECTED RESULTS ==

void main() {
  group("might fail", () {
    test("today", () {
      expect(1, equals(2));
    });
    test("not today", () {
      expect(1, equals(1));
    });
  });
}
