import 'package:http/http.dart' as http;

main() async {
  final resp = await http.read("https://www.google.co.uk");
  print(resp);
}
