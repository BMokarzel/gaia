// Package telemetry contains the Telemetry domain entity — observable
// emissions from inside a function: spans, traces, metrics, structured
// logs (the latter is also captured by the Log node when it's a plain
// console line; Telemetry is reserved for instrumentation).
package telemetry

import (
	"context"
	"fmt"

	"gaia/services/api/internal/modules/shared"
)

// Kind labels the telemetry signal.
type Kind string

const (
	KindSpan   Kind = "span"
	KindMetric Kind = "metric"
	KindTrace  Kind = "trace"
	KindLog    Kind = "log"
	KindEvent  Kind = "event"
)

// Properties holds typed metadata for a Telemetry node.
type Properties struct {
	ParentFnID   shared.NodeID
	Kind         Kind
	Name         string // metric name, span name, ...
	Attributes   map[string]string
	Provider     string // otel / prometheus / datadog / ...
	PostorderIdx int
}

// Telemetry is an AST-internal node tracking instrumentation calls.
type Telemetry struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetKind() Kind
	GetParentFnID() shared.NodeID
}

// New builds a Telemetry node.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*Telemetry, error) {
	if props.Kind == "" {
		return nil, fmt.Errorf("%w: kind", shared.ErrMissingField)
	}
	id, err := shared.BuildASTNodeID(parentFnID, "tel", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	if props.Name == "" {
		props.Name = string(props.Kind)
	}
	return &Telemetry{ID: id, Name: props.Name, Properties: props}, nil
}

func (t *Telemetry) GetID() shared.NodeID         { return t.ID }
func (t *Telemetry) GetName() string              { return t.Name }
func (t *Telemetry) GetKind() Kind                { return t.Properties.Kind }
func (t *Telemetry) GetParentFnID() shared.NodeID { return t.Properties.ParentFnID }

// Repository persists Telemetry nodes.
type Repository interface {
	Create(ctx context.Context, t *Telemetry) error
	Update(ctx context.Context, t *Telemetry) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Telemetry, error)
	GetAll(ctx context.Context) ([]*Telemetry, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*Telemetry, error)
	GetByKind(ctx context.Context, kind Kind) ([]*Telemetry, error)
}
