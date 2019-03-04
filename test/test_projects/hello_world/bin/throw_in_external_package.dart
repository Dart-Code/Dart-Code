import 'package:http/http.dart' as http;

main() async {
  final resp = await http.read("not://a.valid@url");
  print(resp);
}
