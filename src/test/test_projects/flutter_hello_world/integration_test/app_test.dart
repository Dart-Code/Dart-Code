import 'package:flutter/widgets.dart';
import 'package:flutter_hello_world/counter.dart' as app;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

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
