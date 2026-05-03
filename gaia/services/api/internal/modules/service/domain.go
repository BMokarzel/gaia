// Package service contains the Service domain entity — a top-level
// deployable unit (microservice, BFF, gateway, etc.).
package service

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Type classifies a service. Drives the visualisation icon and the
// reasoning the analyser applies (e.g. gateways forward, workers
// don't expose endpoints, externals are not extracted).
type Type string

const (
	TypeGateway   Type = "gateway"
	TypeBff       Type = "bff"
	TypeService   Type = "service"
	TypeDataStore Type = "data-store"
	TypeWorker    Type = "worker"
	TypeExternal  Type = "external"
)

var validTypes = map[Type]struct{}{
	TypeGateway: {}, TypeBff: {}, TypeService: {}, TypeDataStore: {},
	TypeWorker: {}, TypeExternal: {},
}

// Properties holds typed metadata for a Service node.
type Properties struct {
	Language string
	RepoURL  string
	Type     Type
	OwnerIDs []shared.NodeID
}

// Service is the aggregate root for a deployable unit. Endpoints,
// functions, databases and middlewares all anchor onto a Service.
type Service struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface is the contract used by aggregates that hold services.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetType() Type
}

// New builds a Service. Slug becomes the id segment; name is the
// human-readable label. Type defaults to TypeService when zero.
func New(slug, name string, props Properties) (*Service, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if props.Type == "" {
		props.Type = TypeService
	}
	if _, ok := validTypes[props.Type]; !ok {
		return nil, fmt.Errorf("%w: unknown service type %q", shared.ErrInvalidValue, props.Type)
	}
	id, err := shared.BuildServiceID(slug)
	if err != nil {
		return nil, err
	}
	return &Service{ID: id, Name: name, Properties: props}, nil
}

func (s *Service) GetID() shared.NodeID { return s.ID }
func (s *Service) GetName() string      { return s.Name }
func (s *Service) GetType() Type        { return s.Properties.Type }

// Repository persists Service nodes.
type Repository interface {
	Create(ctx context.Context, s *Service) error
	Update(ctx context.Context, s *Service) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Service, error)
	GetAll(ctx context.Context) ([]*Service, error)
	GetByName(ctx context.Context, name string) (*Service, error)
	GetByOwner(ctx context.Context, ownerID shared.NodeID) ([]*Service, error)
}
