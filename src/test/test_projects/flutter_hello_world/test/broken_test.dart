import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_hello_world/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/broken_test.dart [0/1 passed] Failed
//     Hello world test Failed
// == /EXPECTED RESULTS ==

void main() {
  testWidgets('Hello world test', (WidgetTester tester) async {
    await tester.pumpWidget(hello_world.MyApp());
    expect(find.text("won't find this"), findsOneWidget);
  });
}
