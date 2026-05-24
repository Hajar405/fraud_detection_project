import os
import joblib
import json
import numpy as np
import pandas as pd
import xgboost as xgb
from flask import Flask, request, jsonify

app = Flask(__name__)

# Paths to ML assets
def get_model_dir():
    possible_paths = [
        "/model",
        "/models_a _utiliser",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models_a _utiliser"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "models_a _utiliser"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "model")
    ]
    for path in possible_paths:
        if os.path.exists(os.path.join(path, "fraud_xgb_model.json")):
            print(f"Found model directory at: {path}")
            return path
    # Default fallback
    return possible_paths[2]

MODEL_DIR = get_model_dir()
MODEL_PATH = os.path.join(MODEL_DIR, "fraud_xgb_model.json")
ENCODERS_PATH = os.path.join(MODEL_DIR, "label_encoders.pkl")
CONFIG_PATH = os.path.join(MODEL_DIR, "pipeline_config.json")

# Global variables to store loaded assets
model = None
encoders = None
config = None
threshold_final = 0.296263887480833 # default threshold

def load_assets():
    global model, encoders, config, threshold_final
    print(f"Loading ML assets from directory: {MODEL_DIR}")
    
    # Load XGBoost model
    model = xgb.XGBClassifier()
    model.load_model(MODEL_PATH)
    print("✅ XGBoost model loaded successfully.")
    
    # Load Label Encoders
    encoders = joblib.load(ENCODERS_PATH)
    print("✅ Label encoders loaded successfully.")
    
    # Load Config
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            config = json.load(f)
        threshold_final = config.get("threshold_final", threshold_final)
        print(f"✅ Pipeline config loaded. Final threshold: {threshold_final}")
    else:
        print(f"⚠️ Pipeline config not found, using default threshold: {threshold_final}")

def haversine_km(lat1, lon1, lat2, lon2):
    """Distance in km on the sphere terrestre (formule Haversine)."""
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    return 2 * R * np.arcsin(np.sqrt(a))

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "No input data provided"}), 400
        
        # 1. Parse Transaction Date and DOB
        trans_date = pd.to_datetime(data.get("trans_date", pd.Timestamp.now()))
        dob = pd.to_datetime(data.get("dob", "1990-01-01"))
        ref_date = pd.Timestamp("2020-01-01")
        
        # 2. Extract Temporal Features
        trans_hour = int(trans_date.hour)
        trans_dayofweek = int(trans_date.dayofweek)
        trans_month = int(trans_date.month)
        is_weekend = int(trans_dayofweek >= 5)
        is_night = int(trans_hour >= 22 or trans_hour <= 5)
        is_peak_fraud_hour = int(trans_hour in [22, 23, 0, 1, 2])
        age = int((ref_date - dob).days // 365)
        
        # 3. Preprocess Amount (Winsorization limits: 1.26 to 545.99)
        amt = float(data.get("amt", 0.0))
        amt_clipped = np.clip(amt, 1.26, 545.99)
        amt_log = float(np.log1p(amt_clipped))
        
        # 4. Compute Distance KM
        lat = float(data.get("lat", 0.0))
        lon = float(data.get("long", 0.0))
        merch_lat = float(data.get("merch_lat", 0.0))
        merch_lon = float(data.get("merch_long", 0.0))
        distance_km = float(haversine_km(lat, lon, merch_lat, merch_lon))
        
        # 5. Combined Outlier Check (amt_p90 = 136.67, dist_p90 = 112.82)
        combined_outlier = int(amt > 136.67 and distance_km > 112.82)
        
        # 6. Label Encoding
        encoded_features = {}
        cat_cols = ['category', 'gender', 'state', 'merchant', 'job', 'city']
        for col in cat_cols:
            val = str(data.get(col, ""))
            le = encoders.get(col)
            if le is not None:
                if val in le.classes_:
                    encoded_features[col] = int(le.transform([val])[0])
                else:
                    # Fallback to the first class
                    encoded_features[col] = 0
            else:
                encoded_features[col] = 0
                
        # 7. Assemble 17 final feature columns in EXACT order
        features_dict = {
            "merchant": encoded_features["merchant"],
            "category": encoded_features["category"],
            "gender": encoded_features["gender"],
            "city": encoded_features["city"],
            "state": encoded_features["state"],
            "city_pop": int(data.get("city_pop", 1000)),
            "job": encoded_features["job"],
            "trans_hour": trans_hour,
            "trans_dayofweek": trans_dayofweek,
            "trans_month": trans_month,
            "is_weekend": is_weekend,
            "is_night": is_night,
            "is_peak_fraud_hour": is_peak_fraud_hour,
            "age": age,
            "amt_log": amt_log,
            "distance_km": distance_km,
            "combined_outlier": combined_outlier
        }
        
        # Convert to Pandas DataFrame to preserve column names order for XGBoost
        features_df = pd.DataFrame([features_dict])
        
        # 8. Run Model Inference
        proba = float(model.predict_proba(features_df)[0, 1])
        is_fraud = bool(proba >= threshold_final)
        risk_score = float(round(proba * 100, 2))
        
        # Calculate Confidence Score: 0 to 100 scale representing prediction certainty
        if is_fraud:
            confidence = (proba - threshold_final) / (1.0 - threshold_final)
        else:
            confidence = (threshold_final - proba) / threshold_final
        confidence_score = float(round(confidence * 100, 2))
        
        return jsonify({
            "isFraud": is_fraud,
            "riskScore": risk_score,
            "confidenceScore": confidence_score,
            "probability": proba,
            "details": {
                "distance_km": round(distance_km, 2),
                "amt_log": round(amt_log, 4),
                "combined_outlier": combined_outlier,
                "age": age
            }
        })
        
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "model": "loaded" if model else "unloaded"})

if __name__ == "__main__":
    load_assets()
    app.run(host="0.0.0.0", port=5000)
