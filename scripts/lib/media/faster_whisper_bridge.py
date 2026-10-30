#!/usr/bin/env python
"""faster-whisper bridge: the GPU alternative to whisper.cpp.

clip-everything shells out to whisper-cli by default. On a CUDA machine that is
the slow path: whisper.cpp needs a CUDA-enabled build, which is not what the
Windows release ships. faster-whisper (CTranslate2) runs on an ordinary GPU with
pip-installed wheels, so this script exposes it with an interface close enough
to whisper-cli that the Node side can swap backends.

    python faster_whisper_bridge.py --model <dir> --audio <wav> --out <prefix> \
        --language zh --device cuda --compute float32

Writes <prefix>.srt and prints one JSON line with the detected language, the
audio duration and the realtime factor. Progress goes to stderr as
"progress = N%", the same shape whisper.cpp uses.
"""

import argparse
import json
import os
import site
import sys
import time


def add_cuda_dlls() -> None:
    """The nvidia-* wheels keep cuBLAS/cuDNN outside PATH; add them ourselves."""
    roots = set()
    try:
        roots.update(p for p in site.getsitepackages() if p)
    except Exception:
        pass
    try:
        roots.add(site.getusersitepackages())
    except Exception:
        pass

    for root in roots:
        for package in ("cublas", "cudnn", "cuda_nvrtc"):
            folder = os.path.join(root, "nvidia", package, "bin")
            if not os.path.isdir(folder):
                continue
            os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(folder)
                except OSError:
                    pass


def stamp(seconds: float) -> str:
    total = int(round(max(0.0, float(seconds)) * 1000))
    hours, total = divmod(total, 3600000)
    minutes, total = divmod(total, 60000)
    secs, millis = divmod(total, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def main() -> int:
    parser = argparse.ArgumentParser(description="faster-whisper bridge for clip-everything")
    parser.add_argument("--model", required=True, help="model directory or Hugging Face id")
    parser.add_argument("--audio", required=True, help="16 kHz mono wav")
    parser.add_argument("--out", required=True, help="output prefix (no extension)")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", default="auto", help="cuda | cpu | auto")
    parser.add_argument("--compute", default="", help="float16 | float32 | int8_float16 | ...")
    parser.add_argument("--beam", type=int, default=5)
    parser.add_argument("--threads", type=int, default=0, help="CPU threads when device=cpu")
    parser.add_argument("--vad", default="on", choices=["on", "off"])
    args = parser.parse_args()

    add_cuda_dlls()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write(
            "faster-whisper is not installed. Run:\n"
            "  python -m pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12\n"
        )
        return 2

    device = args.device
    if device == "auto":
        device = "cuda"
    compute = args.compute
    if not compute:
        # Pascal (GTX 10x0) has no efficient float16 path in CTranslate2.
        compute = "float16" if device == "cuda" else "int8"

    started = time.time()
    try:
        model = WhisperModel(args.model, device=device, compute_type=compute, cpu_threads=args.threads or 0)
    except ValueError as error:
        if "float16" in str(error):
            sys.stderr.write("[info] float16 unsupported on this GPU, retrying with float32\n")
            compute = "float32"
            model = WhisperModel(args.model, device=device, compute_type=compute, cpu_threads=args.threads or 0)
        else:
            raise

    language = None if args.language in ("auto", "", None) else args.language
    segments, info = model.transcribe(
        args.audio,
        language=language,
        beam_size=args.beam,
        vad_filter=args.vad == "on",
        condition_on_previous_text=False,
    )

    duration = float(getattr(info, "duration", 0) or 0)
    lines = []
    count = 0
    for index, segment in enumerate(segments, start=1):
        count += 1
        lines.append(f"{index}\n{stamp(segment.start)} --> {stamp(segment.end)}\n{segment.text.strip()}\n")
        if duration and index % 20 == 0:
            sys.stderr.write(f"progress = {min(99, int(segment.end / duration * 100))}%\n")
            sys.stderr.flush()

    with open(args.out + ".srt", "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))

    elapsed = time.time() - started
    sys.stderr.write("progress = 100%\n")
    sys.stdout.write(
        json.dumps(
            {
                "language": getattr(info, "language", None),
                "duration": round(duration, 1),
                "segments": count,
                "compute": compute,
                "device": device,
                "elapsedMs": int(elapsed * 1000),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
