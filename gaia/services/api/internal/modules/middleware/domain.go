// Package middleware contains the Middleware domain entity — a
// cross-cutting handler that runs before/after an endpoint
// (auth guard, logger, rate limiter, validation pipe, ...).
package middleware

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Kind names the middleware category. Drives default reject status
// code in the simulator (e.g. guard → 403, pipe → 400).
type Kind string

const (
	KindGuard       Kind = "guard"
	KindPipe        Kind = "pipe"
	KindFilter      Kind = "filter"
	KindInterceptor Kind = "interceptor"
	KindMiddleware  Kind = "middleware" // generic Express/Koa handler
)

// Stage tells when the middleware runs relative to the handler.
type Stage string

const (
	StagePre  Stage = "pre"
	StagePost Stage = "post"
	StageBoth Stage = "both"
)

// Properties holds typed metadata for a Middleware node.
type Properties struct {
	ServiceID  shared.NodeID
	ClassID    shared.NodeID // empty if function-style
	Kind       Kind
	Stage      Stage
	Decorators []string
	Global     bool // applied to all endpoints of the service
}

// Middleware represents a handler that wraps endpoints.
type Middleware struct {
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

// New builds a Middleware. The id is derived from service + name
// (we don't have a stable file/line tuple at this level; rename
// detection is post-MVP).
func New(serviceID shared.NodeID, name string, props Properties) (*Middleware, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if serviceID.IsEmpty() {
		return nil, fmt.Errorf("%w: serviceID", shared.ErrMissingField)
	}
	if props.Kind == "" {
		props.Kind = KindMiddleware
	}
	if props.Stage == "" {
		props.Stage = StagePre
	}
	id := shared.NodeID(fmt.Sprintf("mw:%s:%s", serviceID, sanitize(name)))
	props.ServiceID = serviceID
	return &Middleware{ID: id, Name: name, Properties: props}, nil
}

func (m *Middleware) GetID() shared.NodeID        { return m.ID }
func (m *Middleware) GetName() string             { return m.Name }
func (m *Middleware) GetKind() Kind               { return m.Properties.Kind }
func (m *Middleware) GetServiceID() shared.NodeID { return m.Properties.ServiceID }

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

// Repository persists Middleware nodes.
type Repository interface {
	Create(ctx context.Context, m *Middleware) error
	Update(ctx context.Context, m *Middleware) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Middleware, error)
	GetAll(ctx context.Context) ([]*Middleware, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Middleware, error)
	GetByKind(ctx context.Context, kind Kind) ([]*Middleware, error)
}
