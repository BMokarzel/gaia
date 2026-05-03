package shared

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
)

// NodeID is the canonical opaque identifier for any node in the gaia
// graph. The strategy used to build the id depends on node kind; see
// the BuildXxxID constructors in this file.
type NodeID string

// String returns the underlying string. Convenient for logging.
func (n NodeID) String() string { return string(n) }

// IsEmpty reports whether the id is the zero value.
func (n NodeID) IsEmpty() bool { return n == "" }

// idSegmentRe matches characters disallowed in id segments. We keep
// the alphanumerics, dot, slash, dash, underscore and at-sign so
// CODEOWNERS-style handles and file paths survive untouched.
var idSegmentRe = regexp.MustCompile(`[^a-zA-Z0-9_./@-]+`)

func sanitizeSegment(s string) string {
	return idSegmentRe.ReplaceAllString(strings.TrimSpace(s), "_")
}

func nonEmpty(field, v string) error {
	if strings.TrimSpace(v) == "" {
		return fmt.Errorf("%w: %s is required", ErrMissingField, field)
	}
	return nil
}

// normalizePath canonicalises filesystem paths used inside ids.
// Backslashes become forward slashes; leading "./" is stripped.
func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.TrimPrefix(p, "./")
	return p
}

// BuildServiceID returns "svc:<slug>".
func BuildServiceID(slug string) (NodeID, error) {
	if err := nonEmpty("slug", slug); err != nil {
		return "", err
	}
	return NodeID("svc:" + sanitizeSegment(strings.ToLower(slug))), nil
}

// BuildEndpointID returns "ep:<svcID>:<METHOD>:<path>".
func BuildEndpointID(serviceID NodeID, method, path string) (NodeID, error) {
	if serviceID.IsEmpty() {
		return "", fmt.Errorf("%w: serviceID is required", ErrMissingField)
	}
	if err := nonEmpty("method", method); err != nil {
		return "", err
	}
	if err := nonEmpty("path", path); err != nil {
		return "", err
	}
	return NodeID(fmt.Sprintf("ep:%s:%s:%s", serviceID, strings.ToUpper(method), normalizePath(path))), nil
}

// BuildFunctionID returns "fn:<svcID>:<file>:<symbolPath>". Stable
// across body refactors; fragile to rename/move (handled later by
// the symbol resolution table, post-MVP).
func BuildFunctionID(serviceID NodeID, file, symbolPath string) (NodeID, error) {
	if serviceID.IsEmpty() {
		return "", fmt.Errorf("%w: serviceID is required", ErrMissingField)
	}
	if err := nonEmpty("file", file); err != nil {
		return "", err
	}
	if err := nonEmpty("symbolPath", symbolPath); err != nil {
		return "", err
	}
	return NodeID(fmt.Sprintf("fn:%s:%s:%s", serviceID, normalizePath(file), symbolPath)), nil
}

// BuildClassID — same shape as function, distinct prefix.
func BuildClassID(serviceID NodeID, file, symbolPath string) (NodeID, error) {
	if serviceID.IsEmpty() {
		return "", fmt.Errorf("%w: serviceID is required", ErrMissingField)
	}
	if err := nonEmpty("file", file); err != nil {
		return "", err
	}
	if err := nonEmpty("symbolPath", symbolPath); err != nil {
		return "", err
	}
	return NodeID(fmt.Sprintf("cls:%s:%s:%s", serviceID, normalizePath(file), symbolPath)), nil
}

// BuildMethodID — class-qualified method id.
func BuildMethodID(classID NodeID, name string) (NodeID, error) {
	if classID.IsEmpty() {
		return "", fmt.Errorf("%w: classID is required", ErrMissingField)
	}
	if err := nonEmpty("name", name); err != nil {
		return "", err
	}
	return NodeID(fmt.Sprintf("mth:%s::%s", classID, name)), nil
}

// BuildDatabaseID returns "db:<svcID>:<name>".
func BuildDatabaseID(serviceID NodeID, name string) (NodeID, error) {
	if serviceID.IsEmpty() {
		return "", fmt.Errorf("%w: serviceID is required", ErrMissingField)
	}
	if err := nonEmpty("name", name); err != nil {
		return "", err
	}
	return NodeID(fmt.Sprintf("db:%s:%s", serviceID, sanitizeSegment(name))), nil
}

// BuildTableID returns "tbl:<dbID>:<schema>:<name>". Schema defaults
// to "public" when empty.
func BuildTableID(databaseID NodeID, schema, name string) (NodeID, error) {
	if databaseID.IsEmpty() {
		return "", fmt.Errorf("%w: databaseID is required", ErrMissingField)
	}
	if err := nonEmpty("name", name); err != nil {
		return "", err
	}
	if strings.TrimSpace(schema) == "" {
		schema = "public"
	}
	return NodeID(fmt.Sprintf("tbl:%s:%s:%s", databaseID, sanitizeSegment(schema), sanitizeSegment(name))), nil
}

// BuildColumnID returns "col:<tableID>:<name>".
func BuildColumnID(tableID NodeID, name string) (NodeID, error) {
	if tableID.IsEmpty() {
		return "", fmt.Errorf("%w: tableID is required", ErrMissingField)
	}
	if err := nonEmpty("name", name); err != nil {
		return "", err
	}
	return NodeID(fmt.Sprintf("col:%s:%s", tableID, sanitizeSegment(name))), nil
}

// BuildOwnerID returns "own:<lowercased handle>".
func BuildOwnerID(handle string) (NodeID, error) {
	if err := nonEmpty("handle", handle); err != nil {
		return "", err
	}
	return NodeID("own:" + sanitizeSegment(strings.ToLower(handle))), nil
}

// BuildShapeID returns "shape:<sha256>" of the canonical bytes.
// Anonymous DTO/shape dedup is achieved by feeding the shape's
// canonical (sorted-keys) JSON encoding here.
func BuildShapeID(canonical []byte) NodeID {
	sum := sha256.Sum256(canonical)
	return NodeID("shape:" + hex.EncodeToString(sum[:]))
}

// BuildASTNodeID returns "<kind>:<parentFnID>:<postorderIdx>". Used
// for AST internals (Call/Return/Throw/Log/FlowControl/...). Not
// stable across rename/move — per-extraction only.
func BuildASTNodeID(parentFnID NodeID, kind string, postorderIdx int) (NodeID, error) {
	if parentFnID.IsEmpty() {
		return "", fmt.Errorf("%w: parentFnID is required", ErrMissingField)
	}
	if err := nonEmpty("kind", kind); err != nil {
		return "", err
	}
	if postorderIdx < 0 {
		return "", fmt.Errorf("%w: postorderIdx must be >= 0", ErrInvalidValue)
	}
	return NodeID(fmt.Sprintf("%s:%s:%d", kind, parentFnID, postorderIdx)), nil
}
