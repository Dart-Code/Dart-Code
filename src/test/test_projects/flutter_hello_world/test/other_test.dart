import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_hello_world/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/other_test.dart [1/1 passed] Passed
//     Other tests group [1/1 passed] Passed
//         Other test Passed
// == /EXPECTED RESULTS ==

void main() {
  group('Other tests group', () {
    testWidgets('Other test', (WidgetTester tester) async {
      await tester.pumpWidget(hello_world.MyApp()); // BREAKPOINT1
      expect(find.text('Hello, world!'), findsOneWidget);
    });
  });
}
