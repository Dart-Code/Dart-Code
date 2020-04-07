mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/flutter_test
flutter test "$@"
