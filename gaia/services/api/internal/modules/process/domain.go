// Package process contains the Process domain entity — a background
// worker, cron job or queue consumer running inside a Service.
package process

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Kind labels the trigger of a process.
type Kind string

const (
	KindCron     Kind = "cron"
	KindQueue    Kind = "queue"
	KindWorker   Kind = "worker"   // long-lived background loop
	KindSchedule Kind = "schedule" // generic time-based
)

// Properties holds typed metadata for a Process node.
type Properties struct {
	ServiceID   shared.NodeID
	Kind        Kind
	Schedule    string        // cron expression / queue name / topic
	HandlerFnID shared.NodeID // function executed per tick / message
}

// Process represents non-request-driven work owned by the service.
type Process struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetKind() Kind
	GetServiceID() shared.NodeID
}

// New builds a Process.
func New(serviceID shared.NodeID, name string, props Properties) (*Process, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if serviceID.IsEmpty() {
		return nil, fmt.Errorf("%w: serviceID", shared.ErrMissingField)
	}
	if props.Kind == "" {
		props.Kind = KindWorker
	}
	id := shared.NodeID(fmt.Sprintf("proc:%s:%s:%s", serviceID, props.Kind, sanitize(name)))
	props.ServiceID = serviceID
	return &Process{ID: id, Name: name, Properties: props}, nil
}

func (p *Process) GetID() shared.NodeID        { return p.ID }
func (p *Process) GetName() string             { return p.Name }
func (p *Process) GetKind() Kind               { return p.Properties.Kind }
func (p *Process) GetServiceID() shared.NodeID { return p.Properties.ServiceID }

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

// Repository persists Process nodes.
type Repository interface {
	Create(ctx context.Context, p *Process) error
	Update(ctx context.Context, p *Process) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Process, error)
	GetAll(ctx context.Context) ([]*Process, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Process, error)
	GetByKind(ctx context.Context, kind Kind) ([]*Process, error)
}
