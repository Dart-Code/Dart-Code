mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/doctor
flutter doctor "$@"
