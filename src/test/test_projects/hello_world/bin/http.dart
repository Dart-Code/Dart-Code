import 'package:http/http.dart' as http;

main() async {
  final uri = Uri.parse("https://www.google.co.uk");
  final resp = await http.read(uri);
  print(resp);
}
