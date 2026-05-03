// Package shared contains primitives reused across every module's
// domain layer: stable id construction, common errors, and the
// NodeKind discriminant.
//
// It is the only package every module is allowed to import without
// review — anything else in modules/ is feature-self-contained.
package shared

import "errors"

// Domain-level sentinel errors. Wrap with fmt.Errorf("%w: ...") to
// preserve the category while attaching context.
var (
	ErrInvalidID     = errors.New("invalid id")
	ErrMissingField  = errors.New("missing required field")
	ErrInvalidValue  = errors.New("invalid value")
	ErrNotFound      = errors.New("not found")
	ErrAlreadyExists = errors.New("already exists")
)
