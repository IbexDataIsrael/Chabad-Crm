FROM python:3.12-slim

WORKDIR /app

# Install pipenv and project dependencies into the system environment.
RUN pip install --no-cache-dir pipenv
COPY Pipfile ./
# --dev installs pytest/httpx too so the test suite runs in-container.
RUN pipenv install --dev --system --skip-lock

# Copy application code.
COPY . .

# Ensure the SQLite data directory exists.
RUN mkdir -p /app/data

EXPOSE 8000

# Security/deploy hardening: no --reload (dev-only file watcher; wastes
# resources and is explicitly documented by uvicorn as unsafe for production).
# Shell form so $PORT (injected by some hosts) is honored, falling back to
# 8000 to match docker-compose's fixed port mapping. Local dev re-adds
# --reload via docker-compose.yml's `command:` override.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
