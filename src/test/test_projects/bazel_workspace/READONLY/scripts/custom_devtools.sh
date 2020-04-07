mkdir -p `dirname "$0"`/has_run && touch `dirname "$0"`/has_run/custom_devtools
pub global run devtools "$@"
