package shared

// NodeKind is the discriminant of every first-class node in the gaia
// knowledge graph. It is persisted alongside the polymorphic id so
// that a generic edge query can resolve the concrete node table.
type NodeKind string

const (
	KindService       NodeKind = "service"
	KindEndpoint      NodeKind = "endpoint"
	KindFunction      NodeKind = "function"
	KindClass         NodeKind = "class"
	KindMethod        NodeKind = "method"
	KindDatabase      NodeKind = "database"
	KindTable         NodeKind = "table"
	KindColumn        NodeKind = "column"
	KindExternalCall  NodeKind = "external_call"
	KindMiddleware    NodeKind = "middleware"
	KindOwner         NodeKind = "owner"
	KindProcess       NodeKind = "process"
	KindDbProcess     NodeKind = "db_process"
	KindEvent         NodeKind = "event"
	KindTelemetry     NodeKind = "telemetry"
	KindResolvedShape NodeKind = "resolved_shape"
	KindConditionExpr NodeKind = "condition_expr"
	KindCall          NodeKind = "call"
	KindReturn        NodeKind = "return"
	KindThrow         NodeKind = "throw"
	KindLog           NodeKind = "log"
	KindFlowControl   NodeKind = "flow_control"
)
