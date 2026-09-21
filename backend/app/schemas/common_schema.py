from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """The envelope of every successful response (PDF section 10)."""

    success: Literal[True] = True
    resultado: T


class ApiError(BaseModel):
    """The envelope of every failed response."""

    success: Literal[False] = False
    error: str


class HealthStatus(BaseModel):
    estado: str
    version: str
    motor: str
    modelo: str
    base_de_datos: str
