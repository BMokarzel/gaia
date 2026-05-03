// Package event contains the Event domain entity — a publish or
// subscribe interaction with a queue / topic / pub-sub bus.
package event

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Direction labels whether the service produces or consumes.
type Direction string

const (
	DirectionPublish   Direction = "publish"
	DirectionSubscribe Direction = "subscribe"
)

// Properties holds typed metadata for an Event node.
type Properties struct {
	ServiceID   shared.NodeID
	Direction   Direction
	Topic       string // queue name / topic / channel
	Bus         string // kafka / rabbitmq / sns / ...
	HandlerFnID shared.NodeID // populated for subscribe
	PayloadID   shared.NodeID // ResolvedShape of the message payload
}

// Event is the link between a service and an async messaging bus.
type Event struct {
	ID         shared.NodeID
	Name       string // "<direction> <topic>"
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetTopic() string
	GetDirection() Direction
}

// New builds an Event.
func New(serviceID shared.NodeID, dir Direction, topic string, props Properties) (*Event, error) {
	if serviceID.IsEmpty() {
		return nil, fmt.Errorf("%w: serviceID", shared.ErrMissingField)
	}
	if dir != DirectionPublish && dir != DirectionSubscribe {
		return nil, fmt.Errorf("%w: direction must be publish|subscribe", shared.ErrInvalidValue)
	}
	if strings.TrimSpace(topic) == "" {
		return nil, fmt.Errorf("%w: topic", shared.ErrMissingField)
	}
	id := shared.NodeID(fmt.Sprintf("evt:%s:%s:%s", serviceID, dir, sanitize(topic)))
	props.ServiceID = serviceID
	props.Direction = dir
	props.Topic = topic
	return &Event{
		ID:         id,
		Name:       fmt.Sprintf("%s %s", dir, topic),
		Properties: props,
	}, nil
}

func (e *Event) GetID() shared.NodeID    { return e.ID }
func (e *Event) GetName() string         { return e.Name }
func (e *Event) GetTopic() string        { return e.Properties.Topic }
func (e *Event) GetDirection() Direction { return e.Properties.Direction }

func sanitize(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '_' || r == '-' || r == '.':
			return r
		default:
			return '_'
		}
	}, strings.TrimSpace(s))
}

// Repository persists Event nodes.
type Repository interface {
	Create(ctx context.Context, e *Event) error
	Update(ctx context.Context, e *Event) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Event, error)
	GetAll(ctx context.Context) ([]*Event, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Event, error)
	GetByTopic(ctx context.Context, topic string) ([]*Event, error)
	GetByDirection(ctx context.Context, dir Direction) ([]*Event, error)
}
