"""
backfill.py — Re-visit Google Maps for existing leads to populate new fields.
Run once to backfill: hours_of_operation, location_type, is_claimed, photos_count, is_permanently_closed
for all leads that have NULL in those columns.
"""
import asyncio
import re
import urllib.parse
import os
import sys

os.environ["TMPDIR"] = "/tmp"

from playwright.async_api import async_playwright
from sqlalchemy.future import select

# Make sure we can import our project modules
sys.path.insert(0, os.path.dirname(__file__))

from database import AsyncSessionLocal
from models import Lead


async def backfill_lead_maps_fields(lead, page):
    """Visit a lead's Maps listing and extract the missing Maps fields."""
    query = lead.name
    if lead.address:
        query = f"{lead.name} {lead.address}"

    search_url = f"https://www.google.com/maps/search/{urllib.parse.quote(query)}"

    try:
        await page.goto(search_url, timeout=20000)
        await page.wait_for_timeout(2500)

        # Click first result
        first = page.locator("a.hfpxzc").first
        if await first.count() == 0:
            return {}
        await first.click(force=True)
        await page.wait_for_timeout(3000)

    except Exception as e:
        print(f"    [nav error] {e}")
        return {}

    result = {}

    # Hours of operation
    try:
        hours_el = page.locator('table.eK4R0e, div[aria-label*="Hours"] table')
        if await hours_el.count() > 0:
            result["hours_of_operation"] = (await hours_el.first.text_content() or "").strip()[:200]
        else:
            h_btn = page.locator('button[data-item-id="oh"]')
            if await h_btn.count() > 0:
                result["hours_of_operation"] = (await h_btn.first.text_content() or "").strip()[:200]
            else:
                h_any = page.locator('[aria-label*="hours" i]').first
                if await h_any.count() > 0:
                    attr = await h_any.get_attribute("aria-label") or ""
                    if attr:
                        result["hours_of_operation"] = attr[:200]
    except:
        pass

    # Permanently closed
    try:
        closed_el = page.locator('span:has-text("Permanently closed"), div:has-text("Permanently closed")')
        result["is_permanently_closed"] = (await closed_el.count()) > 0
    except:
        result["is_permanently_closed"] = False

    # Location type
    try:
        location_type = "Single Location"
        for sel in [
            'button:has-text("See all locations")',
            'a:has-text("See all locations")',
            'span:has-text("Part of a chain")',
            '[aria-label*="See all locations" i]',
        ]:
            if await page.locator(sel).count() > 0:
                location_type = "Multi-Location"
                break
        result["location_type"] = location_type
    except:
        pass

    # Photos count
    try:
        photo_el = page.locator('[aria-label*="photo" i]').first
        if await photo_el.count() > 0:
            label = await photo_el.get_attribute("aria-label") or ""
            pm = re.search(r'([\d,]+)', label)
            if pm:
                result["photos_count"] = int(pm.group(1).replace(',', ''))
        if "photos_count" not in result:
            btn_el = page.locator('button[aria-label*="photo" i]').first
            if await btn_el.count() > 0:
                txt = await btn_el.text_content() or ""
                pm = re.search(r'([\d,]+)', txt)
                if pm:
                    result["photos_count"] = int(pm.group(1).replace(',', ''))
    except:
        pass

    # Claimed status
    try:
        unclaimed = page.locator(
            'a:has-text("Own this business"), '
            'button:has-text("Own this business"), '
            'a:has-text("Claim this business"), '
            'button:has-text("Claim this business")'
        )
        result["is_claimed"] = (await unclaimed.count()) == 0
    except:
        pass

    return result


async def run_backfill(group_id: int = None, limit: int = None):
    async with AsyncSessionLocal() as db:
        query = select(Lead)
        if group_id:
            query = query.where(Lead.group_id == group_id)
        # Only backfill leads missing the new fields
        query = query.where(Lead.hours_of_operation == None)
        result = await db.execute(query)
        leads = result.scalars().all()

    if limit:
        leads = leads[:limit]

    print(f"\nBackfilling {len(leads)} leads missing Maps fields...\n")

    if not leads:
        print("Nothing to backfill.")
        return

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, args=["--no-sandbox"])
        page = await browser.new_page()

        for i, lead in enumerate(leads):
            print(f"[{i+1}/{len(leads)}] {lead.name[:50]}")
            fields = await backfill_lead_maps_fields(lead, page)

            if fields:
                async with AsyncSessionLocal() as db:
                    lead_obj = await db.get(Lead, lead.id)
                    if lead_obj:
                        for key, val in fields.items():
                            setattr(lead_obj, key, val)
                        await db.commit()
                print(f"    ✓ Updated: {list(fields.keys())}")
            else:
                print(f"    — No data extracted")

        await browser.close()

    print(f"\nBackfill complete.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Backfill Maps fields for existing leads")
    parser.add_argument("--group", type=int, help="Only backfill leads from this group ID")
    parser.add_argument("--limit", type=int, help="Max number of leads to backfill")
    args = parser.parse_args()
    asyncio.run(run_backfill(group_id=args.group, limit=args.limit))
