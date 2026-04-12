import asyncio
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "scraper.db")

def run_migration():
    if not os.path.exists(DB_PATH):
        print("Database not found. Make sure the app has run at least once.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("ALTER TABLE groups ADD COLUMN user_id INTEGER;")
        print("Added user_id to groups table.")
    except sqlite3.OperationalError as e:
        # If the column already exists, this catches the exception
        if "duplicate column name" in str(e).lower():
            print("user_id column already exists in groups.")
        else:
            print(f"Error altering groups table: {e}")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    run_migration()
