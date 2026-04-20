import logging
from typing import List

from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from models import Base, Notification

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DATABASE_URL = "postgresql://app:secret@localhost/notifications"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="notification-service")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/health")
def health():
    logger.debug("health check")
    return {"status": "ok"}


@app.get("/notifications")
def list_notifications(db: Session = Depends(get_db)):
    logger.info("listing notifications")
    notifications = db.query(Notification).all()
    logger.debug("found %d notifications", len(notifications))
    return notifications


@app.get("/notifications/{notification_id}")
def get_notification(notification_id: int, db: Session = Depends(get_db)):
    logger.info("fetching notification id=%d", notification_id)
    notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notification:
        logger.warning("notification not found id=%d", notification_id)
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification


@app.delete("/notifications/{notification_id}")
def delete_notification(notification_id: int, db: Session = Depends(get_db)):
    logger.info("deleting notification id=%d", notification_id)
    notification = db.query(Notification).get(notification_id)
    if not notification:
        logger.error("attempted to delete non-existent notification id=%d", notification_id)
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(notification)
    db.commit()
    return {"deleted": notification_id}
