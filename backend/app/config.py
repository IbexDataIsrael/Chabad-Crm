"""Application configuration loaded from environment variables.

Values come from `backend/.env` locally, or from the `env_file` injected by
docker-compose in containers (see CLAUDE.md for the required keys).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/crm.sqlite3"
    secret_key: str = "change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # Default demo organization + admin seeded on startup (override via env).
    demo_org_name: str = "ארגון הדגמה"
    admin_username: str = "admin"
    admin_password: str = "admin123"
    admin_full_name: str = "מנהל מערכת"
    admin_email: str = "admin@demo.local"

    # Google Geocoding API key (server-side fallback to fill lat/lng from an address).
    geocoding_api_key: str = ""

    # Google Sign-In (GIS token flow): the backend verifies ID tokens against this.
    google_client_id: str = ""
    google_client_secret: str = ""

    # Reminder scheduler: how often (seconds) to scan for due significant-date reminders.
    reminder_scan_interval_seconds: int = 300

    # Signup email verification.
    frontend_url: str = "http://localhost:3001"
    verification_token_expire_hours: int = 24
    # SMTP (optional): if smtp_host is empty, verification links are logged to the console.
    email_from: str = "no-reply@crm.local"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""


settings = Settings()
