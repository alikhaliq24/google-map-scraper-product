from pydantic import BaseModel, Field
from typing import List, Optional
import datetime


# ── Auth & Users ─────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    is_subscribed: bool
    customer_portal_url: Optional[str] = None
    openai_api_key: Optional[str] = None
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class ForgotPasswordRun(BaseModel):
    email: str

class ResetPasswordRun(BaseModel):
    token: str
    new_password: str

class SettingsUpdate(BaseModel):
    openai_api_key: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ── Existing Schemas ─────────────────────────────────────────────────────────

class LeadBase(BaseModel):
    # Core
    name: Optional[str] = None
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    reviews_count: Optional[int] = None
    rating: Optional[float] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    category: Optional[str] = None

    # Tier 1 — Maps extra
    hours_of_operation: Optional[str] = None
    is_claimed: Optional[bool] = None
    photos_count: Optional[int] = None
    is_permanently_closed: Optional[bool] = False
    location_type: Optional[str] = None

    # Tier 1 — Website
    email: Optional[str] = None
    whatsapp_link: Optional[str] = None
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    twitter_url: Optional[str] = None
    tiktok_url: Optional[str] = None
    youtube_url: Optional[str] = None
    tech_stack: Optional[str] = None
    has_live_chat: Optional[bool] = None
    has_online_booking: Optional[bool] = None
    copyright_year: Optional[int] = None
    social_presence_score: Optional[int] = None
    auto_enrichment_status: Optional[str] = "pending"

    # Tier 2 — LLM
    pain_points: Optional[str] = None
    positive_themes: Optional[str] = None
    review_sentiment_trend: Optional[str] = None
    owner_response_rate: Optional[str] = None
    team_size_estimate: Optional[str] = None
    business_summary: Optional[str] = None
    lead_score: Optional[int] = None
    lead_score_reason: Optional[str] = None
    locations_summary: Optional[str] = None
    llm_enrichment_status: Optional[str] = "pending"


class Lead(LeadBase):
    id: int
    group_id: int

    class Config:
        orm_mode = True


class GroupCreate(BaseModel):
    query: str
    limit: int = 100


class AppendCreate(BaseModel):
    limit: int = 100


class GroupUpdate(BaseModel):
    name: str


class Group(BaseModel):
    id: int
    user_id: Optional[int] = None
    name: str
    status: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True
