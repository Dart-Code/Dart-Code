import "package:hello_world/printer.dart";
import "package:test/test.dart";

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// hello_world
//     test/project_test.dart [1/1 passed] Passed
//         printer Passed
// == /EXPECTED RESULTS ==

void main() {
  test("printer", () {
    printHello();
  });
}
