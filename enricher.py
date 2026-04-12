"""
enricher.py — Tier 1 Auto Enrichment
Visits each lead's website and extracts: email, social links, tech stack,
live chat, online booking, copyright year, and social presence score.
Triggered manually via the "⚡ Auto-Enrich All" button.
"""
import re
import asyncio
from typing import Optional
import httpx
from bs4 import BeautifulSoup
from sqlalchemy.future import select

from models import Lead
from database import AsyncSessionLocal


# ── Pattern Libraries ─────────────────────────────────────────────────────────

SOCIAL_PATTERNS = {
    "facebook_url":  r'https?://(?:www\.)?facebook\.com/[^\s"\'<>?]+',
    "instagram_url": r'https?://(?:www\.)?instagram\.com/[^\s"\'<>?]+',
    "linkedin_url":  r'https?://(?:www\.)?linkedin\.com/(?:company|in)/[^\s"\'<>?]+',
    "twitter_url":   r'https?://(?:www\.)?(?:twitter|x)\.com/[^\s"\'<>?]+',
    "tiktok_url":    r'https?://(?:www\.)?tiktok\.com/@[^\s"\'<>?]+',
    "youtube_url":   r'https?://(?:www\.)?youtube\.com/[^\s"\'<>?]+',
    "whatsapp_link": r'https?://(?:wa\.me|api\.whatsapp\.com/send|wa\.link)[^\s"\'<>]+',
}

TECH_SIGNATURES = {
    "WordPress":    ["wp-content/", "wp-includes/", "wordpress"],
    "Shopify":      ["cdn.shopify.com", "myshopify.com"],
    "Wix":          ["wix.com", "wixstatic.com", "_wix_"],
    "Squarespace":  ["squarespace.com", "sqsp.net"],
    "Webflow":      ["webflow.io", "webflow.com"],
    "HubSpot":      ["hs-scripts.com", "hubspot.com"],
    "Framer":       ["framer.com", "framer.website"],
    "GoDaddy":      ["secureserver.net", "godaddy.com"],
    "Weebly":       ["weebly.com", "editmysite.com"],
    "Joomla":       ["joomla", "/components/com_"],
    "Drupal":       ["drupal", "/sites/default/files/"],
    "PrestaShop":   ["prestashop"],
    "Magento":      ["magento", "mage/"],
    "BigCommerce":  ["bigcommerce.com", "bigcommerce"],
}

LIVE_CHAT_SIGNATURES = [
    "intercom.io", "widget.intercom.io",
    "drift.com", "js.driftt.com",
    "crisp.chat", "client.crisp.chat",
    "tawk.to", "embed.tawk.to",
    "tidio.com", "code.tidio.co",
    "livechat.com", "livechatinc.com",
    "zopim.com", "zopim",
    "olark.com",
    "freshchat.com", "wchat.freshchat.com",
]

BOOKING_SIGNATURES = [
    "calendly.com",
    "booksy.com",
    "fresha.com",
    "opentable.com",
    "acuityscheduling.com",
    "appointy.com",
    "setmore.com",
    "simplybook.me",
    "vagaro.com",
    "mindbodyonline.com",
    "booker.com",
    "square.site",
    "squareup.com/appointments",
    "pikkalink.com",
]

EMAIL_IGNORE = [
    "noreply", "no-reply", "example.com", "sentry.io",
    "wix.com", "w3.org", "schema.org", "googleapis.com",
    "cloudflare.com", "amazonaws.com", "shopify.com",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


# ── Core enrichment functions ─────────────────────────────────────────────────

async def fetch_html(client: httpx.AsyncClient, url: str) -> str:
    try:
        resp = await client.get(url, headers=HEADERS, timeout=10, follow_redirects=True)
        if resp.status_code == 200:
            return resp.text
    except Exception:
        pass
    return ""


def extract_emails(html: str) -> Optional[str]:
    candidates = re.findall(
        r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", html
    )
    for email in candidates:
        if not any(ign in email.lower() for ign in EMAIL_IGNORE):
            return email.lower()
    return None


def extract_social_links(html: str) -> dict:
    result = {}
    score = 0
    for field, pattern in SOCIAL_PATTERNS.items():
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            result[field] = match.group(0).rstrip("/.,;")
            if field not in ("whatsapp_link",):
                score += 1
    result["social_presence_score"] = score
    return result


def detect_tech_stack(html: str) -> Optional[str]:
    html_lower = html.lower()
    detected = [
        tech for tech, sigs in TECH_SIGNATURES.items()
        if any(sig.lower() in html_lower for sig in sigs)
    ]
    return ", ".join(detected) if detected else None


def detect_live_chat(html: str) -> bool:
    html_lower = html.lower()
    return any(sig in html_lower for sig in LIVE_CHAT_SIGNATURES)


def detect_online_booking(html: str) -> bool:
    html_lower = html.lower()
    return any(sig in html_lower for sig in BOOKING_SIGNATURES)


def extract_copyright_year(html: str) -> Optional[int]:
    match = re.search(r"©\s*(\d{4})", html)
    if not match:
        match = re.search(r"copyright\s+(\d{4})", html, re.IGNORECASE)
    if match:
        year = int(match.group(1))
        if 2000 <= year <= 2030:
            return year
    return None


async def enrich_from_website(url: str) -> dict:
    result = {
        "email": None,
        "whatsapp_link": None,
        "facebook_url": None,
        "instagram_url": None,
        "linkedin_url": None,
        "twitter_url": None,
        "tiktok_url": None,
        "youtube_url": None,
        "tech_stack": None,
        "has_live_chat": False,
        "has_online_booking": False,
        "copyright_year": None,
        "social_presence_score": 0,
    }

    if not url:
        return result

    base = url.rstrip("/")
    pages = [base, f"{base}/contact", f"{base}/about"]

    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            combined_html = ""
            for page_url in pages[:2]:   # homepage + contact only (speed)
                html = await fetch_html(client, page_url)
                combined_html += html

            if not combined_html:
                return result

            result["email"] = extract_emails(combined_html)

            socials = extract_social_links(combined_html)
            result.update(socials)

            result["tech_stack"] = detect_tech_stack(combined_html)
            result["has_live_chat"] = detect_live_chat(combined_html)
            result["has_online_booking"] = detect_online_booking(combined_html)
            result["copyright_year"] = extract_copyright_year(combined_html)

    except Exception as e:
        print(f"[enricher] Website fetch failed for {url}: {e}")

    return result


# ── Group-level orchestrator ──────────────────────────────────────────────────

async def auto_enrich_group(group_id: int):
    """Enrich all leads in a group that have a website URL."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Lead).where(Lead.group_id == group_id)
        )
        leads = result.scalars().all()

    for lead in leads:
        async with AsyncSessionLocal() as db:
            lead_obj = await db.get(Lead, lead.id)
            if not lead_obj:
                continue

            lead_obj.auto_enrichment_status = "enriching"
            await db.commit()

            try:
                if lead_obj.website:
                    data = await enrich_from_website(lead_obj.website)
                    for key, value in data.items():
                        setattr(lead_obj, key, value)
                    lead_obj.auto_enrichment_status = "done"
                else:
                    lead_obj.auto_enrichment_status = "done"  # no website, skip
            except Exception as e:
                print(f"[enricher] Lead {lead_obj.id} failed: {e}")
                lead_obj.auto_enrichment_status = "failed"

            await db.commit()
