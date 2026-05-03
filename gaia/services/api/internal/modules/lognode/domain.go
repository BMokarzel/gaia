// Package lognode contains the Log AST-internal domain entity — a
// console / structured log emission inside a function body.
//
// Package is named lognode (not "log") to avoid stdlib collision.
package lognode

import (
	"context"

	"gaia/services/api/internal/modules/shared"
)

// Level enumerates standard log severities.
type Level string

const (
	LevelDebug Level = "debug"
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
	LevelFatal Level = "fatal"
)

// Properties holds typed metadata for a Log node.
type Properties struct {
	ParentFnID   shared.NodeID
	Level        Level
	Message      string // raw template string (may include ${...})
	Logger       string // logger reference: "console", "logger", "this.logger", ...
	Conditional  bool
	PostorderIdx int
}

// Log is the persisted AST internal for a log statement.
type Log struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetParentFnID() shared.NodeID
	GetLevel() Level
}

// New builds a Log node. Defaults level to info when zero.
func New(parentFnID shared.NodeID, postorderIdx int, props Properties) (*Log, error) {
	if props.Level == "" {
		props.Level = LevelInfo
	}
	id, err := shared.BuildASTNodeID(parentFnID, "log", postorderIdx)
	if err != nil {
		return nil, err
	}
	props.ParentFnID = parentFnID
	props.PostorderIdx = postorderIdx
	name := string(props.Level)
	if props.Message != "" {
		if len(props.Message) > 60 {
			name = name + ": " + props.Message[:57] + "..."
		} else {
			name = name + ": " + props.Message
		}
	}
	return &Log{ID: id, Name: name, Properties: props}, nil
}

func (l *Log) GetID() shared.NodeID         { return l.ID }
func (l *Log) GetName() string              { return l.Name }
func (l *Log) GetParentFnID() shared.NodeID { return l.Properties.ParentFnID }
func (l *Log) GetLevel() Level              { return l.Properties.Level }

// Repository persists Log nodes.
type Repository interface {
	Create(ctx context.Context, l *Log) error
	Update(ctx context.Context, l *Log) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*Log, error)
	GetAll(ctx context.Context) ([]*Log, error)
	GetByParentFn(ctx context.Context, parentFnID shared.NodeID) ([]*Log, error)
	GetByLevel(ctx context.Context, level Level) ([]*Log, error)
}
