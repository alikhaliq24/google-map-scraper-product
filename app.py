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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

@app.post("/api/groups", response_model=schemas.Group)
async def create_group(group_in: schemas.GroupCreate, bg_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    group_name = group_in.query
    db_group = models.Group(name=group_name)
    db.add(db_group)
    await db.commit()
    await db.refresh(db_group)
    
    bg_tasks.add_task(scrape_google_maps, db_group.id, group_in.query, group_in.limit)
    return db_group

@app.post("/api/groups/{group_id}/append", response_model=schemas.Group)
async def append_group(group_id: int, append_in: schemas.AppendCreate, bg_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id))
    db_group = result.scalars().first()
    if not db_group:
        raise HTTPException(status_code=404, detail="Group not found")
        
    db_group.status = "scraping"
    await db.commit()
    
    bg_tasks.add_task(scrape_google_maps, db_group.id, db_group.name, append_in.limit)
    return db_group

@app.get("/api/groups", response_model=list[schemas.Group])
async def list_groups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).order_by(models.Group.created_at.desc()))
    return result.scalars().all()

@app.get("/api/groups/{group_id}/leads", response_model=list[schemas.Lead])
async def list_group_leads(group_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Lead).where(models.Lead.group_id == group_id))
    return result.scalars().all()

@app.put("/api/groups/{group_id}", response_model=schemas.Group)
async def update_group(group_id: int, group_in: schemas.GroupUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    group.name = group_in.name
    await db.commit()
    await db.refresh(group)
    return group

@app.delete("/api/groups/{group_id}")
async def delete_group(group_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.delete(group)
    await db.commit()
    return {"ok": True}

@app.get("/api/groups/{group_id}/export")
async def export_leads_csv(group_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Group).where(models.Group.id == group_id))
    group = result.scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    leads_result = await db.execute(select(models.Lead).where(models.Lead.group_id == group_id))
    leads = leads_result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Name", "Category", "Phone", "Website", "Address", "Reviews Count", "Rating"
    ])
    for lead in leads:
        writer.writerow([
            lead.name,
            lead.category,
            lead.phone,
            lead.website,
            lead.address,
            lead.reviews_count,
            lead.rating
        ])

    output.seek(0)
    filename = f"{group.name.replace(' ', '_')}_leads.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

app.mount("/", StaticFiles(directory="static", html=True), name="static")
