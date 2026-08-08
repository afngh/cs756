import os
import json
import joblib
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import inventory_logic

def simulate_shortage(material_id, drop_to_pct=0.1):
    """
    Modify the inventory CSV file to reduce the latest stock of a material.
    """
    data_path = "inventory_data.csv"
    if not os.path.exists(data_path):
        print(f"Error: {data_path} not found.")
        return
    df = pd.read_csv(data_path)
    df['date'] = pd.to_datetime(df['date'])
    mat_rows = df[df['material_id'] == material_id].sort_values('date')
    if len(mat_rows) == 0:
        print(f"Error: Material {material_id} not found.")
        return
    latest_idx = mat_rows.index[-1]
    old_stock = df.loc[latest_idx, 'current_stock']
    new_stock = int(round(old_stock * drop_to_pct))
    df.loc[latest_idx, 'current_stock'] = new_stock
    df.to_csv(data_path, index=False)
    print(f"[simulate_shortage] Reduced latest stock of {material_id} from {old_stock} to {new_stock}.")

def run_pipeline(data_path="inventory_data.csv", metadata_path="material_metadata.json", models_dir="models"):
    # 1. Load configuration and dataset
    if not os.path.exists(data_path):
        raise FileNotFoundError(f"Dataset '{data_path}' not found. Run generate_data.py first.")
    if not os.path.exists(metadata_path):
        raise FileNotFoundError(f"Metadata '{metadata_path}' not found. Run generate_data.py first.")
        
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
        
    df = pd.read_csv(data_path)
    df['date'] = pd.to_datetime(df['date'])
    
    materials = sorted(df['material_id'].unique())
    recommendations = []
    
    print("Running inventory optimization pipeline...")
    print(f"Dataset date range: {df['date'].min().strftime('%Y-%m-%d')} to {df['date'].max().strftime('%Y-%m-%d')}")
    print("-" * 80)
    
    # 2. Process each material
    for mat_id in materials:
        # Load the trained model
        model_path = os.path.join(models_dir, f"{mat_id}_baseline.pkl")
        if not os.path.exists(model_path):
            print(f"Warning: Model not found for {mat_id} at {model_path}. Skipping.")
            continue
        model = joblib.load(model_path)
        
        # Filter data for this material
        df_mat = df[df['material_id'] == mat_id].sort_values('date').reset_index(drop=True)
        
        # Get the latest state
        latest_row = df_mat.iloc[-1]
        last_date = latest_row['date']
        current_stock = latest_row['current_stock']
        lead_time_days = metadata[mat_id]['lead_time']
        
        # We need historical usage to construct lag and rolling features.
        # Max lag is 30, so we need at least the last 30 days of actual demand history.
        history = df_mat['units_used'].tolist()
        
        # Get the actual last 90 days of usage before predicting
        historical_usage_90 = history[-90:]
        
        # 3. Recursive Forecasting Loop
        forecast = []
        for step in range(1, lead_time_days + 1):
            forecast_date = last_date + timedelta(days=step)
            
            # Construct features using history window
            lag_1 = history[-1]
            lag_7 = history[-7]
            lag_14 = history[-14]
            lag_30 = history[-30]
            
            # Note: history[-7:] represents the last 7 values (which correspond to lag 1 to lag 7)
            roll_mean_7 = np.mean(history[-7:])
            roll_mean_30 = np.mean(history[-30:])
            roll_std_7 = np.std(history[-7:], ddof=1)
            
            day_of_week = forecast_date.weekday()
            month = forecast_date.month
            
            # Create feature DataFrame for model prediction
            feat_df = pd.DataFrame([{
                'units_used_lag_1': lag_1,
                'units_used_lag_7': lag_7,
                'units_used_lag_14': lag_14,
                'units_used_lag_30': lag_30,
                'rolling_mean_7': roll_mean_7,
                'rolling_mean_30': roll_mean_30,
                'rolling_std_7': roll_std_7,
                'day_of_week': day_of_week,
                'month': month
            }])
            
            # Predict and clamp to non-negative
            pred_usage = max(0.0, float(model.predict(feat_df)[0]))
            
            # Append predicted value to history to be used in subsequent steps
            history.append(pred_usage)
            forecast.append(pred_usage)
            
        # 4. Generate Inventory Recommendations
        rec = inventory_logic.recommend(
            material_id=mat_id,
            current_stock=current_stock,
            forecasted_usage=forecast,
            lead_time_days=lead_time_days,
            historical_usage_90=historical_usage_90
        )
        
        # Add additional metadata for summary report
        rec['lead_time'] = lead_time_days
        rec['avg_forecast'] = int(round(np.mean(forecast)))
        recommendations.append(rec)
        
    # 5. Print a clean, formatted report
    print("\n" + "="*72)
    print("                INVENTORY REPLENISHMENT HEALTH DASHBOARD")
    print("="*72)
    header = f"{'Mat ID':<6} | {'Stock':<5} | {'LT':<2} | {'AvgUse':<6} | {'SafetyS':<7} | {'ROP':<5} | {'EOQ':<5} | {'OrderQty':<8} | {'Risk':<4}"
    print(header)
    print("-" * 72)
    
    high_risk_count = 0
    total_reorder_qty = 0
    
    for r in recommendations:
        risk_str = r['stockout_risk']
        print(f"{r['material_id']:<6} | {r['current_stock']:<5} | {r['lead_time']:<2} | {r['avg_forecast']:<6} | {r['safety_stock']:<7} | {r['reorder_point']:<5} | {r['eoq']:<5} | {r['recommended_order_qty']:<8} | {risk_str:<4}")
        
        if r['stockout_risk'] == "HIGH":
            high_risk_count += 1
        total_reorder_qty += r['recommended_order_qty']
        
    print("-" * 72)
    print(f"Summary: {high_risk_count} / {len(recommendations)} materials at HIGH stockout risk.")
    print(f"Total replenishment orders required: {total_reorder_qty} units.")
    print("=" * 72 + "\n")

if __name__ == "__main__":
    # Ensure fresh data is generated
    import generate_data
    generate_data.generate_synthetic_data()
    
    # Simulate shortage on MAT_01
    simulate_shortage("MAT_01", drop_to_pct=0.1)
    
    # Run the pipeline
    run_pipeline()
