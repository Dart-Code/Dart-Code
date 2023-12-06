// This file is used by 'navigate_from.dart' to test navigation.
//
// The implementation of posting the event lives in this file because it needs
// to be referenced for the resolution of a 'package:' URI to work so this
// avoids the possibility of accidentally removing an unused import.

import 'dart:developer';

var _hasPosted = false;

void maybePostNavigationEvent() {
  if (!_hasPosted) {
    _hasPosted = true;
    postEvent(
      'navigate',
      {
        'uri': 'package:flutter_hello_world/navigate_to.dart',
        'line': 1,
        'column': 2,
        'source': 'flutter.inspector',
      },
      stream: 'ToolEvent',
    );
  }
}
