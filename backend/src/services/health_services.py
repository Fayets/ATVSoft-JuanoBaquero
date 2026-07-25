from src.schemas import HealthResponse


class HealthServices:
    def get_health(self) -> HealthResponse:
        return HealthResponse(status="ok")
