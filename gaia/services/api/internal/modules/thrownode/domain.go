// Package thrownode contains the Throw AST-internal domain entity —
// one throw / raise statement inside a function. The simulator uses
// HTTPStatus to surface "what could the user see".
package thrownode

import (
	"context"
	"fmt"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Throw node.
type Properties struct {
	ParentFnID    shared.NodeID
	ExceptionName string // class/identifier thrown (e.g. "NotFoundException")
	Message       string
	HTTPStatus    int  // 0 when not inferrable (see http-status inferrer)
	Conditional   bool // inside if/loop/switch/try
	Caught        bool // wrapped in try/catch in same fn
	PostorderIdx  int
}

// Throw is the persisted AST internal for a throw statement.
type Throw struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	GetHTTPStatus() int
}

// New builds a Throw.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*Throw, error) {
	if props.ExceptionName == "" {
		return nil, fmt.Errorf("%w: exceptionName", shared.ErrMissingField)
	}
	if props.HTTPStatus < 0 || props.HTTPStatus > 599 {
		return nil, fmt.Errorf("%w: httpStatus %d outside 0..599", shared.ErrInvalidValue, props.HTTPStatus)
	}
	id, err := shared.BuildASTNodeID(parentFnID, "thr", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	return &Throw{ID: id, Name: props.ExceptionName, Properties: props}, nil
}

func (t *Throw) GetID() shared.NodeID         { return t.ID }
func (t *Throw) GetName() string              { return t.Name }
func (t *Throw) GetParentFnID() shared.NodeID { return t.Properties.ParentFnID }
func (t *Throw) GetHTTPStatus() int           { return t.Properties.HTTPStatus }

// Repository persists Throw nodes.
type Repository interface {
	Create(ctx context.Context, t *Throw) error
	Update(ctx context.Context, t *Throw) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Throw, error)
	GetAll(ctx context.Context) ([]*Throw, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*Throw, error)
	GetByHTTPStatus(ctx context.Context, status int) ([]*Throw, error)
}
