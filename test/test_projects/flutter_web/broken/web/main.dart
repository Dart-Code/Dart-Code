import 'package:flutter_web_ui/ui.dart' as web_ui;
import 'package:broken/main.dart' as my_app;

main() async {
  await web_ui.webOnlyInitializePlatform();
  my_app.main();
}
