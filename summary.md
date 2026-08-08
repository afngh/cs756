# Executive Summary: Inventory Optimization & Material Planning System
### CodeSprint 2026 National Level Hackathon — Problem Statement #167
**Team ID:** CS2026-756

---

## 🔴 The Core Business Problem: The Inventory Dilemma

Manufacturing Small and Medium Enterprises (SMEs) struggle with a delicate and costly balancing act in inventory management. Traditional, static systems rely on manual spreadsheets or rigid, calendar-based rules of thumb. This lack of agility leads to two highly destructive operational outcomes:

1. **Production Halts (Understocking / Stockouts):** When a factory runs out of a critical raw material (e.g. wood screws for a furniture manufacturer, microchips for electronics, or chemicals for processing), the entire production line stops. Factory machinery sits idle, labor costs accumulate without output, client contracts are breached due to delivery delays, and revenue is lost.
2. **Capital Lockup (Overstocking):** To prevent running out, factories often over-order, keeping months of excess stock. This ties up precious working capital in physical materials that sit on shelves, inflates warehouse storage and insurance fees, and exposes the materials to risk of theft, damage, or obsolescence.

In short, static systems force factories to choose between **operational risk (stockouts)** or **capital inefficiency (overstocking)**.

---

## 🎯 The Expected Outcome: Proactive Material Planning

The goal of this solution is to build a proactive, intelligent inventory management system that automatically and dynamically answers three critical questions for every raw material in real time:

1. **Future Projection:** How much of this material will we consume over the supplier's delivery window (the lead time)?
2. **Order Trigger (When to Order):** At what exact stock level must we trigger a replenishment order so that the materials arrive *just-in-time* before our current stock runs dry?
3. **Order Size (How much to Order):** What is the most financially optimal quantity to order to minimize transaction costs while avoiding bloated storage costs?

---

## 💡 The Intelligent Solution: A Three-Layer Pipeline

Our platform solves the inventory dilemma by combining Machine Learning with classic Operation Research mathematics into a unified, three-layer workflow:

```text
  [ Raw Data Logs ] 
         │
         ▼
┌─────────────────────────────────┐
│ Layer 1: ML Demand Forecasting  │ ◄── Forecasts usage over lead-time
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Layer 2: Mathematical Optimizer  │ ◄── Calculates Safety Stock, ROP, and EOQ
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│  Layer 3: Decision & Alerts UI  │ ◄── Issues JIT procurement warnings
└─────────────────────────────────┘
```

### Layer 1: Machine Learning Demand Forecasting
Instead of assuming past sales represent future demand, our system uses a **Gradient Boosting Regressor (GBDT)** model trained individually for each raw material. By feeding the model lag features (short-term history) and rolling statistics (demand velocity and volatility), the model predicts the exact consumption trajectory for the upcoming days.

### Layer 2: Mathematical Stock Optimization
The ML forecast is passed to our mathematical optimizer, which replaces static safety thresholds with dynamic variables:
* **Dynamic Safety Stock ($SS$):** Calculates the standard deviation of actual consumption over the last 90 days and scales it to the supplier's lead time, establishing a robust buffer.
* **Dynamic Reorder Point ($ROP$):** Combines the ML-projected consumption during lead-time with the safety stock buffer. If stock drops below this point, a replenishment order is triggered.
* **Economic Order Quantity ($EOQ$):** Balances transaction order fees against warehouse carrying costs to recommend the most cost-efficient batch size.

### Layer 3: Decision and Alerting Engine
Continually cross-references current stock levels against the ROP. If stock falls below ROP, the system marks the stockout risk as **`HIGH`** and recommends placing a new order of exactly the **`EOQ`** size. This alert is served through a REST API to populate the manager's dashboard.

---

## 🤖 How the Machine Learning Model Helps (Why ML?)

Traditional inventory systems assume demand is constant and flat. In reality, manufacturing demand is highly volatile, subject to:
* **Seasonality Cycles:** Weekly patterns (production cycles) and yearly cycles (high demand peaks before festival seasons).
* **Demand Shocks:** Sudden, unpredictable spikes caused by flash promotions or bulk orders.
* **Supply Chain Disruptions:** Logistics delays that lengthen supplier delivery times.

**Why ML is the critical differentiator:** 
Unlike rigid formulas, the Gradient Boosting model captures complex, non-linear patterns from historical logs. It adapts to spikes and drops in usage before they happen, allowing the system to raise the Reorder Point trigger *before* a busy season starts, and lower it during slow months. This ensures the factory maintains **perfect operations with minimal inventory investment**.
