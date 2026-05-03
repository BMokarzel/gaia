// Package endpoint contains the Endpoint domain entity — an HTTP /
// gRPC / event-handler entry point exposed by a Service.
package endpoint

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Method enumerates HTTP/event verbs the analyser recognises.
type Method string

const (
	MethodGet     Method = "GET"
	MethodPost    Method = "POST"
	MethodPut     Method = "PUT"
	MethodPatch   Method = "PATCH"
	MethodDelete  Method = "DELETE"
	MethodOptions Method = "OPTIONS"
	MethodHead    Method = "HEAD"
	MethodEvent   Method = "EVENT" // for queue / topic handlers
	MethodRPC     Method = "RPC"   // for gRPC unary
)

// AuthKind labels the authentication scheme attached to the endpoint.
type AuthKind string

const (
	AuthNone   AuthKind = "none"
	AuthBearer AuthKind = "bearer"
	AuthBasic  AuthKind = "basic"
	AuthAPIKey AuthKind = "api_key"
	AuthOAuth  AuthKind = "oauth"
	AuthCustom AuthKind = "custom"
)

// Auth describes the authentication contract of an endpoint.
type Auth struct {
	Kind     AuthKind
	Required bool
	Notes    string
}

// Properties holds typed metadata for an Endpoint node.
type Properties struct {
	Method        Method
	Path          string
	ServiceID     shared.NodeID
	HandlerFnID   shared.NodeID
	Auth          Auth
	BodyShapeID   shared.NodeID
	QueryShapeID  shared.NodeID
	ParamsShapeID shared.NodeID
	MiddlewareIDs []shared.NodeID
}

// Endpoint is the aggregate that connects a route to its handler
// function and (transitively) to the body of side-effects it runs.
type Endpoint struct {
	ID         shared.NodeID
	Name       string // "<METHOD> <path>"
	Properties Properties
}

// Interface is the contract used by listeners/walkers.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetMethod() Method
	GetPath() string
	GetServiceID() shared.NodeID
}

// New builds an Endpoint. Path is normalised to the canonical
// "/foo/:bar" form (no trailing slash, leading slash enforced).
func New(serviceID shared.NodeID, method Method, path string, props Properties) (*Endpoint, error) {
	if serviceID.IsEmpty() {
		return nil, fmt.Errorf("%w: serviceID", shared.ErrMissingField)
	}
	if method == "" {
		return nil, fmt.Errorf("%w: method", shared.ErrMissingField)
	}
	path = normalizePath(path)
	if path == "" {
		return nil, fmt.Errorf("%w: path", shared.ErrMissingField)
	}
	id, err := shared.BuildEndpointID(serviceID, string(method), path)
	if err != nil {
		return nil, err
	}
	props.Method = method
	props.Path = path
	props.ServiceID = serviceID
	return &Endpoint{
		ID:         id,
		Name:       fmt.Sprintf("%s %s", method, path),
		Properties: props,
	}, nil
}

func (e *Endpoint) GetID() shared.NodeID        { return e.ID }
func (e *Endpoint) GetName() string             { return e.Name }
func (e *Endpoint) GetMethod() Method           { return e.Properties.Method }
func (e *Endpoint) GetPath() string             { return e.Properties.Path }
func (e *Endpoint) GetServiceID() shared.NodeID { return e.Properties.ServiceID }

func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	if len(p) > 1 {
		p = strings.TrimRight(p, "/")
	}
	return p
}

// Repository persists Endpoint nodes.
type Repository interface {
	Create(ctx context.Context, e *Endpoint) error
	Update(ctx context.Context, e *Endpoint) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Endpoint, error)
	GetAll(ctx context.Context) ([]*Endpoint, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Endpoint, error)
	GetByHandler(ctx context.Context, handlerFnID shared.NodeID) ([]*Endpoint, error)
	GetByMethodPath(ctx context.Context, serviceID shared.NodeID, method Method, path string) (*Endpoint, error)
}
