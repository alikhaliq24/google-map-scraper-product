"""
llm_enricher.py — Tier 2 LLM Enrichment (per-lead, on-demand)
Scrapes Google Reviews via Playwright, fetches website text,
then calls OpenAI GPT-4o-mini to produce structured business insights.
"""
import asyncio
import json
import os
import re
import urllib.parse
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import AsyncOpenAI
from playwright.async_api import async_playwright
from sqlalchemy.future import select

from database import AsyncSessionLocal
from models import Lead, User
from security import decrypt_api_key

load_dotenv()


# ── Review Scraper ────────────────────────────────────────────────────────────

async def scrape_reviews(business_name: str, address: Optional[str] = None) -> str:
    """
    Navigate to Google Maps, open the business's Reviews tab,
    scroll to load up to 50 reviews, and return them as a string.
    """
    reviews_lines = []
    query = business_name
    if address:
        query = f"{business_name} {address}"

    search_url = f"https://www.google.com/maps/search/{urllib.parse.quote(query)}"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            page = await browser.new_page()

            await page.goto(search_url, timeout=30000)
            await page.wait_for_timeout(3000)

            # Click first listing
            first = page.locator("a.hfpxzc").first
            if await first.count() == 0:
                await browser.close()
                return ""

            await first.click(force=True)
            await page.wait_for_timeout(3000)

            # Click Reviews tab
            reviews_tab = page.locator(
                'button[aria-label*="Reviews" i], '
                'button[data-tab-index="1"]'
            ).first
            if await reviews_tab.count() > 0:
                await reviews_tab.click()
                await page.wait_for_timeout(2000)

                # Sort by newest (optional, helps trend analysis)
                sort_btn = page.locator('button[aria-label*="Sort" i]').first
                if await sort_btn.count() > 0:
                    await sort_btn.click()
                    await page.wait_for_timeout(500)
                    newest = page.locator('li[role="menuitemradio"]:has-text("Newest")').first
                    if await newest.count() > 0:
                        await newest.click()
                        await page.wait_for_timeout(1500)

                # Scroll reviews pane to load more
                pane = page.locator('div[role="main"]').first
                for _ in range(5):
                    await pane.evaluate("el => el.scrollBy(0, 800)")
                    await page.wait_for_timeout(700)

                # Expand "More" links
                more_btns = await page.locator("button.w8nwRe").all()
                for btn in more_btns[:30]:
                    try:
                        await btn.click()
                        await page.wait_for_timeout(100)
                    except Exception:
                        pass

                # Extract reviews
                review_els = await page.locator(".jftiEf").all()
                for el in review_els[:50]:
                    try:
                        # Star rating
                        rating_el = el.locator("span[aria-label*='star' i]").first
                        stars = ""
                        if await rating_el.count() > 0:
                            label = await rating_el.get_attribute("aria-label") or ""
                            stars_match = re.search(r"(\d)", label)
                            stars = f"{stars_match.group(1)}★" if stars_match else ""

                        # Review text
                        text_el = el.locator(".wiI7pd, .MyEned").first
                        body = ""
                        if await text_el.count() > 0:
                            body = (await text_el.text_content() or "").strip()

                        if body:
                            reviews_lines.append(f"[{stars}] {body}")
                    except Exception:
                        pass

            await browser.close()

    except Exception as e:
        print(f"[llm_enricher] Review scraping failed for '{business_name}': {e}")

    return "\n".join(reviews_lines[:50])


# ── Website Text Fetcher ──────────────────────────────────────────────────────

async def fetch_website_text(url: str) -> str:
    if not url:
        return ""

    text_parts = []
    base = url.rstrip("/")
    pages = [base, f"{base}/about", f"{base}/team"]

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        )
    }

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
            for page_url in pages[:2]:
                try:
                    resp = await c.get(page_url, headers=headers)
                    if resp.status_code == 200:
                        soup = BeautifulSoup(resp.text, "lxml")
                        for tag in soup(["script", "style", "nav", "footer", "head"]):
                            tag.decompose()
                        text_parts.append(soup.get_text(separator=" ", strip=True)[:2000])
                except Exception:
                    pass
    except Exception:
        pass

    return " ".join(text_parts)[:4000]


# ── LLM Call ─────────────────────────────────────────────────────────────────

async def call_openai(lead: Lead, reviews_text: str, website_text: str, user_openai_key: str) -> dict:
    
    # Natively decrypt the user's api key and instantiate a transient OpenAI client
    decrypted_key = decrypt_api_key(user_openai_key)
    client = AsyncOpenAI(api_key=decrypted_key)

    social_channels = []
    if lead.facebook_url:  social_channels.append("Facebook")
    if lead.instagram_url: social_channels.append("Instagram")
    if lead.linkedin_url:  social_channels.append("LinkedIn")
    if lead.twitter_url:   social_channels.append("Twitter/X")
    if lead.tiktok_url:    social_channels.append("TikTok")
    if lead.youtube_url:   social_channels.append("YouTube")

    prompt = f"""You are a B2B lead analyst evaluating a local business for outreach potential.

=== BUSINESS DATA ===
Name: {lead.name}
Category: {lead.category or "Unknown"}
Rating: {lead.rating} stars ({lead.reviews_count} reviews)
Location Type: {lead.location_type or "Unknown"}
Has Website: {"Yes" if lead.website else "No"}
Social Channels: {", ".join(social_channels) if social_channels else "None found"}
Has Live Chat: {lead.has_live_chat or False}
Has Online Booking: {lead.has_online_booking or False}
Tech Stack: {lead.tech_stack or "Unknown"}
Photos Count: {lead.photos_count or "Unknown"}
Is Claimed: {lead.is_claimed}

=== WEBSITE TEXT (excerpt) ===
{website_text[:2500] if website_text else "Not available"}

=== GOOGLE REVIEWS ===
{reviews_text[:3000] if reviews_text else "No reviews available"}

=== INSTRUCTIONS ===
Analyze the above data and return ONLY a valid JSON object with exactly these fields.
Do not include any explanation, markdown, or code fences — raw JSON only.

{{
  "pain_points": ["<3 words max each — top 3 customer complaints from low-star reviews>", "...", "..."],
  "positive_themes": ["<3 words max each — top 3 things customers love>", "...", "..."],
  "review_sentiment_trend": "<Improving|Declining|Stable — based on oldest vs newest review tone>",
  "owner_response_rate": "<Always|Sometimes|Never — based on visible owner replies>",
  "team_size_estimate": "<1-10|11-50|51-200|200+|Unknown>",
  "business_summary": "<One sentence: what this business does and who it serves>",
  "locations_summary": "<Based on the website text, does this business have multiple locations/branches/offices/franchises? Be specific if possible, e.g. 'Single location' or '3 branches: NYC, LA, Chicago' or 'Franchise with 20+ locations'>",
  "lead_score": <integer 1-100>,
  "lead_score_reason": "<1-2 sentences explaining the score>"
}}"""

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=700,
    )

    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    return json.loads(raw)


# ── Main orchestrator ─────────────────────────────────────────────────────────

async def llm_enrich_lead(lead_id: int):
    """Full Tier 2 LLM enrichment pipeline for a single lead."""
    async with AsyncSessionLocal() as db:
        lead = await db.get(Lead, lead_id)
        if not lead:
            return

        lead.llm_enrichment_status = "enriching"
        await db.commit()

    try:
        # Gather texts
        reviews_text, website_text = await asyncio.gather(
            scrape_reviews(lead.name, lead.address),
            fetch_website_text(lead.website),
        )

        async with AsyncSessionLocal() as db:
            from models import Group, User
            lead_group_req = await db.get(Lead, lead_id)
            group_req = await db.get(Group, lead_group_req.group_id)
            user_req = await db.get(User, group_req.user_id) if group_req else None
            
        if not user_req or not user_req.openai_api_key:
            raise Exception("No OpenAI API key found for this user.")

        llm_data = await call_openai(lead, reviews_text, website_text, user_req.openai_api_key)

        async with AsyncSessionLocal() as db:
            lead_obj = await db.get(Lead, lead_id)
            if not lead_obj:
                return

            lead_obj.pain_points            = " | ".join(llm_data.get("pain_points", []))
            lead_obj.positive_themes        = " | ".join(llm_data.get("positive_themes", []))
            lead_obj.review_sentiment_trend = llm_data.get("review_sentiment_trend")
            lead_obj.owner_response_rate    = llm_data.get("owner_response_rate")
            lead_obj.team_size_estimate     = llm_data.get("team_size_estimate")
            lead_obj.business_summary       = llm_data.get("business_summary")
            lead_obj.locations_summary       = llm_data.get("locations_summary")
            lead_obj.lead_score              = llm_data.get("lead_score")
            lead_obj.lead_score_reason       = llm_data.get("lead_score_reason")
            lead_obj.llm_enrichment_status   = "done"

            await db.commit()

    except Exception as e:
        import traceback
        print(f"[llm_enricher] Lead {lead_id} failed:\n{traceback.format_exc()}")
        async with AsyncSessionLocal() as db:
            lead_obj = await db.get(Lead, lead_id)
            if lead_obj:
                lead_obj.llm_enrichment_status = "failed"
                await db.commit()
