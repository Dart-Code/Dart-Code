import 'package:flutter_test/flutter_test.dart';

import '../lib/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/broken_test.dart [0/1 passed, {duration}ms] (fail.svg)
//     Hello world test [{duration}ms] (fail.svg)
// == /EXPECTED RESULTS ==

void main() {
  testWidgets('Hello world test', (WidgetTester tester) async {
    hello_world.main();
    await tester.pump();
    expect(find.text("won't find this"), findsOneWidget);
  });
}
