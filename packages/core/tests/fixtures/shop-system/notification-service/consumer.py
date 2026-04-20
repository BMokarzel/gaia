import logging
import json
from kafka import KafkaConsumer
from sqlalchemy.orm import Session
from models import Notification

logger = logging.getLogger(__name__)

def handle_user_created(data: dict, db: Session) -> None:
    logger.info("handling user.created event user_id=%s", data.get("id"))
    notification = Notification(
        user_id=data.get("id"),
        event_type="user.created",
        message=f"Welcome user {data.get('id')}",
    )
    db.add(notification)
    db.commit()
    logger.info("notification saved for user.created user_id=%s", data.get("id"))

def handle_user_deleted(data: dict, db: Session) -> None:
    logger.info("handling user.deleted event user_id=%s", data.get("id"))
    notifications = db.query(Notification).filter_by(user_id=data.get("id")).all()
    for n in notifications:
        db.delete(n)
    db.commit()
    logger.info("notifications purged for deleted user user_id=%s", data.get("id"))

def handle_order_placed(data: dict, db: Session) -> None:
    logger.info("handling order.placed event order_id=%s", data.get("id"))
    if not data.get("user_id"):
        logger.warning("order.placed event missing user_id")
        return
    notification = Notification(
        user_id=data.get("user_id"),
        event_type="order.placed",
        message=f"Your order {data.get('id')} has been placed",
    )
    db.add(notification)
    db.commit()

def handle_order_shipped(data: dict, db: Session) -> None:
    logger.info("handling order.shipped event order_id=%s", data.get("id"))
    notification = Notification(
        user_id=data.get("user_id"),
        event_type="order.shipped",
        message=f"Your order {data.get('id')} has been shipped",
    )
    db.add(notification)
    db.commit()

def start_consumer(db: Session) -> None:
    logger.info("starting Kafka consumer")
    consumer = KafkaConsumer(
        "user.created",
        "user.deleted",
        "order.placed",
        "order.shipped",
        bootstrap_servers="localhost:9092",
        group_id="notification-service",
    )
    for message in consumer:
        topic = message.topic
        data = json.loads(message.value)
        logger.debug("received message topic=%s", topic)
        try:
            if topic == "user.created":
                handle_user_created(data, db)
            elif topic == "user.deleted":
                handle_user_deleted(data, db)
            elif topic == "order.placed":
                handle_order_placed(data, db)
            elif topic == "order.shipped":
                handle_order_shipped(data, db)
            else:
                logger.warning("unknown topic: %s", topic)
        except Exception as e:
            logger.error("failed to process message topic=%s error=%s", topic, str(e))
