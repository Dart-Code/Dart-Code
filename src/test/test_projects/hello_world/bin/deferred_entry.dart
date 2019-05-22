import 'package:hello_world/deferred_script.dart' deferred as def;

main() async {
  await def.loadLibrary();
  def.do_print();
}
