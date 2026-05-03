// Package conditionexpr contains the ConditionExpr domain entity —
// a normalised AST representation of a boolean condition (the test
// of an if/while/ternary). Mirrors the TS ConditionExpr already in
// /tree (packages/code-graph/src/element.ts).
package conditionexpr

import (
	"context"
	"fmt"

	"gaia/services/api/internal/modules/shared"
)

// Kind is the discriminant of the recursive expression tree.
type Kind string

const (
	KindIdentifier Kind = "identifier"
	KindLiteral    Kind = "literal"
	KindMember     Kind = "member"
	KindBinary     Kind = "binary"
	KindLogical    Kind = "logical"
	KindUnary      Kind = "unary"
	KindCall       Kind = "call"
	KindTemplate   Kind = "template"
	KindUnknown    Kind = "unknown"
)

// Expr is the recursive node of the condition AST. Variants keep
// only the fields they need; consumers dispatch on Kind.
type Expr struct {
	Kind     Kind
	Text     string  // raw source text of the expression
	Name     string  // identifier name / member property
	Operator string  // for binary / logical / unary
	Operands []Expr  // children, by position
	Computed bool    // for member: true when foo[bar]
	Value    any     // for literal: the literal value
}

// Properties holds typed metadata for a ConditionExpr node.
type Properties struct {
	ParentFnID   shared.NodeID
	Expr         Expr
	PostorderIdx int
}

// ConditionExpr is the persisted node anchoring an Expr to its
// owning function. The expression itself is recursive (Expr); each
// FlowControl branch references the ConditionExpr node by id.
type ConditionExpr struct {
	ID         shared.NodeID
	Name       string // truncated text for label
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	GetKind() Kind
}

// New builds a ConditionExpr. The id is positional within parent fn.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*ConditionExpr, error) {
	if props.Expr.Kind == "" {
		return nil, fmt.Errorf("%w: expr.kind", shared.ErrMissingField)
	}
	id, err := shared.BuildASTNodeID(parentFnID, "cond", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	name := props.Expr.Text
	if len(name) > 80 {
		name = name[:77] + "..."
	}
	if name == "" {
		name = string(props.Expr.Kind)
	}
	return &ConditionExpr{ID: id, Name: name, Properties: props}, nil
}

func (c *ConditionExpr) GetID() shared.NodeID         { return c.ID }
func (c *ConditionExpr) GetName() string              { return c.Name }
func (c *ConditionExpr) GetParentFnID() shared.NodeID { return c.Properties.ParentFnID }
func (c *ConditionExpr) GetKind() Kind                { return c.Properties.Expr.Kind }

// Repository persists ConditionExpr nodes.
type Repository interface {
	Create(ctx context.Context, c *ConditionExpr) error
	Update(ctx context.Context, c *ConditionExpr) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*ConditionExpr, error)
	GetAll(ctx context.Context) ([]*ConditionExpr, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*ConditionExpr, error)
}
