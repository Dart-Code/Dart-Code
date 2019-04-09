import 'package:flutter_web_ui/ui.dart' as web_ui;
import 'package:broken/main.dart' as my_app;
// TODO: Figure out how to have multiple entry points.
// import 'package:hello_world/broken.dart' as my_app;

main() async {
  await web_ui.webOnlyInitializePlatform();
  my_app.main();
}
