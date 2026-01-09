import 'package:flutter/widgets.dart';
import 'package:flutter_hello_world/counter.dart' as app;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// flutter_hello_world
//     integration_test/app_test.dart [3/3 passed] Passed
//         Counter App [2/2 passed] Passed
//             starts at 0 Passed
//             increments the counter Passed
//         (tearDownAll) Passed (integration_test.dart)
// == /EXPECTED RESULTS ==

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('Counter App', () {
    final counterTextFinder = find.byKey(Key('counter'));
    final buttonFinder = find.byKey(Key('increment'));

    testWidgets('starts at 0', (tester) async {
      app.main();
      await tester.pumpAndSettle(); // BREAKPOINT1

      // Verify the counter starts at 0.
      final text = tester.widget<Text>(counterTextFinder).data;
      expect(text, equals('0'));
    });

    testWidgets('increments the counter', (tester) async {
      app.main();
      await tester.pumpAndSettle();

      // First, tap the button.
      await tester.tap(buttonFinder);
      await tester.pumpAndSettle();

      // Then, verify the counter text is incremented by 1.
      final text = tester.widget<Text>(counterTextFinder).data;
      expect(text, equals('1'));
    });
  });
}
