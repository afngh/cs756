import logging
from datetime import datetime
from flask import Blueprint, request, jsonify
from marshmallow import ValidationError

from pipeline import forecast_demand
from inventory_logic import recommend
from schemas import OptimizationRequestSchema

inventory_bp = Blueprint("inventory", __name__, url_prefix="/api")

_schema = OptimizationRequestSchema()
logger = logging.getLogger(__name__)


@inventory_bp.get("/health")
def health():
    return jsonify({"status": "ok", "timestamp": datetime.utcnow().isoformat()}), 200


@inventory_bp.post("/inventory/optimize")
def optimize():
    try:
        payload = _schema.load(request.get_json(force=True) or {})
    except ValidationError as exc:
        return jsonify({"error": exc.messages}), 400

    if len(payload["historical_usage_90"]) < 90:
        return jsonify({
            "error": "Minimum 90 days of usage history is required for safety stock calculations."
        }), 400

    material_id = payload["material_id"]
    historical_usage_30 = payload["historical_usage_90"][-30:]

    try:
        forecast = forecast_demand(
            material_id=material_id,
            historical_usage_30=historical_usage_30,
            lead_time_days=payload["lead_time_days"],
            models_dir="models",
            reference_date=datetime.now(),
        )

        result = recommend(
            material_id=material_id,
            current_stock=payload["current_stock"],
            forecasted_usage=forecast,
            lead_time_days=payload["lead_time_days"],
            historical_usage_90=payload["historical_usage_90"],
            order_cost=payload["order_cost"],
            holding_cost_per_unit=payload["holding_cost_per_unit"],
        )

        result["forecasted_usage"] = [round(v, 2) for v in forecast]

        logger.info(
            "optimize | material_id=%s stockout_risk=%s",
            material_id,
            result["stockout_risk"],
        )
        return jsonify(result), 200

    except FileNotFoundError:
        logger.warning("optimize | model not found for material_id=%s", material_id)
        return jsonify({
            "error": f"Forecasting model for material '{material_id}' was not found. Please train models first."
        }), 404

    except Exception as exc:
        logger.exception("optimize | unexpected error for material_id=%s", material_id)
        return jsonify({"error": str(exc)}), 500
