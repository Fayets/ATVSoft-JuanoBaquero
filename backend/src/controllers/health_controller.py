# from fastapi import APIRouter, HTTPException
#
# from src.schemas import HealthResponse
# from src.services.health_services import HealthServices
#
# router = APIRouter(prefix="/health", tags=["health"])
# service = HealthServices()
#
#
# @router.get("", response_model=HealthResponse)
# def get_health() -> HealthResponse:
#     try:
#         return service.get_health()
#     except HTTPException as e:
#         raise e
#     except Exception:
#         raise HTTPException(status_code=500, detail="Error inesperado al obtener health.")
