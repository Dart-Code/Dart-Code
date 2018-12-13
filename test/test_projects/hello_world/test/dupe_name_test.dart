import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// test/dupe_name_test.dart (Failed)
//     group (Failed)
//         test (Passed)
//         test (Failed)
//     group (Failed)
//         test 1 (Passed)
//         test 1 (Failed)
//         test 2 (Skipped)
// == /EXPECTED RESULTS ==

void main() {
  group("group", () {
    test("test", () => expect(1, equals(1)));
    test("test", () => expect(1, equals(2)));
  });
  group("group", () {
    test("test 1", () => expect(1, equals(1)));
    test("test 1", () => expect(1, equals(2)));
    test("test 2", () {}, skip: true);
  });
}
