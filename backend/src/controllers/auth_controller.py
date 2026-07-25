from datetime import datetime, timedelta, timezone

import bcrypt
from decouple import config
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pony.orm import db_session

from src.models import AuthUser
from src.schemas import (
    AuthChangePasswordRequest,
    AuthChangePasswordResponse,
    AuthLoginRequest,
    AuthMeResponse,
    AuthRegisterRequest,
    AuthTokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

JWT_SECRET = config("JWT_SECRET", default="change-this-secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = config("JWT_EXPIRE_MINUTES", cast=int, default=60 * 24)
REGISTER_ADMIN_KEY = config("REGISTER_ADMIN_KEY", default="change-this-register-key")


def _create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@router.post("/register", response_model=AuthTokenResponse)
def register_user(
    body: AuthRegisterRequest,
):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        existing = AuthUser.get(username=username)
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = AuthUser(username=username, password_hash=password_hash, updated_at=datetime.utcnow())
        uid = user.id

    return AuthTokenResponse(access_token=_create_access_token(username), user_id=uid)


@router.post("/login", response_model=AuthTokenResponse)
def login_user(body: AuthLoginRequest):
    username = body.username.strip()
    password = body.password
    if not username or not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username and password are required")

    with db_session:
        user = AuthUser.get(username=username)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        valid_password = bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
        if not valid_password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        uid = user.id

    return AuthTokenResponse(access_token=_create_access_token(username), user_id=uid)


def get_current_username(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


def get_current_user_id(username: str = Depends(get_current_username)) -> int:
    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user.id


@router.get("/me", response_model=AuthMeResponse)
def me(username: str = Depends(get_current_username)):
    return AuthMeResponse(username=username)


@router.post("/change-password", response_model=AuthChangePasswordResponse)
def change_password(
    body: AuthChangePasswordRequest,
    username: str = Depends(get_current_username),
):
    current_password = body.current_password
    new_password = body.new_password
    if not current_password or not new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="current_password and new_password are required",
        )
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 6 caracteres",
        )

    with db_session:
        user = AuthUser.get(username=username)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

        valid_password = bcrypt.checkpw(
            current_password.encode("utf-8"),
            user.password_hash.encode("utf-8"),
        )
        if not valid_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contraseña actual incorrecta",
            )

        if bcrypt.checkpw(new_password.encode("utf-8"), user.password_hash.encode("utf-8")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La nueva contraseña debe ser distinta a la actual",
            )

        user.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user.updated_at = datetime.utcnow()

    return AuthChangePasswordResponse()
