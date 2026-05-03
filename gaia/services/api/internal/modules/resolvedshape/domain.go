// Package resolvedshape contains the ResolvedShape domain entity —
// a normalised, content-addressed description of a value's structure
// (DTOs, request bodies, DB rows, ...). Anonymous shapes dedup
// automatically via their content hash.
package resolvedshape

import (
	"context"
	"encoding/json"
	"fmt"

	"gaia/services/api/internal/modules/shared"
)

// Kind enumerates shape categories. Mirrors the TS ResolvedShape
// already used in /tree (packages/core/src/types/topology.ts).
type Kind string

const (
	KindPrimitive Kind = "primitive"
	KindObject    Kind = "object"
	KindArray     Kind = "array"
	KindUnion     Kind = "union"
	KindEnum      Kind = "enum"
	KindLiteral   Kind = "literal"
	KindCycle     Kind = "cycle"
	KindUnknown   Kind = "unknown"
)

// Field is one entry of an object shape.
type Field struct {
	Name     string
	Required bool
	Shape    Shape
}

// Shape is the recursive shape descriptor. Each variant keeps only
// the fields relevant to its kind; consumers must dispatch on Kind.
type Shape struct {
	Kind      Kind
	Primitive string  // "string"|"number"|"boolean"|"date"|... when Kind=primitive
	Fields    []Field // when Kind=object
	Items     *Shape  // when Kind=array
	OneOf     []Shape // when Kind=union
	EnumOf    []any   // when Kind=enum
	Literal   any     // when Kind=literal
	CycleRef  string  // when Kind=cycle, name of the type that cycled
}

// Properties holds typed metadata for a ResolvedShape node.
type Properties struct {
	Source string // "dto"|"db_row"|"event_payload"|... (provenance)
	Name   string // type alias name when known (e.g. "CreateUserDto")
	Shape  Shape
}

// ResolvedShape is the persisted node. Its id is a content hash so
// equivalent shapes collapse to the same node automatically.
type ResolvedShape struct {
	ID         shared.NodeID
	Name       string
	Properties Properties
}

// Interface — minimal contract.
type Interface interface {
	GetID() shared.NodeID
	GetName() string
	GetKind() Kind
}

// New builds a ResolvedShape. The id is sha256(canonicalJSON(shape))
// so input order of fields doesn't matter — Canonicalize sorts them.
func New(props Properties) (*ResolvedShape, error) {
	if props.Shape.Kind == "" {
		return nil, fmt.Errorf("%w: shape.kind", shared.ErrMissingField)
	}
	canon, err := canonicalBytes(props.Shape)
	if err != nil {
		return nil, fmt.Errorf("%w: canonicalising shape: %v", shared.ErrInvalidValue, err)
	}
	id := shared.BuildShapeID(canon)
	name := props.Name
	if name == "" {
		name = "anonymous:" + string(props.Shape.Kind)
	}
	return &ResolvedShape{ID: id, Name: name, Properties: props}, nil
}

func (r *ResolvedShape) GetID() shared.NodeID { return r.ID }
func (r *ResolvedShape) GetName() string      { return r.Name }
func (r *ResolvedShape) GetKind() Kind        { return r.Properties.Shape.Kind }

// canonicalBytes produces a stable JSON encoding for hashing. Fields
// inside objects are sorted; unions are sorted by canonical form of
// their member shapes.
func canonicalBytes(s Shape) ([]byte, error) {
	return json.Marshal(canonicalize(s))
}

// canonicalize converts the shape into an ordered map representation.
func canonicalize(s Shape) map[string]any {
	out := map[string]any{"kind": string(s.Kind)}
	switch s.Kind {
	case KindPrimitive:
		out["primitive"] = s.Primitive
	case KindObject:
		fields := make([]map[string]any, 0, len(s.Fields))
		// sort fields by name for stability
		names := make([]string, 0, len(s.Fields))
		idx := make(map[string]Field, len(s.Fields))
		for _, f := range s.Fields {
			names = append(names, f.Name)
			idx[f.Name] = f
		}
		sortStrings(names)
		for _, n := range names {
			f := idx[n]
			fields = append(fields, map[string]any{
				"name":     f.Name,
				"required": f.Required,
				"shape":    canonicalize(f.Shape),
			})
		}
		out["fields"] = fields
	case KindArray:
		if s.Items != nil {
			out["items"] = canonicalize(*s.Items)
		}
	case KindUnion:
		members := make([]map[string]any, 0, len(s.OneOf))
		for _, m := range s.OneOf {
			members = append(members, canonicalize(m))
		}
		out["oneOf"] = members
	case KindEnum:
		out["enumOf"] = s.EnumOf
	case KindLiteral:
		out["literal"] = s.Literal
	case KindCycle:
		out["cycleRef"] = s.CycleRef
	}
	return out
}

func sortStrings(s []string) {
	// Simple insertion sort; n is small (object field count).
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}

// Repository persists ResolvedShape nodes. Lookups by id (content
// hash) handle dedup naturally.
type Repository interface {
	Create(ctx context.Context, r *ResolvedShape) error
	Update(ctx context.Context, r *ResolvedShape) error
	Delete(ctx context.Context, id shared.NodeID) error
	Get(ctx context.Context, id shared.NodeID) (*ResolvedShape, error)
	GetAll(ctx context.Context) ([]*ResolvedShape, error)
	GetByName(ctx context.Context, name string) ([]*ResolvedShape, error)
}
