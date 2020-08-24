import 'package:flutter_test/flutter_test.dart';

import '../lib/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/widget_test.dart [1/1 passed, {duration}ms] (pass.svg)
//     Hello world test [{duration}ms] (pass.svg)
// == /EXPECTED RESULTS ==

void main() {
  testWidgets('Hello world test', (WidgetTester tester) async {
    hello_world.main(); // BREAKPOINT1
    await tester.pump();
    expect(find.text('Hello, world!'), findsOneWidget);
  });
}
