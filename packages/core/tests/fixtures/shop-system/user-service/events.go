package main

import (
	"context"
	"encoding/json"

	"github.com/segmentio/kafka-go"
	"github.com/sirupsen/logrus"
)

type EventPublisher struct {
	writer *kafka.Writer
}

func (p *EventPublisher) PublishUserCreated(ctx context.Context, userID uint) {
	payload, _ := json.Marshal(map[string]interface{}{"id": userID, "event": "user.created"})
	err := p.writer.WriteMessages(ctx, kafka.Message{
		Topic: "user.created",
		Value: payload,
	})
	if err != nil {
		logrus.WithError(err).Error("failed to publish user.created")
		return
	}
	logrus.WithField("user_id", userID).Info("published user.created event")
}

func (p *EventPublisher) PublishUserDeleted(ctx context.Context, userID uint) {
	payload, _ := json.Marshal(map[string]interface{}{"id": userID})
	err := p.writer.WriteMessages(ctx, kafka.Message{
		Topic: "user.deleted",
		Value: payload,
	})
	if err != nil {
		logrus.WithError(err).Error("failed to publish user.deleted")
		return
	}
	logrus.WithField("user_id", userID).Info("published user.deleted event")
}
