# FestPass analytics image (FastAPI, read-only).
# Build: docker build -t festpass-analytics reports
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production
WORKDIR /app
COPY requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY app/ app/
RUN useradd --system --uid 10001 festpass
USER festpass
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/analytics/health', timeout=4)" || exit 1
# Access logging is done by the app itself (JSON lines with request ids).
# The config check runs once before uvicorn, so a bad secret stops the container instead of looping workers.
CMD ["sh", "-c", "python -c 'from app.config import validate; validate()' && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
