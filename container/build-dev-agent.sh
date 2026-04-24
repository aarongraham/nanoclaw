#!/bin/bash
# Build the NanoClaw dev-agent container image.
# Reads Erlang/Elixir versions from /opt/argos/.tool-versions.
# Run this after setup-dev-agent.sh has cloned the project.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

# v2: images are named per-install via container_image_base() from install-slug.sh.
# Base image: nanoclaw-agent-v2-<slug>:latest
# Dev image:  nanoclaw-dev-agent-v2-<slug>:latest
# shellcheck source=../setup/lib/install-slug.sh
source "$PROJECT_ROOT/setup/lib/install-slug.sh"
BASE_IMAGE_DEFAULT="$(container_image_base):latest"
BASE_IMAGE="${BASE_IMAGE:-$BASE_IMAGE_DEFAULT}"
IMAGE_NAME="$(container_image_base | sed 's/nanoclaw-agent/nanoclaw-dev-agent/')"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
TOOL_VERSIONS_FILE="/opt/argos/.tool-versions"

if [ ! -f "$TOOL_VERSIONS_FILE" ]; then
  echo "Error: $TOOL_VERSIONS_FILE not found."
  echo "Run scripts/setup-dev-agent.sh first to clone the project."
  exit 1
fi

ERLANG_VERSION=$(grep '^erlang' "$TOOL_VERSIONS_FILE" | awk '{print $2}')
ELIXIR_VERSION=$(grep '^elixir' "$TOOL_VERSIONS_FILE" | awk '{print $2}')

if [ -z "$ERLANG_VERSION" ] || [ -z "$ELIXIR_VERSION" ]; then
  echo "Error: Could not read erlang/elixir versions from $TOOL_VERSIONS_FILE"
  echo "Contents:"
  cat "$TOOL_VERSIONS_FILE"
  exit 1
fi

echo "Building NanoClaw dev-agent container image..."
echo "Base image:      ${BASE_IMAGE}"
echo "Erlang version:  ${ERLANG_VERSION}"
echo "Elixir version:  ${ELIXIR_VERSION}"
echo ""
echo "Note: Erlang compiles from source — this takes 10-20 minutes the first time."
echo "      Subsequent builds are fully cached unless versions change."
echo ""

${CONTAINER_RUNTIME} build \
  -f Dockerfile.dev-agent \
  -t "${IMAGE_NAME}:${TAG}" \
  --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
  --build-arg "ERLANG_VERSION=${ERLANG_VERSION}" \
  --build-arg "ELIXIR_VERSION=${ELIXIR_VERSION}" \
  .

echo ""
echo "Build complete: ${IMAGE_NAME}:${TAG}"
