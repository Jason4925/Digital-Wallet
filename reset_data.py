import json
from pathlib import Path

DATA_PATH = Path(__file__).with_name("data.json")

EMPTY_DATA = {
    "version": 2,
    "users": [],
    "profiles": [],
    "wallets": [],
    "wallet_security": [],
    "transactions": [],
    "contacts": [],
    "budgets": [],
    "recurring_payments": [],
    "notifications": []
}

DATA_PATH.write_text(json.dumps(EMPTY_DATA, indent=2), encoding="utf-8")
print(f"Reset complete: {DATA_PATH}")
print("All simulator accounts and activity were removed from data.json.")
