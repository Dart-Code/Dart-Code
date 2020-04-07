mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/devtools_activate
pub global activate devtools "$@"
