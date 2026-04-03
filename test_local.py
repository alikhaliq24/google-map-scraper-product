import asyncio
import sys
from scraper import scrape_google_maps
from database import engine, Base
from models import Group
from sqlalchemy.ext.asyncio import AsyncSession
from database import AsyncSessionLocal

async def test_scrape():
    # Ensure tables exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    async with AsyncSessionLocal() as session:
        new_group = Group(name="test fallback")
        session.add(new_group)
        await session.commit()
        await session.refresh(new_group)
        group_id = new_group.id
        
    print(f"Created group {group_id}, starting scrape...")
    try:
        await scrape_google_maps(group_id, "Plumbers in NYC")
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_scrape())
