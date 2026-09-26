"""Delete all Digital Wallet Simulator data from Supabase while keeping the schema."""

import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent


def load_dotenv():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in your environment or .env file.")

    print("WARNING: This permanently deletes ALL Digital Wallet Simulator data from Supabase.")
    print("It keeps the tables, functions, indexes and Realtime configuration.")
    confirmation = input('Type DELETE ALL WALLET DATA to continue: ').strip()
    if confirmation != "DELETE ALL WALLET DATA":
        print("Cancelled.")
        return

    endpoint = f"{url}/rest/v1/rpc/reset_all_wallet_data"
    request = Request(
        endpoint,
        method="POST",
        data=b"{}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=30) as response:
            payload = response.read().decode("utf-8")
            result = json.loads(payload) if payload else {}
            print(result.get("message", "All wallet data was deleted."))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase returned HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise SystemExit(f"Unable to reach Supabase: {exc.reason}") from exc


if __name__ == "__main__":
    main()
