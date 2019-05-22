import 'package:flutter_test/flutter_test.dart';

import '../lib/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// test/other_test.dart (Passed)
//     Other tests group (Passed)
//         Other test (Passed)
// == /EXPECTED RESULTS ==

void main() {
  group('Other tests group', () {
    testWidgets('Other test', (WidgetTester tester) async {
      hello_world.main(); // BREAKPOINT1
      await tester.pump();
      expect(find.text('Hello, world!'), findsOneWidget);
    });
  });
}
