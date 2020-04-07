mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/devtools
pub global run devtools "$@"
