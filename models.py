from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_subscribed = Column(Boolean, default=False)
    subscription_id = Column(String, nullable=True) # Lemon Squeezy sub ID
    customer_portal_url = Column(String, nullable=True) # Lemon Squeezy management portal
    openai_api_key = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    groups = relationship("Group", back_populates="user", cascade="all, delete-orphan")


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id")) # Multi-tenant isolation
    name = Column(String, index=True)
    status = Column(String, default="pending")  # pending, scraping, completed, failed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="groups")
    leads = relationship("Lead", back_populates="group", cascade="all, delete-orphan")


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"))

    # ── Core (scraped from Maps listing) ─────────────────────────────────────
    name = Column(String)
    phone = Column(String, nullable=True)
    owner_name = Column(String, nullable=True)
    reviews_count = Column(Integer, nullable=True)
    rating = Column(Float, nullable=True)
    website = Column(String, nullable=True)
    address = Column(String, nullable=True)
    city = Column(String, nullable=True)
    country = Column(String, nullable=True)
    category = Column(String, nullable=True)

    # ── Tier 1: Extra Google Maps fields (captured during scrape) ─────────────
    hours_of_operation = Column(String, nullable=True)
    is_claimed = Column(Boolean, nullable=True)
    photos_count = Column(Integer, nullable=True)
    is_permanently_closed = Column(Boolean, default=False)
    location_type = Column(String, nullable=True)   # "Single Location" / "Multi-Location"

    # ── Tier 1: Website enrichment ────────────────────────────────────────────
    email = Column(String, nullable=True)
    whatsapp_link = Column(String, nullable=True)
    facebook_url = Column(String, nullable=True)
    instagram_url = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    twitter_url = Column(String, nullable=True)
    tiktok_url = Column(String, nullable=True)
    youtube_url = Column(String, nullable=True)
    tech_stack = Column(String, nullable=True)       # e.g. "WordPress, HubSpot"
    has_live_chat = Column(Boolean, nullable=True)
    has_online_booking = Column(Boolean, nullable=True)
    copyright_year = Column(Integer, nullable=True)
    social_presence_score = Column(Integer, nullable=True)  # 0–6
    auto_enrichment_status = Column(String, default="pending")

    # ── Tier 2: LLM enrichment ────────────────────────────────────────────────
    pain_points = Column(Text, nullable=True)
    positive_themes = Column(Text, nullable=True)
    review_sentiment_trend = Column(String, nullable=True)
    owner_response_rate = Column(String, nullable=True)
    team_size_estimate = Column(String, nullable=True)
    business_summary = Column(Text, nullable=True)
    lead_score = Column(Integer, nullable=True)
    lead_score_reason = Column(Text, nullable=True)
    locations_summary = Column(Text, nullable=True)   # LLM-detected location detail
    llm_enrichment_status = Column(String, default="pending")

    group = relationship("Group", back_populates="leads")
