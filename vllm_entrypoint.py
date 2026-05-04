#!/usr/bin/env python3
"""
Custom entrypoint for vllm that patches AutoConfig.from_pretrained to inject
'AutoModel' into auto_map for custom models (e.g. LightOnOCR) that vllm requires
for --model-impl transformers, but whose HuggingFace config doesn't include it.
"""
import sys
import runpy


def _patch_auto_config() -> None:
    """
    vllm --model-impl transformers validates that either:
      1. The architecture is registered in the Transformers library, OR
      2. 'AutoModel' is present in the model config's auto_map.

    LightOnOCR satisfies neither by default. This patch adds 'AutoModel' to
    auto_map (pointing to the same class as the first model-related entry) so
    that vllm's ModelConfig pydantic validator passes.
    """
    try:
        import transformers

        _orig = transformers.AutoConfig.from_pretrained  # bound classmethod

        def _patched(pretrained_model_name_or_path, **kwargs):
            cfg = _orig(pretrained_model_name_or_path, **kwargs)
            auto_map = getattr(cfg, "auto_map", None) or {}
            if auto_map and "AutoModel" not in auto_map:
                for key, val in auto_map.items():
                    if "Model" in key:
                        cfg.auto_map["AutoModel"] = val
                        print(
                            f"[entrypoint] Injected auto_map['AutoModel'] = {val}",
                            flush=True,
                        )
                        break
            return cfg

        transformers.AutoConfig.from_pretrained = _patched
        print("[entrypoint] Patched AutoConfig.from_pretrained", flush=True)

    except Exception as exc:
        print(
            f"[entrypoint] Warning: could not patch AutoConfig: {exc}",
            file=sys.stderr,
            flush=True,
        )


def main() -> None:
    _patch_auto_config()

    args = sys.argv[1:]
    sys.argv = ["vllm.entrypoints.openai.api_server"] + args
    runpy.run_module(
        "vllm.entrypoints.openai.api_server",
        run_name="__main__",
        alter_sys=True,
    )


if __name__ == "__main__":
    main()
