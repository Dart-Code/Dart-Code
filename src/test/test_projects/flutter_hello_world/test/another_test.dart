import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_hello_world/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// test/another_test.dart [1/1 passed] Passed
//     Another tests group [1/1 passed] Passed
//         Another test Passed
// == /EXPECTED RESULTS ==

void main() {
  group('Another tests group', () {
    testWidgets(
      'Another test',
      (WidgetTester tester) async {
        await tester.pumpWidget(hello_world.MyApp()); // BREAKPOINT1

        // This test runs slower than others to make sure that it doesn't get
        // terminated when the other tests finish during Run All Tests as was
        // the case when we enabled connecting the VM.
        // https://github.com/Dart-Code/Dart-Code/issues/1673

        await tester.runAsync(() => Future.delayed(const Duration(seconds: 3)));
        expect(find.text('Hello, world!'), findsOneWidget);
      },
      timeout: Timeout(const Duration(seconds: 10)),
    );
  });
}
