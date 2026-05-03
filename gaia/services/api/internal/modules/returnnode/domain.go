// Package returnnode contains the Return AST-internal domain entity.
//
// Package is named returnnode because "return" is a Go keyword and
// can't be used as an import path.
package returnnode

import (
	"context"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Return node.
type Properties struct {
	ParentFnID    shared.NodeID
	ValueText     string        // raw expression (e.g. "user", "{ ok: true }")
	ValueShapeID  shared.NodeID // populated when shape can be resolved
	Conditional   bool          // inside if/loop/switch/try
	HTTPStatus    int           // optional: when return is a Response.status(N)
	PostorderIdx  int
}

// Return is the persisted AST internal for a return statement.
type Return struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	IsConditional() bool
}

// New builds a Return.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*Return, error) {
	id, err := shared.BuildASTNodeID(parentFnID, "ret", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	name := props.ValueText
	if len(name) > 60 {
		name = name[:57] + "..."
	}
	if name == "" {
		name = "return"
	}
	return &Return{ID: id, Name: name, Properties: props}, nil
}

func (r *Return) GetID() shared.NodeID         { return r.ID }
func (r *Return) GetName() string              { return r.Name }
func (r *Return) GetParentFnID() shared.NodeID { return r.Properties.ParentFnID }
func (r *Return) IsConditional() bool          { return r.Properties.Conditional }

// Repository persists Return nodes.
type Repository interface {
	Create(ctx context.Context, r *Return) error
	Update(ctx context.Context, r *Return) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Return, error)
	GetAll(ctx context.Context) ([]*Return, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*Return, error)
}

