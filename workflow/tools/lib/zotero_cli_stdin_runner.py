from __future__ import annotations

import argparse
import json
import sys

from cli_anything.zotero.core import discovery, jsbridge


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wait", type=int, default=30)
    args = parser.parse_args()
    code = sys.stdin.read()
    if not code:
        print(json.dumps({"ok": False, "data": None, "error": "stdin_js_required"}))
        return 2
    runtime = discovery.build_runtime_context()
    result = jsbridge.JSBridgeClient(port=runtime.environment.port).execute_js(
        code, wait_seconds=max(1, args.wait)
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
