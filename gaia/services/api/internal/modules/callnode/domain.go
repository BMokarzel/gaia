// Package callnode contains the Call AST-internal domain entity —
// one function-call site inside a function body. Resolution to the
// callee Function (when local) is recorded as resolves_to edge.
//
// Package is named callnode (not "call") to leave the natural word
// available as a domain concept and avoid stdlib collisions.
package callnode

import (
	"context"
	"fmt"
	"strings"

	"gaia/services/api/internal/modules/shared"
)

// Properties holds typed metadata for a Call node.
type Properties struct {
	ParentFnID   shared.NodeID
	CalleeName   string        // raw text (e.g. "this.svc.create")
	ResolvedToID shared.NodeID // populated when callee is in-graph
	ArgsText     []string      // raw arg expressions (ast text)
	Conditional  bool          // inside if/loop/switch/try
	PostorderIdx int
}

// Call is the persisted AST internal for a function call.
type Call struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	GetCalleeName() string
}

// New builds a Call.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*Call, error) {
	if strings.TrimSpace(props.CalleeName) == "" {
		return nil, fmt.Errorf("%w: calleeName", shared.ErrMissingField)
	}
	id, err := shared.BuildASTNodeID(parentFnID, "call", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	return &Call{ID: id, Name: props.CalleeName, Properties: props}, nil
}

func (c *Call) GetID() shared.NodeID         { return c.ID }
func (c *Call) GetName() string              { return c.Name }
func (c *Call) GetParentFnID() shared.NodeID { return c.Properties.ParentFnID }
func (c *Call) GetCalleeName() string        { return c.Properties.CalleeName }

// Repository persists Call nodes.
type Repository interface {
	Create(ctx context.Context, c *Call) error
	Update(ctx context.Context, c *Call) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Call, error)
	GetAll(ctx context.Context) ([]*Call, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*Call, error)
	GetByResolvedTo(ctx context.Context, calleeFnID shared.NodeID) ([]*Call, error)
}
