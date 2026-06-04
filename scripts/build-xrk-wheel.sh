#!/usr/bin/env bash
#
# Build the libxrk Pyodide (WebAssembly) wheel used by the in-browser AiM
# .xrk/.xrz importer, and drop it into public/xrk/.
#
# This mirrors libxrk's own .github/workflows/pyodide.yml CI recipe. The wheel is
# a Rust (PyO3) + Cython extension cross-compiled for ONE Pyodide/Emscripten ABI,
# so the versions below are pinned and MUST stay in lockstep with
# src/lib/xrk/xrkConfig.ts (XRK_PYODIDE_VERSION + XRK_WHEEL_FILENAME).
#
#   Pyodide  0.27.3   (ABI tag: pyodide_2024_0_wasm32)
#   Python   3.12     (host + target)
#   Emscripten 3.1.58
#   Rust     nightly  (wasm32-unknown-emscripten, rust-src)
#
# Prerequisites: git, curl, rustup, and uv (https://docs.astral.sh/uv/).
# Usage: scripts/build-xrk-wheel.sh
set -euo pipefail

PYODIDE_VERSION=0.27.3
PYTHON_VERSION=3.12
EMSCRIPTEN_VERSION=3.1.58
LIBXRK_REF="${LIBXRK_REF:-main}"   # pin a tag/sha here for a reproducible build

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
echo "Working in $WORK"
cd "$WORK"

echo "==> Rust nightly + wasm32-unknown-emscripten"
rustup toolchain install nightly --component rust-src --profile minimal
rustup target add --toolchain nightly wasm32-unknown-emscripten

echo "==> Emscripten SDK $EMSCRIPTEN_VERSION"
git clone --depth 1 https://github.com/emscripten-core/emsdk.git
( cd emsdk && ./emsdk install "$EMSCRIPTEN_VERSION" && ./emsdk activate "$EMSCRIPTEN_VERSION" )
# shellcheck disable=SC1091
source "$WORK/emsdk/emsdk_env.sh"

echo "==> Clone libxrk ($LIBXRK_REF)"
git clone https://github.com/m3rlin45/libxrk.git
cd libxrk
git checkout "$LIBXRK_REF"
# wasm-opt wrapper required by Emscripten < 4 (drops unsupported flags).
WASM_OPT="$EMSDK/upstream/bin/wasm-opt"
if [ -f "$WASM_OPT" ] && [ ! -f "${WASM_OPT}.real" ]; then
  mv "$WASM_OPT" "${WASM_OPT}.real"
  cp scripts/wasm-opt-wrapper.sh "$WASM_OPT"
  chmod +x "$WASM_OPT"
fi

echo "==> pyodide-build toolchain (host Python $PYTHON_VERSION)"
uv venv --python "$PYTHON_VERSION" "$WORK/pyenv"
# shellcheck disable=SC1091
source "$WORK/pyenv/bin/activate"
uv pip install --prerelease=allow "wheel<0.44.0" "pyodide-build==$PYODIDE_VERSION"
# numpy/cython are imported by libxrk's setup.py during the build.
uv pip install "numpy==2.0.2" "cython>=3.0.0"

echo "==> Install Pyodide cross-build environment"
# NOTE: pyodide-build 0.27.3 hard-codes a metadata URL that has since moved. On a
# network-restricted runner you may need to override it, e.g.:
#   export PYODIDE_CROSS_BUILD_ENV_METADATA_URL=\
#     https://raw.githubusercontent.com/pyodide/pyodide/stable/pyodide-cross-build-environments.json
pyodide xbuildenv install "$PYODIDE_VERSION"

echo "==> Build the wheel"
export RUSTUP_TOOLCHAIN=nightly
export CARGO_BUILD_TARGET=wasm32-unknown-emscripten
export RUSTFLAGS="-C target-feature=-exception-handling -C panic=abort"
export CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER="$WORK/libxrk/scripts/emcc-no-wasm-exceptions.sh"
export PYO3_CROSS_PYTHON_VERSION="$PYTHON_VERSION"
chmod +x scripts/emcc-no-wasm-exceptions.sh scripts/wasm-opt-wrapper.sh
pyodide build --exports whole_archive

WHEEL="$(ls "$WORK"/libxrk/dist/*pyodide*wasm32.whl | head -1)"
echo "==> Built $WHEEL"
mkdir -p "$REPO_ROOT/public/xrk"
cp "$WHEEL" "$REPO_ROOT/public/xrk/"
echo "==> Copied to public/xrk/$(basename "$WHEEL")"
echo
echo "If the filename differs from XRK_WHEEL_FILENAME in"
echo "src/lib/xrk/xrkConfig.ts, update that constant to match."
