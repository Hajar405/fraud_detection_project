FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir requests

COPY streaming_simulator.py .

ENTRYPOINT ["python", "-u", "streaming_simulator.py"]

