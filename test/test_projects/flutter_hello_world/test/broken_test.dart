import 'package:flutter_test/flutter_test.dart';
import '../lib/main.dart' as hello_world;

void main() {
  testWidgets('Hello world test', (WidgetTester tester) async {
    hello_world.main();
    await tester.pump();
    expect(find.text("won't find this"), findsOneWidget);
  });
}
