import 'package:flutter_hello_world/main.dart' as hello_world;
import 'package:flutter_test/flutter_test.dart';

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// flutter_hello_world
//     test/widget_test.dart [2/3 passed] Passed
//         Hello world test Passed
//         multi line test Passed
//         Skipped test Skipped
// == /EXPECTED RESULTS ==

void main() {
  testWidgets('Hello world test', (WidgetTester tester) async {
    await tester.pumpWidget(hello_world.MyApp()); // BREAKPOINT1
    expect(find.text('Hello, world!'), findsOneWidget);
  });

  testWidgets('''multi
line
test''', (WidgetTester tester) async {
    expect(1, 1);
  });

  testWidgets('Skipped test', (WidgetTester tester) async {
    await tester.pumpWidget(hello_world.MyApp());
    expect(find.text('Hello, world!'), findsOneWidget);
  }, skip: true);
}
