"""Run pinned modules' native_sim event snapshots, without a physical board.

Fixture sources and expected snapshots belong to cormoran's MIT modules.
This validates those fixtures only, not Ryong60 hardware or power-loss safety.
"""
from pathlib import Path
import re
import subprocess
import sys

def secured_snapshot(text):
    # Our deliberate hardening changes these metadata lines only.
    # Never remove security lines or accept both secured/unsecured output.
    for identifier in ("cormoran__runtime_combo", "cormoran__runtime_macro", "cormoran_custom_settings"):
        text = text.replace(f"{identifier}, Security: Unsecured",
                            f"{identifier}, Security: Secured")
    return text


def main():
    workspace = Path(sys.argv[1]).resolve()
    modules = ["zmk-feature-runtime-combo", "zmk-feature-runtime-macro", "zmk-feature-custom-settings"]
    extra = ";".join(str(workspace / name) for name in modules)
    cases = {
        "zmk-feature-runtime-combo": ["test", "studio", "overrides", "defaults", "discard"],
        "zmk-feature-runtime-macro": ["test", "studio"],
    }
    for module, names in cases.items():
        for name in names:
            fixture = workspace / module / "tests" / name
            build = workspace / "sim-build" / module / name
            print(f"Build native_sim: {module}/{name}", flush=True)
            subprocess.run([
                "west", "build", "-s", str(workspace / "zmk/app"),
                "-d", str(build), "-b", "native_sim//zmk_test_mock",
                "--", "-DCONFIG_ASSERT=y", f"-DZMK_CONFIG={fixture}",
                f"-DZMK_EXTRA_MODULES={extra}",
            ], cwd=workspace, check=True, timeout=600)
            result = subprocess.run([str(build / "zephyr/zmk.exe")],
                                    capture_output=True, text=True, timeout=60, check=True)
            output = "".join(re.sub(r".*> ", "", line)
                             for line in (result.stdout + result.stderr).splitlines(True))
            (build / "events-full.log").write_text(output)
            filtered = subprocess.run(["sed", "-n", "-f", str(fixture / "events.patterns")],
                                      input=output, capture_output=True, text=True, check=True).stdout
            expected = secured_snapshot((fixture / "keycode_events.snapshot").read_text())
            (build / "events.log").write_text(filtered)
            normalize = lambda s: [line.rstrip() for line in s.splitlines()]
            if normalize(filtered) != normalize(expected):
                raise SystemExit(f"Snapshot mismatch: {module}/{name}\n{filtered}")
            print(f"PASS: {module}/{name}", flush=True)


if __name__ == "__main__":
    main()
