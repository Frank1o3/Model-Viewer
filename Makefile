.PHONY: fmt lint typecheck test check install clean

# ── Dev helpers ────────────────────────────────
install:
	poetry install

fmt:
	poetry run ruff format .

lint:
	poetry run ruff check .

typecheck:
	poetry run mypy .

# ── Shortcuts ──────────────────────────────────
ruff: fmt lint

# ── CI-safe: verify only, no modifications ─────
check: lint typecheck

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name .mypy_cache -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	find . -type d -name .cache -exec rm -rf {} +
