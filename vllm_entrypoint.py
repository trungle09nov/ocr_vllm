#!/usr/bin/env python3
"""
Custom entrypoint for vllm that pre-registers custom model architectures
from the local model directory before vllm validates the model config.

This is needed for models like LightOnOCR whose architecture is not in the
standard Transformers library and whose auto_map does not include 'AutoModel'.
"""
import sys
import os
import importlib
import runpy


def register_local_model(model_path: str) -> None:
    if not os.path.isdir(model_path):
        return

    sys.path.insert(0, model_path)

    for fname in os.listdir(model_path):
        if fname.startswith("modeling_") and fname.endswith(".py"):
            module_name = fname[:-3]
            try:
                importlib.import_module(module_name)
                print(f"[entrypoint] Registered model module: {module_name}", flush=True)
            except Exception as e:
                print(f"[entrypoint] Warning: could not import {module_name}: {e}", file=sys.stderr, flush=True)


def main() -> None:
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--model" and i + 1 < len(args):
            register_local_model(args[i + 1])
            break

    # Run vllm in the same process so registered architectures are visible
    sys.argv = ["vllm.entrypoints.openai.api_server"] + args
    runpy.run_module(
        "vllm.entrypoints.openai.api_server",
        run_name="__main__",
        alter_sys=True,
    )


if __name__ == "__main__":
    main()
