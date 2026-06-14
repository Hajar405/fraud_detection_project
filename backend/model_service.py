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
        
        # 2. Extract Temporal Features
        trans_hour = int(trans_date.hour)
        trans_dayofweek = int(trans_date.dayofweek)
        trans_month = int(trans_date.month)
        is_weekend = int(trans_dayofweek >= 5)
        is_night = int(trans_hour >= 22 or trans_hour <= 5)
        is_peak_fraud_hour = int(trans_hour in [22, 23, 0, 1, 2])
        
        # Robust age calculation relative to transaction date
        age = int((trans_date - dob).days // 365)
        if age < 18 or age > 95:
            # Fallback to realistic age range
            age = int(np.clip(age, 18, 90))
        
        # 3. Preprocess Amount
        amt = float(data.get("amt", 0.0))
        category_name = str(data.get("category", "")).lower()
            
        # Standard Winsorization for model input (1.26 to 545.99)
        amt_clipped = np.clip(amt, 1.26, 545.99)
        amt_log = float(np.log1p(amt_clipped))
        
        # 4. Extract inputs and coordinates
        lat = float(data.get("lat", 0.0))
        lon = float(data.get("long", 0.0))
        merch_lat = float(data.get("merch_lat", 0.0))
        merch_lon = float(data.get("merch_long", 0.0))
        
        city_input = str(data.get("city", "")).strip().lower()
        state_input = str(data.get("state", "")).strip().upper()
        
        # Bounding box of continental USA
        is_user_coords_out = not (24.0 <= lat <= 50.0 and -125.0 <= lon <= -66.0)
        is_merch_coords_out = not (24.0 <= merch_lat <= 50.0 and -125.0 <= merch_lon <= -66.0)

        # ── Moroccan city mapping to US equivalents ───────────────────────────
        # Each Moroccan city is matched to a US city of similar population size
        # that exists in the model's label encoders.
        # Population references (2024):
        #   Casablanca  ~3.7M  → Houston, TX       ~2.3M  (largest available)
        #   Rabat       ~577K  → Memphis, TN        ~633K
        #   Marrakech   ~928K  → Indianapolis, IN   ~880K
        #   Fès         ~1.1M  → San Jose, CA       ~1.0M
        #   Tanger      ~947K  → Jacksonville, FL   ~949K  (closest match)
        #   Agadir      ~421K  → Louisville, KY     ~633K  (closest available)
        #   Meknès      ~632K  → Memphis, TN        ~633K
        #   Oujda       ~494K  → Sacramento, CA     ~500K
        #   Kenitra     ~431K  → Portland, OR       ~652K
        #   Tétouan     ~380K  → Norfolk, VA        ~238K  (closest available)
        # All Moroccan GPS coordinates are outside the US bounding box,
        # so is_user_coords_out will always be True for Moroccan inputs.
        # The mapping below sets user_lat/user_lon to the equivalent US city.
        MOROCCO_CITY_MAP = {
            # Moroccan city name (lowercase) → (us_city, us_state, us_lat, us_lon, city_pop)
            "casablanca":  ("Houston",      "TX", 29.7604, -95.3698, 2300000),
            "rabat":       ("Murfreesboro",  "TN", 35.8456, -86.3903, 633000),
            "marrakech":   ("Indianapolis",  "IN", 39.7684, -86.1581, 880000),
            "marrakesh":   ("Indianapolis",  "IN", 39.7684, -86.1581, 880000),
            "fes":         ("San Jose",      "CA", 37.3382, -121.8863, 1000000),
            "fez":         ("San Jose",      "CA", 37.3382, -121.8863, 1000000),
            "fès":         ("San Jose",      "CA", 37.3382, -121.8863, 1000000),
            "tanger":      ("Port Saint Lucie", "FL", 27.2939, -80.3503, 949000),
            "tangier":     ("Port Saint Lucie", "FL", 27.2939, -80.3503, 949000),
            "agadir":      ("Sacramento",    "CA", 38.5816, -121.4944, 521000),
            "meknes":      ("Murfreesboro",  "TN", 35.8456, -86.3903, 633000),
            "meknès":      ("Murfreesboro",  "TN", 35.8456, -86.3903, 633000),
            "oujda":       ("Sacramento",    "CA", 38.5816, -121.4944, 500000),
            "kenitra":     ("Portland",      "OR", 45.5051, -122.6750, 431000),
            "tetouan":     ("Norfolk",       "VA", 36.8508, -76.2859, 380000),
            "tétouan":     ("Norfolk",       "VA", 36.8508, -76.2859, 380000),
            "sale":        ("Murfreesboro",  "TN", 35.8456, -86.3903, 890000),
            "salé":        ("Murfreesboro",  "TN", 35.8456, -86.3903, 890000),
            "el jadida":   ("San Antonio",   "TX", 29.4241, -98.4936, 194000),
            "beni mellal": ("Springfield",   "IL", 39.7817, -89.6501, 187000),
            "nador":       ("Mobile",        "AL", 30.6954, -88.0399, 151000),
            "settat":      ("Mobile",        "AL", 30.6954, -88.0399, 142000),
            "khouribga":   ("Mobile",        "AL", 30.6954, -88.0399, 196000),
            "laayoune":    ("San Antonio",   "TX", 29.4241, -98.4936, 217000),
        }

        # Also handle Moroccan state/region codes
        MOROCCO_STATE_MAP = {
            # Moroccan region code → best matching US state
            "MA": "TX",   # Maroc → Texas (default fallback)
            "CA": "CA",   # Casablanca-Settat → California (already valid in encoder)
            "OR": "OR",   # Oriental → Oregon (already valid)
            "SM": "TN",   # Souss-Massa → Tennessee
            "GS": "FL",   # Guelmim-Oued Noun → Florida
            "TT": "VA",   # Tanger-Tétouan-Al Hoceïma → Virginia
            "MK": "TN",   # Meknès-Fès → Tennessee
            "MR": "IN",   # Marrakech-Safi → Indiana
            "RB": "TX",   # Rabat-Salé-Kénitra → Texas
        }

        # Perform city-level lookup first
        matched = MOROCCO_CITY_MAP.get(city_input)
        if matched:
            normalized_city, normalized_state, user_lat, user_lon, city_pop = matched
            print(f"[Mapping] Moroccan city '{city_input}' → US '{normalized_city}, {normalized_state}'")
        elif state_input in MOROCCO_STATE_MAP:
            # Region-level fallback: map Moroccan region to a US state
            normalized_state = MOROCCO_STATE_MAP[state_input]
            normalized_city = "Houston"   # default large city for unknown Moroccan cities
            user_lat, user_lon = 29.7604, -95.3698
            city_pop = int(data.get("city_pop", 500000))
            print(f"[Mapping] Moroccan region '{state_input}' → US state '{normalized_state}'")
        elif city_input == "paris" or state_input == "FR":
            # Keep existing France → Paris TX mapping
            normalized_city = "Paris"
            normalized_state = "TX"
            user_lat, user_lon = 33.6609, -95.5555
            city_pop = 25000
        elif city_input == "dallas" or state_input == "TX":
            normalized_city = "Dallas"
            normalized_state = "TX"
            user_lat, user_lon = 32.7767, -96.7970
            city_pop = 1500000
        elif city_input == "adams" or state_input == "NY":
            normalized_city = "Adams"
            normalized_state = "NY"
            user_lat, user_lon = 40.7128, -74.0060
            city_pop = 3495
        else:
            # Generic fallback: check if city/state already known to encoder
            normalized_city = data.get("city", "Houston")
            if state_input in encoders["state"].classes_:
                normalized_state = state_input
            else:
                normalized_state = "TX"
            user_lat, user_lon = 29.7604, -95.3698
            city_pop = int(data.get("city_pop", 500000))
            
        # Overwrite user lat/lon if they are out of bounds or 0
        if is_user_coords_out:
            lat, lon = user_lat, user_lon
            
        # Overwrite merchant lat/lon if they are out of bounds or 0
        if is_merch_coords_out:
            # Fraudulent transactions often happen further away or out-of-state
            merchant_name = str(data.get("merchant", "")).lower()
            is_suspicious = "fraud" in merchant_name or amt > 150.0
            if is_suspicious:
                merch_lat, merch_lon = lat + 1.2, lon - 1.2 # ~150km away (fraudulent)
            else:
                merch_lat, merch_lon = lat + 0.04, lon - 0.04 # ~5km away (normal)
                
        # 5. Compute Distance KM
        distance_km = float(haversine_km(lat, lon, merch_lat, merch_lon))
        
        # 6. Combined Outlier Check with Category-Specific Thresholds (USD)
        category_thresholds = {
            "entertainment": 200.0,
            "food_dining": 150.0,
            "gas_transport": 100.0,
            "grocery_net": 300.0,
            "shopping_net": 500.0,
            "personal_care": 150.0,
            "health_fitness": 250.0,
            "travel": 1000.0
        }
        
        # Extreme amount thresholds by category
        extreme_thresholds = {
            "entertainment": 2000.0,
            "food_dining": 1500.0,
            "gas_transport": 1000.0,
            "grocery_net": 3000.0,
            "shopping_net": 5000.0,
            "personal_care": 1500.0,
            "health_fitness": 2500.0,
            "travel": 10000.0
        }
        
        category_threshold = category_thresholds.get(category_name, 200.0)  # default threshold
        combined_outlier = int(amt > category_threshold and distance_km > 112.82)
        
        # 7. Label Encoding with Robust Auto-Correction
        encoded_features = {}
        cat_cols = ['category', 'gender', 'state', 'merchant', 'job', 'city']
        for col in cat_cols:
            val = str(data.get(col, ""))
            if col == "state":
                val = normalized_state
            elif col == "city":
                val = normalized_city
            elif col == "merchant":
                # Handle missing "fraud_" prefix for merchant names dynamically
                if not val.startswith("fraud_"):
                    prefixed = f"fraud_{val}"
                    if prefixed in encoders["merchant"].classes_:
                        val = prefixed
                        
            le = encoders.get(col)
            if le is not None:
                if val in le.classes_:
                    encoded_features[col] = int(le.transform([val])[0])
                else:
                    # Fallback to the first class (index 0)
                    encoded_features[col] = 0
            else:
                encoded_features[col] = 0
                
        # 8. Assemble 17 final feature columns in EXACT order
        features_dict = {
            "merchant": encoded_features["merchant"],
            "category": encoded_features["category"],
            "gender": encoded_features["gender"],
            "city": encoded_features["city"],
            "state": encoded_features["state"],
            "city_pop": city_pop,
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
        
        # 9. Run Model Inference
        proba = float(model.predict_proba(features_df)[0, 1])
        
        # Check for extreme amounts by category and adjust probability
        extreme_threshold = extreme_thresholds.get(category_name, 2000.0)  # default extreme threshold
        if amt > extreme_threshold:
            proba = max(proba, 0.6)  # Force minimum 60% probability for extreme amounts
        
        # Fixed threshold at 50%
        threshold_adjusted = 0.5
            
        is_fraud = bool(proba >= threshold_adjusted)
        risk_score = float(round(proba * 100, 2))
        
        # Calculate Confidence Score: 0 to 100 scale representing prediction certainty
        if is_fraud:
            confidence = (proba - threshold_adjusted) / (1.0 - threshold_adjusted)
        else:
            confidence = (threshold_adjusted - proba) / threshold_adjusted
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
