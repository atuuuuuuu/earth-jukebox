"""Web-sized H.264 copies of NASA videos (ffmpeg binary comes from the imageio-ffmpeg package)."""
from __future__ import annotations

import subprocess
from pathlib import Path


def to_web_mp4(src: Path, dest: Path, width: int, height: int, crf: int = 23, keyint: int = 15) -> None:
    """Silent, seek-friendly MP4: a keyframe every `keyint` frames so scrubbing stays snappy."""
    import imageio_ffmpeg

    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
        "-an", "-vf", f"scale={width}:{height}:flags=lanczos",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-g", str(keyint),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dest),
    ]
    subprocess.run(cmd, check=True)
