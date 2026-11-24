# One image: builds the React app, then serves it and the whole API from FastAPI on port 8000.
FROM node:20-alpine AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app/api
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./
COPY database/ /app/database/
COPY --from=client /client/dist /app/client/dist
EXPOSE 8000
# Builds the demo database on first start only; PORT is set by hosts such as Railway.
CMD ["sh", "-c", "python -m scripts.init_db --if-empty && exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
