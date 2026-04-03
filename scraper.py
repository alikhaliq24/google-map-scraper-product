import asyncio
from playwright.async_api import async_playwright
from sqlalchemy.ext.asyncio import AsyncSession
from models import Group, Lead
from database import AsyncSessionLocal
import re
import os

os.environ["TMPDIR"] = "/tmp"

import urllib.parse
from sqlalchemy.future import select

async def scrape_google_maps(group_id: int, query: str, limit: int = 100):
    search_query = query
    
    async with AsyncSessionLocal() as db:
        group = await db.get(Group, group_id)
        if not group:
            return
        group.status = "scraping"
        await db.commit()

        try:
            async with async_playwright() as p:
                user_data_dir = "/tmp/playwright-scraper-data"
                browser = await p.chromium.launch_persistent_context(
                    user_data_dir,
                    headless=False, # Changed to False so you can see what is happening
                    args=["--no-sandbox", "--disable-dev-shm-usage"]
                )
                page = browser.pages[0] if len(browser.pages) > 0 else await browser.new_page()
                
                # Navigate directly to the search URL to bypass search box issues
                search_url = f"https://www.google.com/maps/search/{urllib.parse.quote(search_query)}"
                print(f"Navigating to {search_url}")
                await page.goto(search_url)
                
                # Wait for the user to potentially click "Accept Cookies" or solve CAPTCHA
                # We will wait up to 30 seconds for the first listing to appear.
                print("Waiting up to 30 seconds for listings to load...")
                try:
                    await page.locator('a.hfpxzc').first.wait_for(timeout=30000)
                except:
                    pass
                
                # We need to query existing leads in this group so we don't repeat them
                existing_result = await db.execute(select(Lead.name).where(Lead.group_id == group_id))
                existing_names = {row[0] for row in existing_result.all() if row[0]}
                
                target_total = len(existing_names) + limit
                print(f"Goal: {limit} leads. Already in DB: {len(existing_names)}. Target DOM elements: {target_total}")
                
                previous_count = 0
                stale_scrolls = 0

                # 1. SCROLL UNTIL WE HAVE ENOUGH LISTINGS LOADED
                print("Scrolling to load results...")
                while True:
                    listings = await page.locator('a.hfpxzc').all()
                    
                    if len(listings) >= target_total:
                        break
                        
                    if len(listings) == previous_count:
                        stale_scrolls += 1
                        if stale_scrolls > 5:
                            print("Reached the physical end of the Google Maps results.")
                            break
                    else:
                        stale_scrolls = 0
                        
                    previous_count = len(listings)
                    
                    if listings:
                        try:
                            # Scroll the last item to trigger lazy load container
                            await listings[-1].scroll_into_view_if_needed()
                            await page.wait_for_timeout(2000)
                        except:
                            await page.wait_for_timeout(1000)
                            pass

                # 2. RE-FETCH ALL ELEMENTS
                listings = await page.locator('a.hfpxzc').all()
                if not listings:
                    listings = await page.locator('a[href*="/maps/place/"]').all()
                    
                print(f"Loaded {len(listings)} total listings in the DOM.")
                
                # 3. EXTRACT NEW LEADS
                new_leads_extracted = 0
                processed_names = set(existing_names)
                
                for listing in listings:
                    if new_leads_extracted >= limit:
                        break
                        
                    try:
                        name = await listing.get_attribute("aria-label", timeout=5000)
                        if not name or name.strip() in processed_names:
                            continue
                        name = name.strip()
                    except Exception:
                        print("Listings DOM detached. Breaking extraction loop early.")
                        break
                    print(f"Extracting details for new listing: {name} ({new_leads_extracted+1}/{limit})")
                    
                    try:
                        await listing.scroll_into_view_if_needed()
                        await listing.click(force=True)
                        await page.wait_for_timeout(3000)

                        phone = None
                        try:
                            phone_el = page.locator('button[data-tooltip*="phone number" i]')
                            if await phone_el.count() > 0:
                                raw_phone = await phone_el.first.text_content()
                                raw_phone = raw_phone.replace('\u200e', '').replace('\u200f', '')
                                clean_phone = re.sub(r'[^\d\+\-\s\(\)]', '', raw_phone)
                                phone = clean_phone.strip()
                        except:
                            pass

                        website = None
                        try:
                            web_el = page.locator('a[data-tooltip*="website" i]')
                            if await web_el.count() > 0:
                                website = await web_el.first.get_attribute('href')
                        except:
                            pass

                        address = None
                        try:
                            addr_el = page.locator('button[data-tooltip*="address" i]')
                            if await addr_el.count() > 0:
                                raw_address = await addr_el.first.text_content()
                                raw_address = raw_address.replace('\u200e', '').replace('\u200f', '')
                                clean_addr = re.sub(r'^(Address:|address|)\s*', '', raw_address, flags=re.IGNORECASE)
                                address = clean_addr.strip()
                        except:
                            pass

                        category = None
                        try:
                            subtitle_el = page.locator('.fontBodyMedium').nth(1)
                            if await subtitle_el.count() > 0:
                                subtitle = await subtitle_el.text_content()
                                cat_parts = subtitle.split('·')
                                if len(cat_parts) > 0:
                                    raw_cat = cat_parts[0].replace('\u200e', '').strip()
                                    category = re.sub(r'^[\d\.]+\s*\(\d+\)\s*', '', raw_cat).strip()
                        except:
                            pass

                        reviews_text = ""
                        try:
                            reviews_el = page.locator('span[aria-label*="reviews"]')
                            if await reviews_el.count() > 0:
                                reviews_text = await reviews_el.first.text_content()
                        except:
                            pass
                        
                        reviews_count = 0
                        rating = 0.0
                        if reviews_text:
                            match = re.search(r'\((\d+.*?)\)', reviews_text)
                            if match:
                                reviews_count = int(match.group(1).replace(',', ''))
                            rate_el = page.locator('div.F7nice > span > span[aria-hidden="true"]').first
                            if await rate_el.count() > 0:
                                rating_str = await rate_el.text_content()
                                try:
                                    rating = float(rating_str)
                                except ValueError:
                                    pass

                        lead = Lead(
                            group_id=group.id,
                            name=name,
                            phone=phone if phone else None,
                            website=website if website else None,
                            address=address if address else None,
                            category=category if category else None,
                            reviews_count=reviews_count,
                            rating=rating,
                            owner_name=None,
                        )
                        db.add(lead)
                        await db.commit()
                        
                        processed_names.add(name)
                        new_leads_extracted += 1

                        # Close the details panel to reveal the search list again
                        try:
                            # Using strictly 'Back' to prevent accidentally clicking the search box 'Clear' or 'Close' button!
                            back_btn = page.locator('button[aria-label="Back" i], button[aria-label="Back to results" i]').last
                            if await back_btn.count() > 0:
                                await back_btn.click(force=True)
                                await page.wait_for_timeout(1000)
                        except:
                            pass

                    except Exception as e:
                        import traceback
                        inner_err = traceback.format_exc()
                        print(f"Error extracting lead {name}: {e}\n{inner_err}")
                        continue
                
                await browser.close()
                
            group.status = "completed"
            await db.commit()
            
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            print(f"Scrape failed: {e}\n{error_details}")
            
            with open("scraper_error.log", "a") as f:
                f.write(f"Error for group {group_id} ({query}):\n{error_details}\n---\n")
                
            group.status = "failed"
            await db.commit()
