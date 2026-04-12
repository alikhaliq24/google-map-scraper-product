import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from passlib.context import CryptContext
import jwt

from database import get_db
import models, schemas
from security import encrypt_api_key, decrypt_api_key

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_reset_email(email: str, token: str):
    base_url = os.environ.get("FRONTEND_URL", "http://localhost:8000")
    reset_link = f"{base_url}/?reset_token={token}"
    
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = os.environ.get("SMTP_PORT", "587")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    
    if not smtp_host or not smtp_user or not smtp_pass:
        print(f"\n--- DEV MODE ---")
        print(f"RESET LINK for {email}: {reset_link}")
        print("Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to send real emails.")
        print(f"----------------\n")
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = f"MapScraper Pro <{smtp_user}>"
        msg['To'] = email
        msg['Subject'] = "Reset Your MapScraper Password"
        
        body = f"""
Hello,

You requested a password reset for your MapScraper Pro account.
Please click the link below to securely create a new password:

{reset_link}

If you did not request this, you can safely ignore this email.
"""
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(smtp_host, int(smtp_port))
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        server.quit()
        print(f"Reset email successfully sent to {email}")
    except Exception as e:
        print(f"Failed to send email to {email}: {e}")

# ── Auth Configuration ────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "b33633e9b110bc5c3a4f6d4dcb12d8a4f9104b901a1c86e08287f3b55a024c04") # Fallback for dev
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# ── Dependencies ──────────────────────────────────────────────────────────────

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    
    result = await db.execute(select(models.User).where(models.User.email == email))
    user = result.scalars().first()
    if user is None:
        raise credentials_exception
    return user


async def get_subscribed_user(current_user: models.User = Depends(get_current_user)):
    if not current_user.is_subscribed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active subscription required")
    return current_user

# ── Router & Endpoints ────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/signup", response_model=schemas.UserResponse)
async def create_user(user: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    # Check if user exists
    result = await db.execute(select(models.User).where(models.User.email == user.email))
    existing = result.scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pwd = get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_pwd)
    
    # Check if this is the very first user. If so, let's assign all existing orphaned groups to them
    # so we don't lose data and they get a nice default dashboard.
    result_users = await db.execute(select(models.User))
    all_users = result_users.scalars().all()
    is_first_user = len(all_users) == 0

    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    
    if is_first_user:
        # Assign all existing groups (where user_id is null) to this first user
        result_groups = await db.execute(select(models.Group).where(models.Group.user_id == None))
        orphaned_groups = result_groups.scalars().all()
        for g in orphaned_groups:
            g.user_id = db_user.id
        await db.commit()

    return db_user


@router.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.email == form_data.username))
    user = result.scalars().first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=schemas.UserResponse)
async def read_users_me(current_user: models.User = Depends(get_current_user)):
    user_dict = {c.name: getattr(current_user, c.name) for c in current_user.__table__.columns}
    if user_dict.get("openai_api_key"):
        user_dict["openai_api_key"] = decrypt_api_key(user_dict["openai_api_key"])
    return user_dict


@router.put("/settings", response_model=schemas.UserResponse)
async def update_settings(settings: schemas.SettingsUpdate, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if settings.openai_api_key:
        current_user.openai_api_key = encrypt_api_key(settings.openai_api_key)
    else:
        current_user.openai_api_key = None
        
    await db.commit()
    await db.refresh(current_user)
    
    user_dict = {c.name: getattr(current_user, c.name) for c in current_user.__table__.columns}
    if user_dict.get("openai_api_key"):
        user_dict["openai_api_key"] = decrypt_api_key(user_dict["openai_api_key"])
    return user_dict


@router.put("/password", response_model=schemas.UserResponse)
async def change_password(req: schemas.ChangePasswordRequest, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not verify_password(req.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    current_user.hashed_password = get_password_hash(req.new_password)
    await db.commit()
    return current_user


@router.post("/forgot-password")
async def forgot_password(req: schemas.ForgotPasswordRun, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.email == req.email))
    user = result.scalars().first()
    if user:
        reset_token = create_access_token(data={"sub": user.email}, expires_delta=timedelta(minutes=15))
        send_reset_email(user.email, reset_token)
        
    return {"ok": True, "message": "If that email is registered, a reset link has been generated."}


@router.post("/reset-password")
async def reset_password(req: schemas.ResetPasswordRun, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(req.token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=400, detail="Invalid token")
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="Invalid token")
        
    result = await db.execute(select(models.User).where(models.User.email == email))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.hashed_password = get_password_hash(req.new_password)
    await db.commit()
    return {"ok": True, "message": "Password updated successfully"}
