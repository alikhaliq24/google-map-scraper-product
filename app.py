from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
import io
import csv

from database import engine, Base, get_db
import models, schemas
from scraper import scrape_google_maps
from enricher import auto_enrich_group
from llm_enricher import llm_enrich_lead
from backfill import run_backfill

import auth
from auth import get_current_user

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ── Group Endpoints ───────────────────────────────────────────────────────────

@app.post("/api/groups", response_model=schemas.Group)
async def create_group(group_in: schemas.GroupCreate, bg_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    group_name = group_in.query
    db_group = models.Group(name=group_name, user_id=current_user.id)
    db.add(db_group)
    await db.commit()
    await db.refresh(db_group)
    bg_tasks.add_task(scrape_google_maps, db_group.id, group_in.query, group_in.limit)
    return db_group


@app.post("/api/groups/{group_id}/append", response_model=schemas.Group)
async def append_group(group_id: int, append_in: schemas.AppendCreate, bg_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    db_group = result.scalars().first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
    db_group.status = "scraping"
    await db.commit()
    bg_tasks.add_task(scrape_google_maps, db_group.id, db_group.name, append_in.limit)
    return db_group


@app.get("/api/groups", response_model=list[schemas.Group])
async def list_groups(current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.user_id == current_user.id).order_by(models.Group.created_at.desc()))
    return result.scalars().all()


@app.get("/api/groups/{group_id}/leads", response_model=list[schemas.Lead])
async def list_group_leads(group_id: int, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Verify group ownership
    g_res = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    if not g_res.scalars().first():
        raise HTTPException(status_code=404, detail="Group not found")
        
    result = await db.execute(select(models.Lead).where(models.Lead.group_id == group_id))
    return result.scalars().all()


@app.put("/api/groups/{group_id}", response_model=schemas.Group)
async def update_group(group_id: int, group_in: schemas.GroupUpdate, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    group.name = group_in.name
    await db.commit()
    await db.refresh(group)
    return group


@app.delete("/api/groups/{group_id}")
async def delete_group(group_id: int, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.delete(group)
    await db.commit()
    return {"ok": True}


# ── Enrichment Endpoints ──────────────────────────────────────────────────────

@app.post("/api/groups/{group_id}/auto-enrich")
async def trigger_auto_enrich(group_id: int, bg_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Trigger Tier 1 website enrichment for all leads in a group."""
    result = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    bg_tasks.add_task(auto_enrich_group, group_id)
    return {"ok": True, "message": "Auto-enrichment started"}


@app.post("/api/groups/{group_id}/backfill-maps")
async def trigger_backfill_maps(group_id: int, bg_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Re-visit Google Maps for existing leads to backfill Hours, Location, Photos, Claimed fields."""
    result = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    bg_tasks.add_task(run_backfill, group_id)
    return {"ok": True, "message": "Maps backfill started"}


@app.post("/api/leads/{lead_id}/llm-enrich")
async def trigger_llm_enrich(lead_id: int, bg_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Trigger Tier 2 LLM enrichment for a single lead."""
    lead = await db.get(models.Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    bg_tasks.add_task(llm_enrich_lead, lead_id)
    return {"ok": True, "message": "LLM enrichment started"}


@app.get("/api/leads/{lead_id}", response_model=schemas.Lead)
async def get_lead(lead_id: int, current_user: models.User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Get a single lead with all enriched fields (used for polling)."""
    lead = await db.get(models.Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

# ── Subscriptions & Webhooks ──────────────────────────────────────────────────
import hmac
import hashlib
from fastapi import Request

@app.post("/api/webhooks/lemonsqueezy")
async def lemonsqueezy_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("X-Signature")
    secret = os.getenv("LEMON_SQUEEZY_WEBHOOK_SECRET", "supersecret").encode('utf-8')
    
    mac = hmac.new(secret, msg=payload, digestmod=hashlib.sha256).hexdigest()
    if not hmac.compare_digest(mac, signature or ""):
        raise HTTPException(status_code=400, detail="Invalid signature")

    data = await request.json()
    event_name = data.get("meta", {}).get("event_name")
    
    # Custom data contains user_id
    user_id = data.get("meta", {}).get("custom_data", {}).get("user_id")
    if not user_id:
        return {"ok": True}
        
    user = await db.get(models.User, int(user_id))
    if not user:
        return {"ok": True}

    if event_name in ["subscription_created", "subscription_updated", "subscription_resumed"]:
        user.is_subscribed = True
        portal_url = data.get("data", {}).get("attributes", {}).get("urls", {}).get("customer_portal")
        if portal_url:
            user.customer_portal_url = portal_url
    elif event_name in ["subscription_cancelled", "subscription_expired"]:
        user.is_subscribed = False

    await db.commit()
    return {"ok": True}

@app.post("/api/admin/override-subscription")
async def override_subscription(user_id: int, is_subscribed: bool, db: AsyncSession = Depends(get_db)):
    # In reality this should be protected by an admin API key
    user = await db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_subscribed = is_subscribed
    await db.commit()
    return {"ok": True, "message": f"User {user_id} subscription set to {is_subscribed}"}


# ── Export ────────────────────────────────────────────────────────────────────

@app.get("/api/groups/{group_id}/export")
async def export_leads_csv(group_id: int, token: str, db: AsyncSession = Depends(get_db)):
    from auth import SECRET_KEY, ALGORITHM
    import jwt
    from fastapi import HTTPException
    
    # 1. Manually decode the JWT from the query parameter
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
        
    result = await db.execute(select(models.User).where(models.User.email == email))
    current_user = result.scalars().first()
    if not current_user:
        raise HTTPException(status_code=401, detail="User not found")

    # 2. Proceed with DB group export
    result = await db.execute(select(models.Group).where(models.Group.id == group_id, models.Group.user_id == current_user.id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    leads_result = await db.execute(select(models.Lead).where(models.Lead.group_id == group_id))
    leads = leads_result.scalars().all()

    output = io.StringIO()
    # Add BOM for Excel compatibility
    output.write('\ufeff')
    
    fieldnames = [
        "Name", "Category", "Phone", "Email", "WhatsApp", "Website",
        "Facebook", "Instagram", "LinkedIn", "Twitter", "TikTok", "YouTube",
        "Address", "City", "Country", "Hours of Operation", "Rating", "Reviews Count",
        "Location Type", "Is Claimed", "Photos Count",
        "Tech Stack", "Has Live Chat", "Has Online Booking",
        "Social Presence Score", "Copyright Year",
        "Pain Points", "Positive Themes", "Sentiment Trend",
        "Owner Response Rate", "Team Size", "Business Summary",
        "Lead Score", "Score Reason",
    ]
    
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    
    for lead in leads:
        writer.writerow({
            "Name": lead.name, "Category": lead.category, "Phone": lead.phone,
            "Email": lead.email, "WhatsApp": lead.whatsapp_link, "Website": lead.website,
            "Facebook": lead.facebook_url, "Instagram": lead.instagram_url,
            "LinkedIn": lead.linkedin_url, "Twitter": lead.twitter_url,
            "TikTok": lead.tiktok_url, "YouTube": lead.youtube_url,
            "Address": lead.address, "City": lead.city, "Country": lead.country,
            "Hours of Operation": lead.hours_of_operation, "Rating": lead.rating,
            "Reviews Count": lead.reviews_count, "Location Type": lead.location_type,
            "Is Claimed": lead.is_claimed, "Photos Count": lead.photos_count,
            "Tech Stack": lead.tech_stack, "Has Live Chat": lead.has_live_chat,
            "Has Online Booking": lead.has_online_booking,
            "Social Presence Score": lead.social_presence_score,
            "Copyright Year": lead.copyright_year, "Pain Points": lead.pain_points,
            "Positive Themes": lead.positive_themes, "Sentiment Trend": lead.review_sentiment_trend,
            "Owner Response Rate": lead.owner_response_rate,
            "Team Size": lead.team_size_estimate, "Business Summary": lead.business_summary,
            "Lead Score": lead.lead_score, "Score Reason": lead.lead_score_reason,
        })

    output.seek(0)
    filename = f"{group.name.replace(' ', '_')}_leads.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


app.mount("/", StaticFiles(directory="static", html=True), name="static")
