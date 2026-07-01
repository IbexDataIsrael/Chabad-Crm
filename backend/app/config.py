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

    # Comma-separated list of allowed CORS origins (the frontend's public URL(s)).
    # Defaults to local dev; production sets CORS_ORIGINS to the deployed domain.
    cors_origins: str = "http://localhost:3001"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # Whether to seed the demo organization + admin + sample data on startup.
    # MUST be false in production (otherwise a known default admin/admin123 and
    # fake contacts land in the live DB). Global localization labels always seed.
    seed_demo_data: bool = True

    # Default demo organization + admin seeded on startup (override via env).
    demo_org_name: str = "ארגון הדגמה"
    admin_username: str = "admin"
    admin_password: str = "admin123"
    admin_full_name: str = "מנהל מערכת"
    admin_email: str = "admin@demo.local"

    # Google Geocoding API key (server-side fallback to fill lat/lng from an address).
    geocoding_api_key: str = ""

    # Cloudinary signed upload. The secret stays server-side: the backend signs
    # upload params (see routers/uploads.py) and the browser POSTs the file +
    # signature straight to Cloudinary. cloud_name is public; api_secret is NOT.
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    # Folder all uploaded logos land in (namespaces the asset library).
    cloudinary_upload_folder: str = "org_logos"

    @property
    def cloudinary_configured(self) -> bool:
        return bool(
            self.cloudinary_cloud_name
            and self.cloudinary_api_key
            and self.cloudinary_api_secret
        )

    # Google Sign-In (GIS token flow): the backend verifies ID tokens against this.
    google_client_id: str = ""
    google_client_secret: str = ""

    # Reminder scheduler: how often (seconds) to scan for due significant-date reminders.
    reminder_scan_interval_seconds: int = 300

    # Platform superadmin (cross-tenant "system admin"). Seeded on startup into a
    # dedicated System organization when BOTH email + password are provided (set
    # them on Render). Cannot be created via public signup. Leave empty to disable.
    superadmin_email: str = ""
    superadmin_password: str = ""
    superadmin_name: str = "System Administrator"
    system_org_name: str = "System"

    # When False (the current default), public signup skips the email-verification
    # round-trip: the org's admin is created already active + verified and logged
    # in immediately ("old school" username+password). Flip to True once a real
    # transactional-email domain is set up to re-enable the verify-by-email flow.
    require_email_verification: bool = False

    # Signup email verification. Defaults to the production frontend so email
    # links are correct even if FRONTEND_URL isn't set on the host; local dev
    # overrides it via backend/.env.
    frontend_url: str = "https://minicrm-ibexdata.vercel.app"
    verification_token_expire_hours: int = 24
    # SMTP. Host/user/from default to the project's Gmail sender; only the app
    # password is a secret that must be provided (via SMTP_PASSWORD env). When
    # the password is empty, send_email falls back to logging (dev-safe).
    email_from: str = "ibexprogrammer@gmail.com"
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = "ibexprogrammer@gmail.com"
    smtp_password: str = ""


settings = Settings()
