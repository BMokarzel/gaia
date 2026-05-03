// Package edge contains the Edge domain entity. Edges are how the
// gaia knowledge graph wires nodes together: parent_of (AST), calls,
// reads_from, depends_on, owns, etc.
package edge

import (
	"context"
	"fmt"

	"gaia/services/api/internal/modules/shared"
)

// Kind enumerates the relations supported by the graph. New kinds
// should require an explicit decision: there is no generic "related"
// edge.
type Kind string

const (
	KindParentOf   Kind = "parent_of"
	KindCalls      Kind = "calls"
	KindReadsFrom  Kind = "reads_from"
	KindWritesTo   Kind = "writes_to"
	KindDependsOn  Kind = "depends_on"
	KindOwns       Kind = "owns"
	KindEmits      Kind = "emits"
	KindConsumes   Kind = "consumes"
	KindResolvesTo Kind = "resolves_to"
	KindReturns    Kind = "returns"
	KindThrows     Kind = "throws"
	KindLogs       Kind = "logs"
	KindBranchOf   Kind = "branch_of"
	KindHandledBy  Kind = "handled_by"
)

// validKinds is the membership set used by the constructor.
var validKinds = map[Kind]struct{}{
	KindParentOf: {}, KindCalls: {}, KindReadsFrom: {}, KindWritesTo: {},
	KindDependsOn: {}, KindOwns: {}, KindEmits: {}, KindConsumes: {},
	KindResolvesTo: {}, KindReturns: {}, KindThrows: {}, KindLogs: {},
	KindBranchOf: {}, KindHandledBy: {},
}

// Edge is a directed relation between two nodes.
type Edge struct {
	ID       shared.NodeID
	Kind     Kind
	Source   shared.NodeID
	Target   shared.NodeID
	Metadata map[string]any
}

// Interface is the minimal contract every edge satisfies, used by
// adjacency walkers that don't care about Metadata.
type Interface interface {
	GetID() shared.NodeID
	GetKind() Kind
	GetSource() shared.NodeID
	GetTarget() shared.NodeID
}

// New constructs an Edge with deterministic id and validates
// invariants: kind is recognised, source and target are non-empty
// and distinct.
func New(kind Kind, source, target shared.NodeID, metadata map[string]any) (*Edge, error) {
	if kind == "" {
		return nil, fmt.Errorf("%w: edge kind", shared.ErrMissingField)
	}
	if _, ok := validKinds[kind]; !ok {
		return nil, fmt.Errorf("%w: unknown edge kind %q", shared.ErrInvalidValue, kind)
	}
	if source.IsEmpty() {
		return nil, fmt.Errorf("%w: edge source", shared.ErrMissingField)
	}
	if target.IsEmpty() {
		return nil, fmt.Errorf("%w: edge target", shared.ErrMissingField)
	}
	if source == target {
		return nil, fmt.Errorf("%w: edge source and target must differ (%s)", shared.ErrInvalidValue, source)
	}
	return &Edge{
		ID:       shared.NodeID(fmt.Sprintf("edge:%s:%s->%s", kind, source, target)),
		Kind:     kind,
		Source:   source,
		Target:   target,
		Metadata: metadata,
	}, nil
}

func (e *Edge) GetID() shared.NodeID     { return e.ID }
func (e *Edge) GetKind() Kind            { return e.Kind }
func (e *Edge) GetSource() shared.NodeID { return e.Source }
func (e *Edge) GetTarget() shared.NodeID { return e.Target }

// Repository persists edges and supports adjacency queries on both
// sides. Implementations should index source and target columns.
type Repository interface {
	Create(ctx context.Context, e *Edge) error
	Update(ctx context.Context, e *Edge) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Edge, error)
	GetAll(ctx context.Context) ([]*Edge, error)
	GetBySource(ctx context.Context, id shared.NodeID) ([]*Edge, error)
	GetByTarget(ctx context.Context, id shared.NodeID) ([]*Edge, error)
	GetByKind(ctx context.Context, kind Kind) ([]*Edge, error)
}
