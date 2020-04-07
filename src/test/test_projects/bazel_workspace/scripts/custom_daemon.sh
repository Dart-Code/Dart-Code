mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/daemon
flutter daemon "$@"
