#!/usr/bin/env python3
import os
import sqlite3
import sys

DB_PATH = os.path.join("backend", "data", "crm.sqlite3")

def print_help():
    print("\n💡 Interactive Database Explorer")
    print("---------------------------------")
    print("• Type any SQL query ending with a semicolon (;) to execute it.")
    print("• Type '.tables' to list all database tables.")
    print("• Type '.schema <table_name>' to show the schema for a table.")
    print("• Type '.exit' or '.quit' to close the explorer.\n")

def list_tables(cursor):
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    tables = cursor.fetchall()
    print("\n📂 Database Tables:")
    for t in tables:
        # Get count
        cursor.execute(f"SELECT COUNT(*) FROM {t[0]};")
        count = cursor.fetchone()[0]
        print(f"  - {t[0]:<30} ({count} rows)")
    print()

def show_schema(cursor, table_name):
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;", (table_name,))
    schema = cursor.fetchone()
    if schema:
        print(f"\n📝 Schema for table '{table_name}':")
        print(schema[0])
        print()
    else:
        print(f"❌ Table '{table_name}' not found.\n")

def format_row(val):
    if val is None:
        return "NULL"
    if isinstance(val, bytes):
        return f"<blob: {len(val)}b>"
    val_str = str(val).replace("\n", " ")
    if len(val_str) > 40:
        return val_str[:37] + "..."
    return val_str

def execute_query(cursor, query):
    try:
        cursor.execute(query)
        if cursor.description:
            # Select query: print columns and rows
            cols = [col[0] for col in cursor.description]
            rows = cursor.fetchall()
            
            if not rows:
                print("\n✅ Query returned 0 rows.\n")
                return

            # Determine column widths
            col_widths = [len(c) for c in cols]
            formatted_rows = []
            for r in rows:
                f_row = [format_row(val) for val in r]
                formatted_rows.append(f_row)
                for idx, val in enumerate(f_row):
                    col_widths[idx] = max(col_widths[idx], len(val))

            # Cap widths at 40 max to avoid line wrapping
            col_widths = [min(w, 40) for w in col_widths]

            # Print header line
            header_parts = [f"{cols[i]:<{col_widths[i]}}" for i in range(len(cols))]
            separator_parts = ["-" * col_widths[i] for i in range(len(cols))]
            
            print("\n" + " | ".join(header_parts))
            print("-+-".join(separator_parts))
            
            # Print rows
            for f_row in formatted_rows:
                row_parts = [f"{f_row[i]:<{col_widths[i]}}" for i in range(len(f_row))]
                print(" | ".join(row_parts))
            print(f"\n🎉 {len(rows)} row(s) returned.\n")
        else:
            # Write query (INSERT/UPDATE/DELETE/DDL)
            conn.commit()
            print(f"\n✅ Command executed successfully. Rows affected: {cursor.rowcount}\n")
    except sqlite3.Error as e:
        print(f"\n❌ SQL Error: {e}\n")

if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        print(f"❌ Database file not found at: {DB_PATH}")
        print("Please verify the backend container is running and has been copied locally.")
        sys.exit(1)

    print(f"🔌 Connected to SQLite database at: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print_help()
    list_tables(cursor)

    buffer = ""
    while True:
        try:
            prompt = "sql> " if not buffer else "   > "
            line = input(prompt).strip()
            
            if not line:
                continue
            
            if line.lower() in [".exit", ".quit", "exit", "quit"]:
                break
            
            if line.lower() == ".help":
                print_help()
                continue
                
            if line.lower() == ".tables":
                list_tables(cursor)
                continue
                
            if line.lower().startswith(".schema"):
                parts = line.split()
                if len(parts) > 1:
                    show_schema(cursor, parts[1])
                else:
                    print("❌ Usage: .schema <table_name>")
                continue
            
            buffer += " " + line
            if buffer.strip().endswith(";"):
                execute_query(cursor, buffer.strip())
                buffer = ""
                
        except (KeyboardInterrupt, EOFError):
            print("\n👋 Exiting database explorer.")
            break

    conn.close()
