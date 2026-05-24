FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python packages directly to avoid separate requirements file
RUN pip install --no-cache-dir \
    flask \
    numpy \
    pandas \
    xgboost \
    joblib \
    scikit-learn

COPY model_service.py .

EXPOSE 5000

ENTRYPOINT ["python", "model_service.py"]
