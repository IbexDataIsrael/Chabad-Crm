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

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
