// Package function contains the Function domain entity. Top-level
// functions and methods are the primary unit of code execution; the
// AST-internal nodes (Call, Return, Throw, ...) anchor onto a Function.
package function

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Function node.
type Properties struct {
	ServiceID  shared.NodeID
	ClassID    shared.NodeID // empty for free-standing functions
	File       string
	Line       int
	Signature  string
	ReturnType string
	IsAsync    bool
	IsExported bool
}

// Function is a top-level callable unit (function declaration, arrow,
// method). Its body's AST internals are tracked via parent_of edges.
type Function struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface is the contract used by walkers that traverse fn bodies.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetServiceID() shared.NodeID
	GetSignature() string
}

// New constructs a Function with id "fn:<svcID>:<file>:<symbolPath>".
// symbolPath should already encode nesting (e.g. "outer.inner") so
// callers control disambiguation.
func New(serviceID shared.NodeID, symbolPath string, props Properties) (*Function, error) {
	if strings.TrimSpace(symbolPath) == "" {
		return nil, fmt.Errorf("%w: symbolPath", shared.ErrMissingField)
	}
	if props.File == "" {
		return nil, fmt.Errorf("%w: file", shared.ErrMissingField)
	}
	if props.Line < 0 {
		return nil, fmt.Errorf("%w: line must be >= 0", shared.ErrInvalidValue)
	}
	id, err := shared.BuildFunctionID(serviceID, props.File, symbolPath)
	if err != nil {
		return nil, err
	}
	props.ServiceID = serviceID
	return &Function{
		ID:         id,
		Name:       symbolPath,
		Properties: props,
	}, nil
}

func (f *Function) GetID() shared.NodeID        { return f.ID }
func (f *Function) GetName() string             { return f.Name }
func (f *Function) GetServiceID() shared.NodeID { return f.Properties.ServiceID }
func (f *Function) GetSignature() string        { return f.Properties.Signature }

// Repository persists Function nodes.
type Repository interface {
	Create(ctx context.Context, f *Function) error
	Update(ctx context.Context, f *Function) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Function, error)
	GetAll(ctx context.Context) ([]*Function, error)
	GetByService(ctx context.Context, serviceID shared.NodeID) ([]*Function, error)
	GetByClass(ctx context.Context, classID shared.NodeID) ([]*Function, error)
	GetByFile(ctx context.Context, serviceID shared.NodeID, file string) ([]*Function, error)
}
