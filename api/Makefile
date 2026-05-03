.PHONY: dev test lint typecheck

dev:
	uv run fastapi dev app/main.py

test:
	uv run pytest tests/ -v

lint:
	uv run ruff check app/ tests/

typecheck:
	uv run pyright app/
