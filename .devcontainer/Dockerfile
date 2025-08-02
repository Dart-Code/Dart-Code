FROM ubuntu:24.04

# Install deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
    apt-transport-https ca-certificates curl git git-lfs gnupg gpg libasound2t64 libglib2.0-0 libgtk-3-0 libnss3 libsecret-1-0 libxkbcommon0 lsb-release python3 unzip wget x11-utils xvfb xz-utils

# Install Node.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Install Dart.
RUN wget -qO- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/dart.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/dart.gpg arch=amd64] https://storage.googleapis.com/download.dartlang.org/linux/debian stable main' > /etc/apt/sources.list.d/dart_stable.list \
    && apt-get update && apt-get install -y dart \
	&& dart --disable-analytics

ENV PATH="/usr/lib/dart/bin:$PATH"
WORKDIR /workspaces/Dart-Code
