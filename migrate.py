"""
migrate.py — Safe database migration script.
Adds all new enrichment columns to the existing leads table without data loss.
Run once: python migrate.py
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "scraper.db")

NEW_COLUMNS = [
    # Tier 1 — Google Maps extra fields
    ("hours_of_operation",    "TEXT"),
    ("is_claimed",            "INTEGER"),   # 0/1 (boolean)
    ("photos_count",          "INTEGER"),
    ("is_permanently_closed", "INTEGER DEFAULT 0"),
    ("location_type",         "TEXT"),      # "Single Location" / "Multi-Location"

    # Tier 1 — Website fields
    ("email",                 "TEXT"),
    ("whatsapp_link",         "TEXT"),
    ("facebook_url",          "TEXT"),
    ("instagram_url",         "TEXT"),
    ("linkedin_url",          "TEXT"),
    ("twitter_url",           "TEXT"),
    ("tiktok_url",            "TEXT"),
    ("youtube_url",           "TEXT"),
    ("tech_stack",            "TEXT"),
    ("has_live_chat",         "INTEGER"),
    ("has_online_booking",    "INTEGER"),
    ("copyright_year",        "INTEGER"),
    ("social_presence_score", "INTEGER"),
    ("auto_enrichment_status","TEXT DEFAULT 'pending'"),

    # Tier 2 — LLM fields
    ("pain_points",            "TEXT"),
    ("positive_themes",        "TEXT"),
    ("review_sentiment_trend", "TEXT"),
    ("owner_response_rate",    "TEXT"),
    ("team_size_estimate",     "TEXT"),
    ("business_summary",       "TEXT"),
    ("lead_score",             "INTEGER"),
    ("lead_score_reason",      "TEXT"),
    ("locations_summary",      "TEXT"),
    ("llm_enrichment_status",  "TEXT DEFAULT 'pending'"),
]


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get existing columns
    cursor.execute("PRAGMA table_info(leads)")
    existing_cols = {row[1] for row in cursor.fetchall()}

    added = 0
    for col_name, col_type in NEW_COLUMNS:
        if col_name not in existing_cols:
            sql = f"ALTER TABLE leads ADD COLUMN {col_name} {col_type}"
            cursor.execute(sql)
            print(f"  ✓ Added column: {col_name}")
            added += 1
        else:
            print(f"  — Skipped (exists): {col_name}")

    conn.commit()
    conn.close()
    print(f"\nMigration complete. {added} column(s) added.")


if __name__ == "__main__":
    print(f"Running migration on: {DB_PATH}\n")
    migrate()
