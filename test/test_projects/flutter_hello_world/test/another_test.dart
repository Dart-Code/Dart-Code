import 'package:flutter_test/flutter_test.dart';

import '../lib/main.dart' as hello_world;

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// test/another_test.dart (Passed)
//     Another tests group (Passed)
//         Another test (Passed)
// == /EXPECTED RESULTS ==

void main() {
  group('Another tests group', () {
    testWidgets(
      'Another test',
      (WidgetTester tester) async {
        hello_world.main(); // BREAKPOINT1
        await tester.pump();

        // This test runs slower than others to make sure that it doesn't get
        // terminated when the other tests finish during Run All Tests as was
        // the case when we enabled connecting the VM.
        // https://github.com/Dart-Code/Dart-Code/issues/1673

        tester.binding.addTime(const Duration(seconds: 10));
        await tester.runAsync(() => Future.delayed(const Duration(seconds: 3)));
        expect(find.text('Hello, world!'), findsOneWidget);
      },
      timeout: Timeout(const Duration(seconds: 10)),
    );
  });
}
