import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy import Column, Integer, String, Float, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from kafka import KafkaProducer, KafkaConsumer
from celery import Celery

# ── Logging setup ────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ── Database setup ───────────────────────────────────────────────────────────

DATABASE_URL = "postgresql://app:secret@localhost/app"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ── ORM Models ───────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True)
    role = Column(String, default="user")


class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer)
    total = Column(Float)

# ── Kafka ────────────────────────────────────────────────────────────────────

producer = KafkaProducer(bootstrap_servers="localhost:9092")
consumer = KafkaConsumer("order.placed", bootstrap_servers="localhost:9092")

# ── Celery ───────────────────────────────────────────────────────────────────

celery = Celery("tasks", broker="redis://localhost:6379/0")

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/users")
def get_users(db: Session = Depends(get_db)):
    logger.info("Fetching all users")
    users = db.query(User).all()
    logger.debug("Found %d users", len(users))
    return users


@app.post("/users")
def create_user(user: dict, db: Session = Depends(get_db)):
    logger.info("Creating user: %s", user.get("name"))

    if not user.get("name"):
        logger.warning("Missing name field")
        raise HTTPException(status_code=400, detail="Name is required")

    db_user = User(**user)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    producer.send("user.created", value=str(db_user.id).encode())
    logger.info("User created id=%s", db_user.id)
    return db_user


@app.get("/users/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):
    logger.debug("Fetching user id=%d", user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning("User not found id=%d", user_id)
        raise HTTPException(status_code=404, detail="User not found")

    return user


@app.put("/users/{user_id}")
def update_user(user_id: int, updates: dict, db: Session = Depends(get_db)):
    logger.info("Updating user id=%d", user_id)

    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Not found")

    for key, value in updates.items():
        setattr(user, key, value)

    db.merge(user)
    db.commit()

    producer.send("user.updated", value=str(user_id).encode())
    logger.info("User updated id=%d", user_id)
    return user


@app.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    logger.info("Deleting user id=%d", user_id)

    user = db.query(User).get(user_id)
    if not user:
        logger.error("Attempted to delete non-existent user id=%d", user_id)
        raise HTTPException(status_code=404, detail="Not found")

    db.delete(user)
    db.commit()

    producer.send("user.deleted", value=str(user_id).encode())
    return {"deleted": user_id}


@app.get("/orders")
def get_orders(db: Session = Depends(get_db)):
    logger.info("Fetching all orders")

    orders = db.query(Order).all()
    for order in orders:
        if order.total > 1000:
            logger.warning("High value order id=%d total=%f", order.id, order.total)

    return orders


# ── Celery tasks ─────────────────────────────────────────────────────────────

@celery.task
def process_order(order_id: int):
    logger.info("Processing order id=%d", order_id)

    db = SessionLocal()
    try:
        order = db.query(Order).get(order_id)
        if not order:
            logger.error("Order not found id=%d", order_id)
            return

        if order.total > 500:
            logger.info("Large order detected, notifying team")
            producer.send("order.large", value=str(order_id).encode())
        else:
            logger.debug("Standard order processed id=%d", order_id)
    finally:
        db.close()


# ── Kafka consumer loop ───────────────────────────────────────────────────────

def start_consumer():
    logger.info("Starting Kafka consumer for order.placed")
    for message in consumer:
        logger.debug("Received message: %s", message.value)
        process_order.delay(int(message.value))
