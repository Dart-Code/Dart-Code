import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/discovery_test.dart (unknown.svg)
//     group 1 (unknown.svg)
//         test 1 (unknown.svg)
//     test 1 (unknown.svg)
// == /EXPECTED RESULTS ==

void main() {
  group("group 1", () {
    test("test 1", () => expect(1, equals(1)));
    test("test interpolated ${1 + 1}", () => expect(1, equals(1)));
  });
  group("group interpolated ${1 + 1}", () {
    test("test 1", () => expect(1, equals(1)));
  });
  test("test 1", () => expect(1, equals(1)));
}
