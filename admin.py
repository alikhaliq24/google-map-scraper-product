import asyncio
import sys
import argparse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from database import AsyncSessionLocal
from models import User

async def set_subscription(email: str, status: bool):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalars().first()
        
        if not user:
            print(f"❌ Error: User with email '{email}' not found in the database.")
            return

        user.is_subscribed = status
        await db.commit()
        
        state_str = "ENABLED" if status else "REVOKED"
        print(f"✅ Success: Subscription manually {state_str} for {email}!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Manually manage user subscriptions.")
    parser.add_argument("email", type=str, help="The email address of the user")
    parser.add_argument("--revoke", action="store_true", help="Revoke the subscription instead of granting it")
    
    args = parser.parse_args()
    status_to_set = False if args.revoke else True
    
    asyncio.run(set_subscription(args.email, status_to_set))
