from pydantic import BaseModel
from typing import List, Optional
import datetime

class LeadBase(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    reviews_count: Optional[int] = None
    rating: Optional[float] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    category: Optional[str] = None

class Lead(LeadBase):
    id: int
    group_id: int

    class Config:
        orm_mode = True

class GroupCreate(BaseModel):
    query: str
    limit: int = 100

class AppendCreate(BaseModel):
    limit: int = 100

class GroupUpdate(BaseModel):
    name: str

class Group(BaseModel):
    id: int
    name: str
    status: str
    created_at: datetime.datetime

    class Config:
        orm_mode = True
