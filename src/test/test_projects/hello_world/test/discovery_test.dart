import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// hello_world
//     test/discovery_test.dart [0/4 passed] Unknown
//         group 1 [0/2 passed] Unknown
//             test 1 Unknown
//             test interpolated ${1 + 1} Unknown
//         group interpolated ${1 + 1}
//         test 1 Unknown
//         after nested helper Unknown
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

  // Tests declared inside nested local functions must not appear in the
  // static test tree, but tests after them in main() must still be found.
  void nestedHelper() {
    test("nested helper test", () => expect(1, equals(1)));
  }
  test("after nested helper", () => expect(1, equals(1)));
}

// Tests declared in helpers outside main() must not appear in the static
// test tree; they only show up as dynamic results if the suite runs them.
void helperWithTests() {
  group("helper group", () {
    test("helper test", () => expect(1, equals(1)));
  });
  test("another helper test", () => expect(1, equals(1)));
}
