mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/devtools_run
pub global run devtools "$@"
