"""Shared helpers for launching the pre-installed Chromium via Playwright.

The Claude Code web/remote environment ships a Chromium build under
``$PLAYWRIGHT_BROWSERS_PATH`` (default ``/opt/pw-browsers``).  The pip
``playwright`` package may target a *different* browser build number than the
one baked into the image, so ``chromium.launch()`` with the default download
path can fail with "Executable doesn't exist".  We therefore resolve the real
Chromium binary ourselves and pass it via ``executable_path``.

Resolution order (first hit wins):
  1. ``$PLAYWRIGHT_EXECUTABLE_PATH`` if set and existing.
  2. The stable ``$PLAYWRIGHT_BROWSERS_PATH/chromium`` symlink.
  3. Glob ``$PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome``.
  4. ``None`` -> let Playwright find its own browser (works on a normal box
     where ``playwright install`` has been run).
"""
from __future__ import annotations

import glob
import os
from typing import Optional


def resolve_chromium_path() -> Optional[str]:
    """Return an absolute path to a usable Chromium binary, or None."""
    env = os.environ.get("PLAYWRIGHT_EXECUTABLE_PATH")
    if env and os.path.exists(env):
        return env

    base = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")

    symlink = os.path.join(base, "chromium")
    if os.path.exists(symlink):
        return symlink

    matches = sorted(glob.glob(os.path.join(base, "chromium-*", "chrome-linux", "chrome")))
    if matches:
        # Highest build number last.
        return matches[-1]

    return None


# Args that keep Chromium happy inside a restricted container.
DEFAULT_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]


def launch_kwargs(headless: bool = True) -> dict:
    """Build kwargs for ``playwright.chromium.launch(**kwargs)``."""
    kwargs: dict = {"headless": headless, "args": list(DEFAULT_LAUNCH_ARGS)}
    exe = resolve_chromium_path()
    if exe:
        kwargs["executable_path"] = exe
    return kwargs
