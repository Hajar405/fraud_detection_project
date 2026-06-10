import os
import time
import csv
import random
import requests
from datetime import datetime

# Setup endpoint
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080/api/transactions/analyze")
CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models_a _utiliser", "morocco_sample.csv")

def parse_line(line):
    parts = [p.strip() for p in line.strip().split(",")]
    if len(parts) < 15:
        return None
    try:
        n = len(parts)
        trans_date = parts[n-1]
        merch_long = float(parts[n-2])
        merch_lat = float(parts[n-3])
        lon = float(parts[n-4])
        lat = float(parts[n-5])
        dob = parts[n-6]
        
        cc_num = parts[0]
        amt = float(parts[1])
        
        city_pop_idx = -1
        for i in range(n-7, 1, -1):
            if parts[i].isdigit():
                city_pop_idx = i
                break
        if city_pop_idx == -1:
            return None
        
        city_pop = int(parts[city_pop_idx])
        job = ", ".join(parts[city_pop_idx+1 : n-6])
        state = parts[city_pop_idx-1]
        city = parts[city_pop_idx-2]
        gender = parts[city_pop_idx-3]
        category = parts[city_pop_idx-4]
        merchant = ", ".join(parts[2 : city_pop_idx-4])
        
        return {
            "cc_num": cc_num,
            "amt": amt,
            "merchant": merchant,
            "category": category,
            "gender": gender,
            "city": city,
            "state": state,
            "city_pop": city_pop,
            "job": job,
            "dob": dob,
            "lat": lat,
            "long": lon,
            "merch_lat": merch_lat,
            "merch_long": merch_long,
            "trans_date": trans_date
        }
    except Exception:
        return None

def stream_transactions():
    print(f"Starting real-time streaming transaction simulator...")
    print(f"Reading Morocco CSV from {CSV_PATH}")
    print(f"Forwarding transactions to {BACKEND_URL} every 5 seconds...")
    
    if not os.path.exists(CSV_PATH):
        print(f"❌ Error: CSV file not found at {CSV_PATH}")
        return

    STATUS_URL = os.getenv("STATUS_URL", "http://backend:8080/api/transactions/streaming/status")

    while True:
        try:
            with open(CSV_PATH, "r", encoding="utf-8") as f:
                lines = f.readlines()
            
            # Skip header line
            data_lines = [line for line in lines[1:] if line.strip()]
            random.shuffle(data_lines) # Shuffle transactions for realistic stream
            
            for line in data_lines:
                # Check status first
                is_enabled = True
                while True:
                    try:
                        status_res = requests.get(STATUS_URL, timeout=5)
                        if status_res.ok:
                            is_enabled = status_res.json().get("enabled", True)
                            if not is_enabled:
                                print("Streaming paused by admin. Waiting 5 seconds...")
                                time.sleep(5)
                                continue # loop back to check again
                            else:
                                break # enabled, break out of while loop
                        else:
                            break # if error getting status, assume enabled
                    except Exception as e:
                        print(f"⚠️ Could not check streaming status: {e}")
                        break # if error, assume enabled

                if not is_enabled:
                    continue # safety catch

                row = parse_line(line)
                if not row:
                    continue
                
                # Update timestamp to the current local date & time
                current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                row["trans_date"] = current_time
                
                print(f"Sending transaction: Card {row['cc_num'][-4:]} | Merchant: {row['merchant']} | Amount: {row['amt']} MAD")
                
                try:
                    res = requests.post(BACKEND_URL, json=row, timeout=5)
                    if res.ok:
                        data = res.json()
                        print(f"  [OK] Processed. Risk Score: {data.get('riskScore')}% | isFraud: {data.get('isFraud')}")
                    else:
                        print(f"  [ERROR] Backend returned status code: {res.status_code}")
                except requests.exceptions.RequestException as e:
                    print(f"  [ERROR] Failed to connect to backend: {e}")
                
                time.sleep(5)
                
        except Exception as e:
            print(f"⚠️ Simulator error: {e}")
            time.sleep(10)

if __name__ == "__main__":
    # Wait for the backend service to boot up fully inside Docker
    print("Waiting 15 seconds for backend to start up...")
    time.sleep(15)
    stream_transactions()
