// Package owner contains the Owner domain entity — a team, user or
// email handle that owns one or more services/endpoints/files.
package owner

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Kind labels the source of the handle so visualisation can pick
// the right glyph (team avatar vs user vs email).
type Kind string

const (
	KindTeam  Kind = "team"  // "@org/team"
	KindUser  Kind = "user"  // "@user"
	KindEmail Kind = "email" // "person@example.com"
)

// Properties holds typed metadata for an Owner node.
type Properties struct {
	Kind   Kind
	Source string // file the handle was extracted from (e.g. CODEOWNERS)
}

// Owner is shared across services — a single OwnerID may anchor
// multiple "owns" edges from CODEOWNERS or manual configuration.
type Owner struct {
	ID         shared.NodeID
	Handle     string // canonical handle, lowercased
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetHandle() string
	GetKind() Kind
}

// New builds an Owner. Kind is inferred from the handle when zero
// (starts with "@org/" → team, "@" → user, contains "@" → email).
func New(handle string, props Properties) (*Owner, error) {
	handle = strings.TrimSpace(handle)
	if handle == "" {
		return nil, fmt.Errorf("%w: handle", shared.ErrMissingField)
	}
	id, err := shared.BuildOwnerID(handle)
	if err != nil {
		return nil, err
	}
	if props.Kind == "" {
		props.Kind = inferKind(handle)
	}
	return &Owner{
		ID:         id,
		Handle:     strings.ToLower(handle),
		Properties: props,
	}, nil
}

func (o *Owner) GetID() shared.NodeID { return o.ID }
func (o *Owner) GetHandle() string    { return o.Handle }
func (o *Owner) GetKind() Kind        { return o.Properties.Kind }

func inferKind(h string) Kind {
	switch {
	case strings.HasPrefix(h, "@") && strings.Contains(h, "/"):
		return KindTeam
	case strings.HasPrefix(h, "@"):
		return KindUser
	case strings.Contains(h, "@"):
		return KindEmail
	default:
		return KindUser
	}
}

// Repository persists Owner nodes.
type Repository interface {
	Create(ctx context.Context, o *Owner) error
	Update(ctx context.Context, o *Owner) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Owner, error)
	GetAll(ctx context.Context) ([]*Owner, error)
	GetByHandle(ctx context.Context, handle string) (*Owner, error)
	GetByKind(ctx context.Context, kind Kind) ([]*Owner, error)
}
