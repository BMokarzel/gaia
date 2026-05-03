// Package method contains the Method domain entity — a class-bound
// callable. Distinct from Function so we can preserve owner-class
// identity in the graph and query "methods of class X" cheaply.
package method

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Visibility is the access modifier inferred for the method.
type Visibility string

const (
	VisibilityPublic    Visibility = "public"
	VisibilityProtected Visibility = "protected"
	VisibilityPrivate   Visibility = "private"
)

// Properties holds typed metadata for a Method node.
type Properties struct {
	ClassID    shared.NodeID
	ServiceID  shared.NodeID
	File       string
	Line       int
	Signature  string
	ReturnType string
	Visibility Visibility
	IsAsync    bool
	IsStatic   bool
	Decorators []string
}

// Method is a class-bound callable.
type Method struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface is the minimal contract for method consumers.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetClassID() shared.NodeID
	GetSignature() string
}

// New constructs a Method with id "mth:<classID>::<name>".
func New(classID shared.NodeID, name string, props Properties) (*Method, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("%w: name", shared.ErrMissingField)
	}
	if classID.IsEmpty() {
		return nil, fmt.Errorf("%w: classID", shared.ErrMissingField)
	}
	if props.Visibility == "" {
		props.Visibility = VisibilityPublic
	}
	id, err := shared.BuildMethodID(classID, name)
	if err != nil {
		return nil, err
	}
	props.ClassID = classID
	return &Method{ID: id, Name: name, Properties: props}, nil
}

func (m *Method) GetID() shared.NodeID      { return m.ID }
func (m *Method) GetName() string           { return m.Name }
func (m *Method) GetClassID() shared.NodeID { return m.Properties.ClassID }
func (m *Method) GetSignature() string      { return m.Properties.Signature }

// Repository persists Method nodes.
type Repository interface {
	Create(ctx context.Context, m *Method) error
	Update(ctx context.Context, m *Method) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Method, error)
	GetAll(ctx context.Context) ([]*Method, error)
	GetByClass(ctx context.Context, classID shared.NodeID) ([]*Method, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Method, error)
}
