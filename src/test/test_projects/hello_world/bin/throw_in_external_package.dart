import 'package:http/http.dart' as http;

main() async {
  final uri = Uri.parse("not://a.valid@url");
  final resp = await http.read(uri);
  print(resp);
}
