"""
Content Guardian — Access Key Manager CLI
==========================================
Database-backed key management: view, generate, and revoke access keys.
Called by key_manager.bat.
"""

import sqlite3
import secrets
import os
import sys
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content_guardian.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_table():
    """Make sure the access_keys table exists."""
    conn = get_db()
    conn.execute('''
    CREATE TABLE IF NOT EXISTS access_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_value TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER,
        description TEXT
    )
    ''')
    conn.commit()
    conn.close()


def list_keys():
    """Display all access keys."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, key_value, created_at, expires_at, revoked, description FROM access_keys ORDER BY created_at DESC"
    ).fetchall()
    conn.close()

    if not rows:
        print("\n  No access keys found.\n")
        return

    print(f"\n  {'ID':<6} {'Key':<40} {'Status':<10} {'Created':<20} {'Expires':<20} {'Description'}")
    print("  " + "-" * 120)
    for row in rows:
        status = "REVOKED" if row["revoked"] else "ACTIVE"
        expires = row["expires_at"] or "Never"
        desc = row["description"] or "-"
        print(f"  {row['id']:<6} {row['key_value']:<40} {status:<10} {row['created_at']:<20} {expires:<20} {desc}")
    print()


def generate_key():
    """Generate a new access key."""
    desc = input("\n  Enter description (optional, press Enter to skip): ").strip() or None
    days_input = input("  Expires in days (default 30, 0 for never): ").strip()

    try:
        days = int(days_input) if days_input else 30
    except ValueError:
        days = 30

    key_value = f"cg_{secrets.token_hex(16)}"
    now = datetime.now()
    expires_at = (now + timedelta(days=days)).isoformat() if days > 0 else None

    conn = get_db()
    conn.execute(
        "INSERT INTO access_keys (key_value, created_at, expires_at, description) VALUES (?, ?, ?, ?)",
        (key_value, now.isoformat(), expires_at, desc),
    )
    conn.commit()
    conn.close()

    print(f"\n  ✓ Key generated successfully!")
    print(f"  Key:     {key_value}")
    print(f"  Expires: {expires_at or 'Never'}\n")


def revoke_key():
    """Revoke an existing key by ID."""
    list_keys()
    key_id = input("  Enter key ID to revoke: ").strip()
    try:
        key_id = int(key_id)
    except ValueError:
        print("  Invalid ID.\n")
        return

    conn = get_db()
    result = conn.execute("UPDATE access_keys SET revoked = 1 WHERE id = ? AND revoked = 0", (key_id,))
    if result.rowcount == 0:
        print("  Key not found or already revoked.\n")
    else:
        print(f"  ✓ Key {key_id} revoked.\n")
    conn.commit()
    conn.close()


def main():
    ensure_table()

    while True:
        print("=" * 50)
        print("    CONTENT GUARDIAN — ACCESS KEY MANAGER")
        print("=" * 50)
        print()
        print("  1. View all access keys")
        print("  2. Generate new access key")
        print("  3. Revoke an access key")
        print("  4. Return to main menu")
        print()

        choice = input("  Select an option (1-4): ").strip()

        if choice == "1":
            list_keys()
        elif choice == "2":
            generate_key()
        elif choice == "3":
            revoke_key()
        elif choice == "4":
            break
        else:
            print("  Invalid option.\n")


if __name__ == "__main__":
    main()
