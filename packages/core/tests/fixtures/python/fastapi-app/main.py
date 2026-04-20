from fastapi import FastAPI
from sqlalchemy import create_engine, Column, String
from sqlalchemy.orm import DeclarativeBase, Session

app = FastAPI()
engine = create_engine("postgresql://localhost/db")


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    name = Column(String)


@app.get("/users")
async def list_users():
    with Session(engine) as session:
        return session.query(User).all()


@app.get("/users/{user_id}")
async def get_user(user_id: str):
    with Session(engine) as session:
        return session.query(User).filter(User.id == user_id).first()


@app.post("/users")
async def create_user(user: dict):
    return user


@app.delete("/users/{user_id}")
async def delete_user(user_id: str):
    return {"deleted": user_id}
