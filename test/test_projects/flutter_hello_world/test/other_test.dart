import 'package:flutter_test/flutter_test.dart';
import '../lib/main.dart' as hello_world;

void main() {
  testWidgets('Other test', (WidgetTester tester) async {
    hello_world.main(); // BREAKPOINT1
    await tester.pump();
    expect(find.text('Hello, world!'), findsOneWidget);
  });
}
