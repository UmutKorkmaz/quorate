// AUTO-GENERATED doc data for the domain packs added beyond the crypto/web3 core.
// Source of truth for heuristic titles/standards lives in @quorate/core (pack-coverage,
// pack-heuristics). Keep titles in sync with that package.

export interface PackDocCouncil {
  role: string;
  description: string;
}

export interface PackDocHeuristic {
  title: string;
  severity: string;
  flags: string;
}

export interface PackDocData {
  id: string;
  label: string;
  standard: string;
  tagline: string;
  lead: string;
  councils: PackDocCouncil[];
  heuristics: PackDocHeuristic[];
}

export const PACK_DOC_DATA: Record<string, PackDocData> = {
  "accessibility": {
    id: "accessibility",
    label: "Accessibility",
    standard: "WCAG 2.2 AA",
    tagline: "Catch missing alt text, unlabelled inputs, keyboard traps, and broken ARIA before they reach users.",
    lead: "The Accessibility pack reviews JSX, HTML, and template markup against WCAG 2.2 AA, focusing on the failures that automated tooling and manual review most often miss in a diff. Its council spans semantic structure, ARIA correctness, keyboard interaction, and perceivable media, with a maintainer role that guards a11y test coverage. Ten deterministic heuristics flag a single problematic line each — an image without alt, a div with onClick but no keyboard handler, a misspelled aria attribute, autoplaying unmuted media, and more. Findings map to specific WCAG 2.2 AA success criteria so reviewers can cite the exact clause.",
    councils: [
      { role: "semantic-structure", description: "native semantics, landmarks, lang, and heading hierarchy" },
      { role: "aria-correctness", description: "valid ARIA attributes and accessible names" },
      { role: "keyboard-interaction", description: "keyboard operability, focus order, and tabindex" },
      { role: "perceivable-media", description: "alt text, form labels, and media controls" },
      { role: "maintainer", description: "a11y test coverage, structure, and maintainability" }
    ],
    heuristics: [
      { title: "Image missing alt attribute", severity: "high", flags: "Flags <img> elements that have no alt attribute at all." },
      { title: "Form input relies on placeholder instead of a label", severity: "high", flags: "Flags text-like inputs that use a placeholder as their only label and carry no ARIA name." },
      { title: "Click handler on non-interactive element without role or keyboard handler", severity: "high", flags: "Flags div/span elements that have an onClick handler but no role attribute." },
      { title: "Anchor with empty or placeholder href used as a button", severity: "medium", flags: "Flags anchors whose href is empty, '#', or 'javascript:void(0)'." },
      { title: "Root <html> element missing lang attribute", severity: "high", flags: "Flags an <html> tag that has no lang attribute." },
      { title: "Positive tabindex value disrupts focus order", severity: "medium", flags: "Flags any tabIndex/tabindex set to a positive integer." },
      { title: "Icon-only button without an accessible name", severity: "high", flags: "Flags a <button> containing only an icon and lacking aria-label, aria-labelledby, or title." },
      { title: "Misspelled or invalid aria-* attribute", severity: "medium", flags: "Flags common misspellings of ARIA attribute names such as aria-labeledby and aria-describ." },
      { title: "Autoplaying media that is not muted", severity: "medium", flags: "Flags <video>/<audio> with autoPlay set but no muted attribute." },
      { title: "Heading level skipped (h1 directly to h3)", severity: "medium", flags: "Flags an <h1> immediately followed by an <h3>-<h6>, skipping <h2>." }
    ]
  },
  "data-sql": {
    id: "data-sql",
    label: "Data & SQL",
    standard: "Data Engineering",
    tagline: "Catches unsafe SQL, unbounded warehouse scans, destructive statements, and data-correctness hazards in pipeline code.",
    lead: "The Data & SQL pack reviews warehouse queries, transformation models, and orchestration code for safety and correctness rather than generic web injection. It targets the failure modes that quietly corrupt or leak data at scale: dynamically assembled SQL, mass UPDATE/DELETE without filters, unbounded scans that blow up cost, destructive DDL without guards, and money stored in lossy floating-point columns. Reviewers focus on whether each statement is bounded, parameterized, transactional, and correct for analytics workloads. Findings map to Data Engineering practice for queries, dbt/SQL models, and Python pipeline code.",
    councils: [
      { role: "query-safety-reviewer", description: "Injection-safe, parameterized, and guarded SQL statements" },
      { role: "warehouse-cost-reviewer", description: "Bounded scans, explicit projections, and no row explosions" },
      { role: "data-correctness-reviewer", description: "Exact-decimal money, transactional writes, and join correctness" },
      { role: "pii-governance-reviewer", description: "No leaked PII or hardcoded credentials in pipeline code" },
      { role: "maintainer", description: "Structure, tests, and maintainability of SQL models and DAGs" }
    ],
    heuristics: [
      { title: "SQL query built by string concatenation or f-string interpolation", severity: "critical", flags: "Flags SQL strings that interpolate a variable through an f-string or string concatenation instead of bind parameters." },
      { title: "SELECT * used in a production query", severity: "medium", flags: "Flags queries that select all columns with SELECT * instead of an explicit column list." },
      { title: "UPDATE or DELETE statement missing a WHERE clause", severity: "critical", flags: "Flags UPDATE or DELETE statements that have no WHERE clause and therefore affect every row." },
      { title: "Unbounded query missing a LIMIT clause", severity: "high", flags: "Flags ORDER BY queries that lack a LIMIT clause, risking unbounded result sets." },
      { title: "DROP or TRUNCATE TABLE without an existence or environment guard", severity: "critical", flags: "Flags DROP TABLE or TRUNCATE TABLE statements that lack an IF EXISTS guard." },
      { title: "Hardcoded database connection string or DSN", severity: "critical", flags: "Flags database connection strings that embed inline credentials directly in source code." },
      { title: "PII column selected into logs or printed output", severity: "high", flags: "Flags log or print statements that emit a PII column such as email, SSN, phone, or card number." },
      { title: "Cartesian or cross join that explodes row counts", severity: "high", flags: "Flags CROSS JOIN usage that produces a cartesian product across two tables." },
      { title: "Multiple dependent writes executed without a transaction", severity: "high", flags: "Flags execute calls performed with autocommit enabled instead of an explicit transaction." },
      { title: "FLOAT or REAL used for a monetary column", severity: "high", flags: "Flags column definitions where a monetary field is typed as FLOAT, REAL, or DOUBLE instead of DECIMAL/NUMERIC." }
    ]
  },
  "k8s": {
    id: "k8s",
    label: "Kubernetes",
    standard: "CIS Kubernetes",
    tagline: "Hardens Kubernetes workload manifests against privilege, isolation, RBAC, and resource-exhaustion risks per the CIS Kubernetes Benchmark.",
    lead: "This pack reviews Kubernetes workload manifests — Deployments, Pods, Roles, and NetworkPolicies — for security misconfigurations that weaken pod isolation, grant excessive privileges, or expose the host. Reviewers map each finding to a specific CIS Kubernetes Benchmark control covering pod security context, capabilities, host namespaces, RBAC scoping, and resource governance. The scope is the declarative manifest surface only; cloud and Terraform provisioning is handled by the separate IaC pack. The goal is to catch privilege-escalation and isolation-breaking defaults before they reach a live cluster.",
    councils: [
      { role: "pod-security-context-reviewer", description: "Privilege, root execution, and capability hardening in securityContext" },
      { role: "host-isolation-reviewer", description: "Host namespace, hostPath, and service-account token exposure" },
      { role: "rbac-scope-reviewer", description: "Least-privilege Role/ClusterRole rule scoping" },
      { role: "resource-governance-reviewer", description: "CPU/memory limits and resource-exhaustion guards" },
      { role: "maintainer", description: "Manifest structure, image pinning, and policy-test coverage" }
    ],
    heuristics: [
      { title: "Privileged container in securityContext", severity: "critical", flags: "Flags containers granted full host privilege via privileged:true." },
      { title: "Container allowed to run as root", severity: "high", flags: "Flags securityContext that explicitly permits running as root via runAsNonRoot:false." },
      { title: "Container runs as UID 0 (root)", severity: "high", flags: "Flags securityContext pinning the process to UID 0 via runAsUser:0." },
      { title: "Pod container allows privilege escalation", severity: "high", flags: "Flags containers permitting privilege escalation via allowPrivilegeEscalation:true." },
      { title: "Host namespace sharing enabled", severity: "critical", flags: "Flags pods sharing the host network, PID, or IPC namespace." },
      { title: "Dangerous Linux capability added", severity: "critical", flags: "Flags capabilities.add entries granting SYS_ADMIN, NET_ADMIN, or NET_RAW." },
      { title: "Container missing resource limits", severity: "medium", flags: "Flags a resources block that declares requests without a corresponding limits block." },
      { title: "Mutable :latest image tag", severity: "medium", flags: "Flags container image references that use the mutable :latest tag." },
      { title: "Service account token automounted", severity: "high", flags: "Flags pods or service accounts that automount the API token via automountServiceAccountToken:true." },
      { title: "RBAC rule grants wildcard access", severity: "high", flags: "Flags Role/ClusterRole rules whose verbs, resources, or apiGroups use a wildcard '*'." }
    ]
  },
  "privacy": {
    id: "privacy",
    label: "Privacy / GDPR",
    standard: "GDPR / CCPA",
    tagline: "Reviews the personal-data lifecycle — consent, retention, erasure, and cross-border transfer — against GDPR and CCPA.",
    lead: "The Privacy pack reviews how code handles personal data across its full lifecycle: lawful collection, consent gating, minimisation, retention limits, erasure, and third-party or cross-border transfer. It is horizontal — it applies to any product that processes personal data, regardless of language or framework. It deliberately stays clear of the healthcare (HIPAA/PHI) and fintech (PCI/cardholder) verticals, focusing instead on the general data-protection obligations that GDPR and CCPA impose on every controller and processor.",
    councils: [
      { role: "consent-lawful-basis", description: "Consent gating, lawful basis, and notice before collection" },
      { role: "data-minimization", description: "Minimisation, PII in logs/URLs, and anonymisation before secondary use" },
      { role: "retention-erasure", description: "Retention limits, TTLs, and a real right-to-erasure path" },
      { role: "transfer-sharing", description: "Third-party sharing and cross-border transfer safeguards" },
      { role: "maintainer", description: "Structure, tests, and auditability of privacy controls" }
    ],
    heuristics: [
      { title: "PII written to logs", severity: "high", flags: "Flags console/logger/print calls that emit personal identifiers such as email, phone, name, SSN, or IP address." },
      { title: "Analytics fired before consent", severity: "high", flags: "Flags analytics SDK track/page/identify/event calls that are not gated behind a consent check." },
      { title: "PII stored without retention/TTL", severity: "medium", flags: "Flags schema/index/column definitions that persist PII fields with no accompanying retention or TTL." },
      { title: "PII in URL/query string", severity: "medium", flags: "Flags URLs that carry personal identifiers such as email, ssn, phone, dob, or password as query parameters." },
      { title: "PII shared with third party without contract flag", severity: "high", flags: "Flags outbound HTTP/SDK calls to third-party services that include user email, phone, SSN, or full name in the payload." },
      { title: "Soft-delete used instead of right-to-erasure", severity: "high", flags: "Flags update calls on user/account records that set an isDeleted/deactivated flag instead of performing real erasure." },
      { title: "Cookie set without consent gating", severity: "high", flags: "Flags document.cookie / res.cookie / cookies.set writes on lines that contain no consent or essential-cookie qualifier." },
      { title: "Precise geolocation captured without notice", severity: "medium", flags: "Flags high-accuracy geolocation APIs (getCurrentPosition, watchPosition, CLLocationManager, FusedLocationProvider)." },
      { title: "Full PII table dumped", severity: "high", flags: "Flags SELECT * FROM users/customers and bulk exportAllUsers/dumpTable operations over personal-data tables." },
      { title: "PII sent to analytics/ML without anonymisation", severity: "high", flags: "Flags warehouse/ML insert or training calls that pass raw email, SSN, full name, or personalData fields." }
    ]
  },
  "mlops": {
    id: "mlops",
    label: "ML / MLOps",
    standard: "ML Supply Chain",
    tagline: "Guards ML pipelines against untrusted artifacts, data leakage, and non-reproducible training.",
    lead: "The ML / MLOps pack reviews Python training pipelines, datasets, and model artifacts for supply-chain and lifecycle safety. It focuses on the risks unique to machine learning: deserializing untrusted model weights, data and target leakage that inflate offline metrics, non-reproducible runs, and unpinned artifacts pulled from public hubs. It deliberately excludes LLM prompt, agent, and application-layer concerns, which are owned by the dedicated \"llm\" pack. Findings map to ML Supply Chain controls so reviewers can reason about provenance, reproducibility, and evaluation integrity.",
    councils: [
      { role: "artifact-provenance", description: "Untrusted artifact deserialization and unpinned hub downloads" },
      { role: "data-leakage", description: "Train/test contamination and target leakage in features" },
      { role: "reproducibility", description: "Seeding, splits, and version pinning for reproducible runs" },
      { role: "pipeline-security", description: "Unsafe config loading and hardcoded pipeline credentials" },
      { role: "maintainer", description: "Pipeline structure, tests, and maintainability" }
    ],
    heuristics: [
      { title: "Untrusted model artifact deserialized via pickle/torch/joblib load", severity: "critical", flags: "Flags deserialization of model artifacts through pickle.load, torch.load, or joblib.load." },
      { title: "torch.load called without weights_only=True", severity: "high", flags: "Flags torch.load invocations that do not set weights_only=True." },
      { title: "No random seed set — training is non-reproducible", severity: "medium", flags: "Flags scikit-learn estimators or splits constructed without a random_state argument." },
      { title: "Data leakage — scaler/transform fit before train-test split", severity: "high", flags: "Flags scaler or transformer fit_transform applied to the whole feature matrix before splitting." },
      { title: "Hardcoded dataset/registry/storage credentials", severity: "critical", flags: "Flags hardcoded AWS keys, MLflow tokens, or hub tokens assigned as string literals." },
      { title: "Unsafe yaml.load for experiment/pipeline config", severity: "high", flags: "Flags yaml.load calls that do not use a safe loader." },
      { title: "Unpinned model/dataset download from hub", severity: "high", flags: "Flags hub download calls (from_pretrained, load_dataset, hf_hub_download) that omit a revision pin." },
      { title: "Model trained on full dataset with no train/test split", severity: "medium", flags: "Flags estimator.fit called directly on the full X, y feature matrix." },
      { title: "eval/exec on experiment config or hyperparameters", severity: "critical", flags: "Flags eval or exec applied to config or params values." },
      { title: "Target/identifier leakage column kept in training features", severity: "high", flags: "Flags assigning the feature matrix to the full dataframe without dropping the target column." }
    ]
  },
  "embedded": {
    id: "embedded",
    label: "Embedded / MISRA",
    standard: "MISRA C/C++",
    tagline: "Catches firmware memory-safety, MISRA-discipline, and real-time hazards in C/C++ before they reach the device.",
    lead: "The Embedded / MISRA pack reviews C and C++ firmware for the failure modes that brick devices and leak memory in the field: unbounded string operations, unchecked allocations and copies, missing volatile qualifiers on hardware-mapped state, and real-time anti-patterns such as dynamic allocation in interrupt context. Findings map to MISRA C and MISRA C++ rules so that flagged lines tie back to an auditable coding standard. The council pairs deterministic regex heuristics over the diff with focused reviewer roles spanning memory safety, MISRA conformance, concurrency/ISR correctness, real-time timing, and overall maintainability.",
    councils: [
      { role: "memory-safety", description: "Buffer, allocation, and pointer spatial/temporal safety" },
      { role: "misra-conformance", description: "MISRA C/C++ rule discipline on every changed line" },
      { role: "concurrency-isr", description: "Volatile, atomicity, and ISR-shared state correctness" },
      { role: "realtime-timing", description: "Deterministic timing and real-time path hazards" },
      { role: "maintainer", description: "Structure, tests, error handling, and maintainability" }
    ],
    heuristics: [
      { title: "Unbounded string operation (strcpy/strcat/sprintf/gets)", severity: "critical", flags: "Flags calls to unbounded string functions (strcpy, strcat, sprintf, gets) that cannot enforce a destination buffer bound." },
      { title: "Allocation result used without NULL check", severity: "high", flags: "Flags an assignment from malloc/calloc/realloc, prompting verification that the returned pointer is NULL-checked before use." },
      { title: "memcpy/memmove with an unchecked length", severity: "high", flags: "Flags memcpy/memmove calls so reviewers confirm the length argument is bounded by the destination buffer size." },
      { title: "Magic buffer-size literal in array declaration", severity: "medium", flags: "Flags fixed-size char/uint arrays declared with a bare numeric literal instead of a named size constant." },
      { title: "Hardware-register/ISR-shared variable missing volatile", severity: "high", flags: "Flags a pointer cast to a fixed hardware address (0x...) that lacks a volatile qualifier on the pointed-to type." },
      { title: "Signed/unsigned comparison mismatch in loop bound", severity: "medium", flags: "Flags a for-loop using a signed int counter compared against an unsigned size/len/count/num bound." },
      { title: "Use of goto", severity: "low", flags: "Flags any use of the goto statement, which MISRA restricts in favour of structured control flow." },
      { title: "Dynamic allocation via new on a real-time/ISR path", severity: "high", flags: "Flags use of the C++ new operator, which introduces non-deterministic heap allocation forbidden on real-time and ISR paths." },
      { title: "Ignored return value of a system/library call", severity: "medium", flags: "Flags a statement-level call to a fallible I/O/HAL/system function whose return value is not assigned or checked." },
      { title: "Floating-point equality comparison", severity: "medium", flags: "Flags == comparisons against a floating-point literal, which are unreliable due to rounding error." }
    ]
  },
  "performance": {
    id: "performance",
    label: "Performance / SRE",
    standard: "Performance & SRE",
    tagline: "Latency-, resource- and reliability-aware council for hot paths, request handlers and data access.",
    lead: "The Performance / SRE pack reviews diffs for changes that measurably degrade latency, throughput, resource efficiency or reliability. It targets serial I/O in loops, N+1 query patterns, unbounded result sets, blocking calls in request handlers, missing network timeouts, per-request connection churn, unbounded memory growth and leaked timers or listeners. Findings map to Performance & SRE practice rather than generic style: every flagged line has a plausible runtime cost under load. The council favours batching, pagination, pooling, bounded buffers, explicit timeouts and deterministic cleanup.",
    councils: [
      { role: "latency-io", description: "Serial I/O, await-in-loop and blocking calls on hot paths" },
      { role: "data-access-scaling", description: "N+1 queries and unbounded list/collection fetches" },
      { role: "resource-lifecycle", description: "Connection pooling, bounded memory and timer/listener cleanup" },
      { role: "reliability-timeouts", description: "Network timeouts and quadratic-scan blast radius" },
      { role: "maintainer", description: "Structure, load tests, observability and tunable constants" }
    ],
    heuristics: [
      { title: "await inside a loop (serialized I/O)", severity: "high", flags: "Flags an await expression used directly inside a for or while loop, forcing sequential round-trips." },
      { title: "Database query inside a loop (N+1)", severity: "high", flags: "Flags an ORM/DB call (findOne, findById, query, execute, aggregate) issued from inside a loop or map/forEach." },
      { title: "List endpoint missing pagination/LIMIT", severity: "high", flags: "Flags argument-less findAll/find/findMany calls and SELECT statements that have no LIMIT clause." },
      { title: "Synchronous fs call in a request path", severity: "high", flags: "Flags synchronous filesystem calls such as readFileSync, existsSync, writeFileSync or statSync." },
      { title: "Outbound fetch/axios without a timeout", severity: "high", flags: "Flags fetch or axios calls whose argument list contains no signal, timeout, AbortController or AbortSignal." },
      { title: "New DB connection per request (no pool)", severity: "high", flags: "Flags per-request construction of a DB client/connection (new Client, createConnection, mongoose.connect, new MongoClient)." },
      { title: "Unbounded in-memory accumulator growth", severity: "medium", flags: "Flags push/unshift/concat onto accumulator-style names (cache, store, buffer, results, history) with no apparent bound." },
      { title: "JSON.parse of an unbounded request body", severity: "medium", flags: "Flags JSON.parse applied directly to a request, response, body or stream value with no size guard." },
      { title: "O(n^2) nested includes/indexOf scan", severity: "medium", flags: "Flags an array .includes/.indexOf/.find/.some call nested inside a filter/map/forEach/some callback." },
      { title: "setInterval without cleanup handle (leak)", severity: "medium", flags: "Flags a setInterval call whose return value is not assigned, leaving no handle to clear the timer." }
    ]
  },
  "graphql": {
    id: "graphql",
    label: "GraphQL API",
    standard: "GraphQL Security",
    tagline: "Catches GraphQL-specific schema, resolver, and query-execution risks before they reach production.",
    lead: "The GraphQL pack reviews schemas, resolvers, and server configuration for the failure modes unique to GraphQL APIs: query-execution denial of service, missing per-field authorization, and resolver data-access patterns. It focuses on threats that arise from the flexible, client-driven nature of GraphQL — deeply nested queries, alias and batch amplification, unbounded list selections, and introspection exposure — rather than the generic injection and XSS classes covered by the web pack. Each council role brings a focused lens on one slice of the GraphQL attack surface, and ten deterministic heuristics flag the most common vulnerable single-line patterns in a diff.",
    councils: [
      { role: "query-execution", description: "DoS guards: depth, complexity, batching, introspection" },
      { role: "resolver-authorization", description: "Per-field and per-object authz in resolvers" },
      { role: "schema-design", description: "Pagination bounds, rate limits, safe error shaping" },
      { role: "data-access", description: "N+1 batching and parameterized resolver queries" },
      { role: "maintainer", description: "Schema structure, resolver tests, maintainability" }
    ],
    heuristics: [
      { title: "GraphQL introspection enabled in production", severity: "high", flags: "Flags a GraphQL server configured with introspection: true, exposing the full schema in production." },
      { title: "Missing query depth/complexity limit", severity: "high", flags: "Flags an Apollo/GraphQL server whose validationRules array is empty, applying no depth or complexity limit." },
      { title: "List resolver causes N+1 queries (no DataLoader)", severity: "medium", flags: "Flags a GraphQL field resolver that calls findAll/findMany directly instead of batching via a DataLoader." },
      { title: "Privileged resolver missing object/field-level authorization", severity: "critical", flags: "Flags a privileged GraphQL resolver declared with no context argument, so it cannot authorize the caller." },
      { title: "Query batching amplification enabled", severity: "high", flags: "Flags a GraphQL server that enables allowBatchedHttpRequests, permitting request batching amplification." },
      { title: "Raw database query built from GraphQL args", severity: "critical", flags: "Flags a database query in a resolver built by interpolating GraphQL args or input into the query string." },
      { title: "Verbose GraphQL error leaks internals", severity: "medium", flags: "Flags a formatError implementation that returns stack traces or internal exception details to clients." },
      { title: "Mutation type without rate-limit directive", severity: "medium", flags: "Flags a GraphQL Mutation type declaration so reviewers confirm its fields carry rate-limiting." },
      { title: "Unbounded list pagination argument", severity: "medium", flags: "Flags a list field whose pagination argument is an Int with no default value, allowing unbounded page sizes." },
      { title: "@skip/@include used to bypass auth-protected field", severity: "high", flags: "Flags an @skip or @include directive whose condition variable controls an auth-protected field." }
    ]
  }
};
