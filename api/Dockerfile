FROM python:3.14-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install dependencies (cached layer)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy source
COPY app/ ./app/
COPY alembic.ini ./

# Run migrations then start server
CMD uv run alembic upgrade head && uv run fastapi run app/main.py --host 0.0.0.0 --port 8000
