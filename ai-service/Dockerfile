FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /service
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
USER 65532:65532
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"$AI_BIND_HOST\" --port 18082"]
