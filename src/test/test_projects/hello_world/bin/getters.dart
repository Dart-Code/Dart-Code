class Person {
  String baseField = 'baseField';
  String get kind => "Person";
  String get throws => throw "Oops!";
}

class Danny extends Person {
  String field = 'field';
  String get name => "Danny";
}

main() {
  var danny = Danny();
  print(danny.name); // BREAKPOINT1
}
