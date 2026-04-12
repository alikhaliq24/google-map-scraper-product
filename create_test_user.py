import asyncio
import sys
import os

# Ensure the app context is available
sys.path.insert(0, os.path.dirname(__file__))

from database import AsyncSessionLocal
from models import User
from auth import get_password_hash
from sqlalchemy.future import select

async def create_test_user():
    email = "test@example.com"
    pwd = "password123"
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalars().first()
        
        if not user:
            user = User(email=email, hashed_password=get_password_hash(pwd), is_subscribed=True)
            db.add(user)
            await db.commit()
            print(f"User {email} created & subscribed.")
        else:
            user.is_subscribed = True
            await db.commit()
            print(f"User {email} already exists. Subscription forcefully activated.")

if __name__ == "__main__":
    asyncio.run(create_test_user())
