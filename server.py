import os
import json
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import joblib

import inventory_logic
import generate_data
from pipeline import simulate_shortage

PORT = 5000
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

def get_pipeline_data():
    """Run pipeline forecasting & return raw results list."""
    data_path = "inventory_data.csv"
    metadata_path = "material_metadata.json"
    models_dir = "models"
    
    if not os.path.exists(data_path) or not os.path.exists(metadata_path):
        generate_data.generate_synthetic_data()
        
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
        
    df = pd.read_csv(data_path)
    df['date'] = pd.to_datetime(df['date'])
    materials = sorted(df['material_id'].unique())
    
    results = []
    high_risk_count = 0
    total_reorder_qty = 0
    total_stock_units = 0
    
    for mat_id in materials:
        model_path = os.path.join(models_dir, f"{mat_id}_baseline.pkl")
        if not os.path.exists(model_path):
            continue
        model = joblib.load(model_path)
        
        df_mat = df[df['material_id'] == mat_id].sort_values('date').reset_index(drop=True)
        latest_row = df_mat.iloc[-1]
        last_date = latest_row['date']
        current_stock = latest_row['current_stock']
        lead_time_days = metadata[mat_id]['lead_time']
        base_demand = metadata[mat_id]['base_demand']
        
        history = df_mat['units_used'].tolist()
        historical_usage_90 = history[-90:]
        
        # Recursive forecasting
        forecast = []
        for step in range(1, lead_time_days + 1):
            forecast_date = last_date + timedelta(days=step)
            feat_df = pd.DataFrame([{
                'units_used_lag_1': history[-1],
                'units_used_lag_7': history[-7],
                'units_used_lag_14': history[-14],
                'units_used_lag_30': history[-30],
                'rolling_mean_7': np.mean(history[-7:]),
                'rolling_mean_30': np.mean(history[-30:]),
                'rolling_std_7': np.std(history[-7:], ddof=1),
                'day_of_week': forecast_date.weekday(),
                'month': forecast_date.month
            }])
            pred_usage = max(0.0, float(model.predict(feat_df)[0]))
            history.append(pred_usage)
            forecast.append(pred_usage)
            
        rec = inventory_logic.recommend(
            material_id=mat_id,
            current_stock=current_stock,
            forecasted_usage=forecast,
            lead_time_days=lead_time_days,
            historical_usage_90=historical_usage_90
        )
        
        rec['lead_time'] = lead_time_days
        rec['base_demand'] = base_demand
        rec['avg_forecast'] = int(round(np.mean(forecast)))
        rec['forecast_sum'] = int(round(np.sum(forecast)))
        rec['last_date'] = last_date.strftime("%Y-%m-%d")
        
        results.append(rec)
        total_stock_units += current_stock
        if rec['stockout_risk'] == "HIGH":
            high_risk_count += 1
        total_reorder_qty += rec['recommended_order_qty']
        
    return {
        "summary": {
            "total_materials": len(results),
            "high_risk_count": high_risk_count,
            "total_reorder_qty": total_reorder_qty,
            "total_stock_units": total_stock_units,
            "avg_lead_time": round(np.mean([r['lead_time'] for r in results]), 1),
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        },
        "materials": results
    }

def get_material_detail(mat_id):
    """Get 90-day historical usage + multi-step forecast curve for a material."""
    data_path = "inventory_data.csv"
    metadata_path = "material_metadata.json"
    models_dir = "models"
    
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
        
    df = pd.read_csv(data_path)
    df['date'] = pd.to_datetime(df['date'])
    
    df_mat = df[df['material_id'] == mat_id].sort_values('date').reset_index(drop=True)
    if len(df_mat) == 0:
        return None
        
    # Last 90 days
    recent_90 = df_mat.tail(90)
    history_list = [{
        "date": row['date'].strftime("%Y-%m-%d"),
        "units_used": int(row['units_used']),
        "current_stock": int(row['current_stock'])
    } for _, row in recent_90.iterrows()]
    
    model_path = os.path.join(models_dir, f"{mat_id}_baseline.pkl")
    model = joblib.load(model_path)
    
    latest_row = df_mat.iloc[-1]
    last_date = latest_row['date']
    current_stock = latest_row['current_stock']
    lead_time_days = metadata[mat_id]['lead_time']
    base_demand = metadata[mat_id]['base_demand']
    
    history = df_mat['units_used'].tolist()
    historical_usage_90 = history[-90:]
    
    forecast_list = []
    forecast_vals = []
    for step in range(1, lead_time_days + 1):
        forecast_date = last_date + timedelta(days=step)
        feat_df = pd.DataFrame([{
            'units_used_lag_1': history[-1],
            'units_used_lag_7': history[-7],
            'units_used_lag_14': history[-14],
            'units_used_lag_30': history[-30],
            'rolling_mean_7': np.mean(history[-7:]),
            'rolling_mean_30': np.mean(history[-30:]),
            'rolling_std_7': np.std(history[-7:], ddof=1),
            'day_of_week': forecast_date.weekday(),
            'month': forecast_date.month
        }])
        pred_usage = max(0.0, float(model.predict(feat_df)[0]))
        history.append(pred_usage)
        forecast_vals.append(pred_usage)
        forecast_list.append({
            "date": forecast_date.strftime("%Y-%m-%d"),
            "predicted_units": int(round(pred_usage))
        })
        
    rec = inventory_logic.recommend(
        material_id=mat_id,
        current_stock=current_stock,
        forecasted_usage=forecast_vals,
        lead_time_days=lead_time_days,
        historical_usage_90=historical_usage_90
    )
    rec['lead_time'] = lead_time_days
    rec['base_demand'] = base_demand

    return {
        "material_id": mat_id,
        "recommendation": rec,
        "history_90": history_list,
        "forecast": forecast_list
    }

class PipelineRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/inventory/materials":
            data = get_pipeline_data()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
            return

        if path.startswith("/api/inventory/material/"):
            mat_id = path.split("/")[-1]
            data = get_material_detail(mat_id)
            if data:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Material not found"}).encode('utf-8'))
            return

        # Fallback to static file serving
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_length)
        body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}

        if path == "/api/inventory/simulate-shortage":
            mat_id = body.get("material_id", "MAT_01")
            drop_to_pct = float(body.get("drop_to_pct", 0.1))
            simulate_shortage(mat_id, drop_to_pct)
            data = get_pipeline_data()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "data": data}).encode('utf-8'))
            return

        if path == "/api/inventory/update-stock":
            mat_id = body.get("material_id")
            new_stock = int(body.get("new_stock", 0))
            data_path = "inventory_data.csv"
            df = pd.read_csv(data_path)
            df['date'] = pd.to_datetime(df['date'])
            mat_rows = df[df['material_id'] == mat_id].sort_values('date')
            if len(mat_rows) > 0:
                latest_idx = mat_rows.index[-1]
                df.loc[latest_idx, 'current_stock'] = new_stock
                df.to_csv(data_path, index=False)
            data = get_pipeline_data()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "data": data}).encode('utf-8'))
            return

        if path == "/api/inventory/regenerate-data":
            generate_data.generate_synthetic_data()
            data = get_pipeline_data()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "data": data}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def run_server():
    if not os.path.exists(STATIC_DIR):
        os.makedirs(STATIC_DIR, exist_ok=True)
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, PipelineRequestHandler)
    print(f"[SERVER] Replenishment Health Server running on http://localhost:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
