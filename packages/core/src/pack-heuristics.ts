import type { Severity } from "./types.js";

/**
 * Declarative pack heuristic rule. Each rule flags a single problematic added
 * diff line for a domain pack. Kept isolated from the hand-written checks in
 * heuristics.ts so domain packs can grow as a data table, not as code branches.
 */
export interface PackHeuristicRule {
  packId: string;
  title: string;
  severity: Severity;
  body: string;
  /** Restrict to files whose extension matches; null applies to any file. */
  fileRe: RegExp | null;
  /** Match against the added line text. Compiled without the global flag. */
  textRe: RegExp;
}

interface RawPackHeuristicRule {
  packId: string;
  title: string;
  severity: Severity;
  body: string;
  fileExts: string[];
  regexSource: string;
  regexFlags: string;
}

const RAW_PACK_HEURISTIC_RULES: RawPackHeuristicRule[] = [
  {
    "packId": "graphql",
    "title": "GraphQL introspection enabled in production",
    "severity": "high",
    "body": "introspection: true exposes the full schema to any client, handing attackers a complete map of types, fields, and mutations. Gate introspection on a non-production environment check instead of hardcoding true.",
    "fileExts": [
      "ts",
      "js",
      "tsx",
      "jsx"
    ],
    "regexSource": "introspection\\s*:\\s*true",
    "regexFlags": "i"
  },
  {
    "packId": "graphql",
    "title": "Missing query depth/complexity limit",
    "severity": "high",
    "body": "An empty validationRules array means no depth or complexity rule runs, so a deeply nested or expensive query can exhaust server resources. Add depthLimit and a cost/complexity rule before execution.",
    "fileExts": [
      "ts",
      "js",
      "tsx",
      "jsx"
    ],
    "regexSource": "validationRules\\s*:\\s*\\[\\s*\\]",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "List resolver causes N+1 queries (no DataLoader)",
    "severity": "medium",
    "body": "A nested-field resolver that calls findAll/findMany directly fires one database query per parent node, producing an N+1 explosion. Batch the lookups through a DataLoader keyed by the parent id instead.",
    "fileExts": [
      "ts",
      "js"
    ],
    "regexSource": "\\w+\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*(?:await\\s+)?\\w+\\.find(?:All|Many)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "Privileged resolver missing object/field-level authorization",
    "severity": "critical",
    "body": "A sensitive mutation resolver (deleteUser, setRole, grantAdmin) defined with only (parent, args) and no context argument cannot perform a caller authorization check, so any authenticated client can invoke it. Add the context parameter and enforce an explicit permission check before mutating.",
    "fileExts": [
      "ts",
      "js"
    ],
    "regexSource": "\\b(?:deleteUser|removeUser|setRole|grantAdmin|allUsers)\\s*:\\s*(?:async\\s*)?\\(\\s*\\w+\\s*,\\s*\\{[^}]*\\}\\s*\\)\\s*=>",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "Query batching amplification enabled",
    "severity": "high",
    "body": "allowBatchedHttpRequests: true lets a client pack many operations into one HTTP request, multiplying load and bypassing per-request rate limits (a common credential-stuffing and DoS vector). Disable batching or pair it with per-operation cost accounting.",
    "fileExts": [
      "ts",
      "js"
    ],
    "regexSource": "allowBatchedHttpRequests\\s*:\\s*true",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "Raw database query built from GraphQL args",
    "severity": "critical",
    "body": "Interpolating GraphQL args/input directly into a database query string allows injection through resolver arguments. Use parameterized queries and pass the argument as a bound value instead of string interpolation.",
    "fileExts": [
      "ts",
      "js"
    ],
    "regexSource": "\\.(?:query|raw|execute|aggregate)\\s*\\(\\s*[`\"'][^`\"']*\\$\\{\\s*(?:args|input)\\.",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "Verbose GraphQL error leaks internals",
    "severity": "medium",
    "body": "Returning error.stack, the originalError, or exception stacktrace details through formatError exposes internal paths, library versions, and query structure to clients. Map errors to safe client-facing messages and log the detail server-side only.",
    "fileExts": [
      "ts",
      "js"
    ],
    "regexSource": "formatError[^\\n]*(?:error\\.stack|err\\.stack|\\.originalError|exception\\.stacktrace)",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "Mutation type without rate-limit directive",
    "severity": "medium",
    "body": "Mutations are state-changing and abuse-prone, yet a Mutation type block frequently ships without any @rateLimit directive or throttling on its fields. Confirm mutations carry a rate-limit directive or are throttled by middleware to prevent brute-force and resource-exhaustion abuse.",
    "fileExts": [
      "graphql",
      "gql"
    ],
    "regexSource": "type\\s+Mutation\\s*\\{",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "Unbounded list pagination argument",
    "severity": "medium",
    "body": "A pagination argument (first, last, limit, take) typed as Int with no default lets a client request an arbitrarily large page, enabling resource exhaustion. Give the argument a sensible default and enforce a server-side maximum.",
    "fileExts": [
      "graphql",
      "gql"
    ],
    "regexSource": "\\b(?:first|last|limit|take)\\s*:\\s*Int\\b(?!\\s*=)",
    "regexFlags": ""
  },
  {
    "packId": "graphql",
    "title": "@skip/@include used to bypass auth-protected field",
    "severity": "high",
    "body": "Applying @skip or @include with an auth-related condition variable conditionally drops an authorization-gated field from execution, letting a client toggle the check off. Authorization must be enforced inside the resolver, never expressed as a skippable directive condition.",
    "fileExts": [
      "graphql",
      "gql"
    ],
    "regexSource": "@(?:skip|include)\\s*\\(\\s*if\\s*:\\s*\\$\\w*(?:auth|admin|login|role|perm)",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Privileged container in securityContext",
    "severity": "critical",
    "body": "A container running with privileged:true gains nearly all host kernel capabilities and device access, effectively escaping the container boundary. Remove privileged:true and grant only the specific capabilities the workload needs.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*privileged:\\s*true\\b",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Container allowed to run as root",
    "severity": "high",
    "body": "Setting runAsNonRoot:false (or omitting it with runAsUser:0) lets the container run as UID 0, so any breakout has root on the node. Set runAsNonRoot:true and run as a dedicated non-zero UID.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*runAsNonRoot:\\s*false\\b",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Container runs as UID 0 (root)",
    "severity": "high",
    "body": "runAsUser:0 forces the process to execute as root inside the container, defeating user-namespace isolation benefits. Set runAsUser to a non-zero, non-system UID such as 1000.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*runAsUser:\\s*0\\b",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Pod container allows privilege escalation",
    "severity": "high",
    "body": "allowPrivilegeEscalation:true lets a process gain more privileges than its parent (e.g. via setuid binaries), undermining capability dropping. Set allowPrivilegeEscalation:false on every container.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*allowPrivilegeEscalation:\\s*true\\b",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Host namespace sharing enabled",
    "severity": "critical",
    "body": "Setting hostNetwork, hostPID, or hostIPC to true joins the pod to the node's namespaces, exposing host processes, network, and IPC to the container. Remove these fields so the pod stays isolated.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*host(Network|PID|IPC):\\s*true\\b",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Dangerous Linux capability added",
    "severity": "critical",
    "body": "Adding SYS_ADMIN, NET_ADMIN, or NET_RAW grants powerful host-level kernel privileges that enable container escape or network tampering. Drop ALL capabilities and add back only the minimal, audited set the workload requires.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*-\\s*[\"']?(SYS_ADMIN|NET_ADMIN|NET_RAW)[\"']?\\s*$",
    "regexFlags": ""
  },
  {
    "packId": "k8s",
    "title": "Container missing resource limits",
    "severity": "medium",
    "body": "A container with requests but no limits can consume unbounded CPU or memory and cause node-wide resource exhaustion. Add resources.limits for both cpu and memory.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*resources:\\s*\\{\\s*\\}\\s*$",
    "regexFlags": ""
  },
  {
    "packId": "k8s",
    "title": "Mutable :latest image tag",
    "severity": "medium",
    "body": "Using the :latest tag makes deployments non-reproducible and can silently pull an unverified or compromised image. Pin to an explicit immutable version tag or, preferably, a sha256 digest.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*image:\\s*\\S+:latest\\s*$",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "Service account token automounted",
    "severity": "high",
    "body": "automountServiceAccountToken:true mounts a usable API credential into the pod even when the workload never calls the Kubernetes API, widening the blast radius of a compromise. Set it to false unless the workload genuinely needs API access.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*automountServiceAccountToken:\\s*true\\b",
    "regexFlags": "i"
  },
  {
    "packId": "k8s",
    "title": "RBAC rule grants wildcard access",
    "severity": "high",
    "body": "A wildcard '*' in verbs, resources, or apiGroups grants sweeping authority and violates least privilege, effectively giving the subject cluster-admin-like power over the scoped objects. Replace the wildcard with the explicit verbs and resources the role actually needs.",
    "fileExts": [
      "yaml",
      "yml"
    ],
    "regexSource": "^\\s*(verbs|resources|apiGroups):\\s*\\[\\s*[\"']\\*[\"']\\s*\\]",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "Untrusted model artifact deserialized via pickle/torch/joblib load",
    "severity": "critical",
    "body": "pickle.load, torch.load, and joblib.load execute arbitrary code embedded in the artifact, so loading an untrusted checkpoint is remote code execution. Load only verified artifacts (use weights_only=True for torch, safetensors, or a checksum gate).",
    "fileExts": [
      "py"
    ],
    "regexSource": "\\b(?:pickle|joblib|torch)\\.load\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "torch.load called without weights_only=True",
    "severity": "high",
    "body": "torch.load without weights_only=True unpickles arbitrary objects and can execute attacker code from a tampered checkpoint. Pass weights_only=True (or use safetensors) when loading state dicts.",
    "fileExts": [
      "py"
    ],
    "regexSource": "torch\\.load\\s*\\((?![^)]*weights_only\\s*=\\s*True)",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "No random seed set — training is non-reproducible",
    "severity": "medium",
    "body": "An estimator constructed without random_state (or a missing global seed) yields non-reproducible runs and untrustworthy comparisons. Pass random_state / set seed_everything so results can be reproduced.",
    "fileExts": [
      "py"
    ],
    "regexSource": "(?:RandomForest\\w+|train_test_split|KFold|GradientBoosting\\w+)\\s*\\((?![^)]*random_state)",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "Data leakage — scaler/transform fit before train-test split",
    "severity": "high",
    "body": "Calling fit_transform on the full feature matrix X before splitting leaks test-set statistics into training and inflates offline metrics. Fit the transform inside a Pipeline or only on the training fold.",
    "fileExts": [
      "py"
    ],
    "regexSource": "\\.fit_transform\\s*\\(\\s*X\\s*\\)",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "Hardcoded dataset/registry/storage credentials",
    "severity": "critical",
    "body": "Hardcoding tokens for dataset stores, model registries, or object storage exposes the ML supply chain if the secret leaks. Load credentials from environment variables or a secret manager instead.",
    "fileExts": [
      "py"
    ],
    "regexSource": "(?:aws_secret_access_key|MLFLOW_TRACKING_TOKEN|HF_TOKEN|hf_api_token)\\s*[:=]\\s*[\"'][^\"']+[\"']",
    "regexFlags": "i"
  },
  {
    "packId": "mlops",
    "title": "Unsafe yaml.load for experiment/pipeline config",
    "severity": "high",
    "body": "yaml.load without SafeLoader can instantiate arbitrary Python objects, so a tampered config file becomes code execution in the pipeline. Use yaml.safe_load or pass Loader=SafeLoader.",
    "fileExts": [
      "py"
    ],
    "regexSource": "yaml\\.load\\s*\\((?![^)]*(?:Safe|safe_load))",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "Unpinned model/dataset download from hub",
    "severity": "high",
    "body": "from_pretrained / load_dataset / hf_hub_download without a revision (or pinned commit) silently pulls whatever the hub serves now, allowing a poisoned update to enter the pipeline. Pin the revision to a commit hash or tag.",
    "fileExts": [
      "py"
    ],
    "regexSource": "(?:from_pretrained|load_dataset|hf_hub_download)\\s*\\((?![^)]*revision)",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "Model trained on full dataset with no train/test split",
    "severity": "medium",
    "body": "Calling fit on the entire X, y with no held-out split leaves no honest way to evaluate generalization and risks training on the evaluation data. Split off a test/validation set before fitting.",
    "fileExts": [
      "py"
    ],
    "regexSource": "\\.fit\\s*\\(\\s*X\\s*,\\s*y\\s*\\)",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "eval/exec on experiment config or hyperparameters",
    "severity": "critical",
    "body": "Passing config or hyperparameter strings to eval/exec lets a tampered config run arbitrary code in the training process. Parse values with ast.literal_eval or a typed schema instead.",
    "fileExts": [
      "py"
    ],
    "regexSource": "\\b(?:eval|exec)\\s*\\(\\s*(?:cfg|config|params|hyperparams)\\b",
    "regexFlags": ""
  },
  {
    "packId": "mlops",
    "title": "Target/identifier leakage column kept in training features",
    "severity": "high",
    "body": "Assigning the feature matrix directly from the full dataframe (X = df) leaves the target and identifier columns in the inputs, leaking the label into training. Drop the target and known leakage columns before fitting.",
    "fileExts": [
      "py"
    ],
    "regexSource": "^\\s*X\\s*=\\s*df\\s*$",
    "regexFlags": ""
  },
  {
    "packId": "data-sql",
    "title": "SQL query built by string concatenation or f-string interpolation",
    "severity": "critical",
    "body": "A SQL statement is assembled by interpolating a runtime variable via f-string or concatenation, allowing injection and breaking query plan caching. Use parameterized queries with bind parameters (e.g. cursor.execute(sql, params)) instead.",
    "fileExts": [
      "py",
      "sql"
    ],
    "regexSource": "(execute|query|sql)\\s*[=(]\\s*f[\"'].*\\b(SELECT|INSERT|UPDATE|DELETE)\\b.*\\{[a-zA-Z_]",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "SELECT * used in a production query",
    "severity": "medium",
    "body": "SELECT * pulls every column, scanning unnecessary data on columnar warehouses and breaking when schemas evolve. Project only the columns the query actually needs.",
    "fileExts": [
      "sql",
      "py"
    ],
    "regexSource": "\\bSELECT\\s+\\*\\s+FROM\\b",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "UPDATE or DELETE statement missing a WHERE clause",
    "severity": "critical",
    "body": "An UPDATE or DELETE without a WHERE clause rewrites or removes every row in the table. Add an explicit WHERE predicate scoping the statement to the intended rows.",
    "fileExts": [
      "sql",
      "py"
    ],
    "regexSource": "\\b(UPDATE\\s+[\\w.\"`]+\\s+SET\\b|DELETE\\s+FROM\\s+[\\w.\"`]+)(?!.*\\bWHERE\\b).*$",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "Unbounded query missing a LIMIT clause",
    "severity": "high",
    "body": "An ad-hoc or ORDER BY query without a LIMIT can return or scan an unbounded result set, inflating warehouse cost and memory. Add a LIMIT to bound the rows returned for exploratory or preview queries.",
    "fileExts": [
      "sql",
      "py"
    ],
    "regexSource": "\\bORDER\\s+BY\\b(?!.*\\bLIMIT\\b).*$",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "DROP or TRUNCATE TABLE without an existence or environment guard",
    "severity": "critical",
    "body": "A bare DROP TABLE or TRUNCATE TABLE permanently destroys data with no IF EXISTS guard or environment check. Guard destructive DDL with IF EXISTS and restrict it to non-production environments.",
    "fileExts": [
      "sql",
      "py"
    ],
    "regexSource": "\\b(DROP\\s+TABLE|TRUNCATE\\s+TABLE)\\s+(?!IF\\s+EXISTS)[\\w.\"`]+",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "Hardcoded database connection string or DSN",
    "severity": "critical",
    "body": "A connection string with an embedded username and password is hardcoded in source, exposing warehouse credentials in version control. Load DSNs and passwords from environment variables or a secret manager.",
    "fileExts": [
      "py",
      "sql",
      "yml",
      "yaml"
    ],
    "regexSource": "(postgres(ql)?|mysql|snowflake|redshift|bigquery|jdbc):\\/\\/[^\\s:'\"]+:[^@\\s'\"]+@",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "PII column selected into logs or printed output",
    "severity": "high",
    "body": "A sensitive column (email, SSN, phone, card number) is written to a log or print statement, leaking PII into observability sinks. Mask or omit PII before logging, or log a non-sensitive identifier instead.",
    "fileExts": [
      "py"
    ],
    "regexSource": "(log(ger)?\\.\\w+|print)\\s*\\(.*\\b(ssn|email|phone_number|credit_card|card_number|tax_id)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "Cartesian or cross join that explodes row counts",
    "severity": "high",
    "body": "A CROSS JOIN (or comma-join without an ON predicate) produces a cartesian product, multiplying row counts and corrupting aggregates. Replace with an explicit JOIN ... ON keyed on the relationship between tables.",
    "fileExts": [
      "sql",
      "py"
    ],
    "regexSource": "\\bCROSS\\s+JOIN\\b",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "Multiple dependent writes executed without a transaction",
    "severity": "high",
    "body": "An autocommit write is performed where multiple dependent statements should be atomic, so a partial failure leaves inconsistent data. Wrap dependent writes in a single transaction (BEGIN/COMMIT or a context-managed connection).",
    "fileExts": [
      "py"
    ],
    "regexSource": "\\.(execute|executemany)\\s*\\(.*\\)\\s*;?\\s*#?.*\\bautocommit\\b|set_session\\s*\\(\\s*autocommit\\s*=\\s*True",
    "regexFlags": "i"
  },
  {
    "packId": "data-sql",
    "title": "FLOAT or REAL used for a monetary column",
    "severity": "high",
    "body": "A money, price, amount, or balance column is declared as FLOAT, REAL, or DOUBLE, which introduces binary rounding error in financial values. Use DECIMAL or NUMERIC with explicit precision and scale for monetary columns.",
    "fileExts": [
      "sql",
      "py"
    ],
    "regexSource": "\\b\\w*(amount|price|balance|cost|total|salary|revenue)\\w*\\s+(FLOAT|REAL|DOUBLE(\\s+PRECISION)?)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "PII written to logs",
    "severity": "high",
    "body": "Personal data (email, phone, name, SSN, IP address) is being written to a log or console line. Logs are widely replicated and long-retained; remove the PII and log a non-identifying surrogate key instead.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "py",
      "java",
      "rb",
      "go"
    ],
    "regexSource": "(console\\.(?:log|info|debug|warn|error)|logger\\.\\w+|print)\\s*\\([^)]*\\b(?:email|phone|firstName|lastName|fullName|ssn|ipAddress|userEmail|user\\.email)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "Analytics fired before consent",
    "severity": "high",
    "body": "An analytics/tracking event is dispatched without first checking that the user has granted consent. Gate all track/page/identify calls behind a recorded opt-in consent state.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\b(?:analytics|gtag|mixpanel|amplitude|posthog|segment|fbq|ga)\\b\\s*(?:\\.\\w+\\s*)?\\(\\s*['\"](?:track|page|identify|event)",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "PII stored without retention/TTL",
    "severity": "medium",
    "body": "A schema/table/column holding personal data is created without an associated expiry or retention policy. Define a TTL or scheduled-purge for personal-data fields so they are not kept longer than necessary.",
    "fileExts": [
      "ts",
      "js",
      "mjs",
      "py",
      "java",
      "go"
    ],
    "regexSource": "\\b(?:create(?:Index|Collection)|new\\s+Schema|@Column|prisma\\.\\w+\\.create)\\b[^;]*\\b(?:email|phone|ssn|address|dob|pii)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "PII in URL/query string",
    "severity": "medium",
    "body": "Personal data is placed in a URL query string, where it is captured by server logs, proxies, CDNs, and browser history. Move the PII into an encrypted request body (POST) or headers.",
    "fileExts": [],
    "regexSource": "[?&](?:email|ssn|phone|dob|firstName|lastName|password|token)=",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "PII shared with third party without contract flag",
    "severity": "high",
    "body": "Personal data is forwarded to an external API or marketing/CRM platform with no evident data-processing agreement or transfer safeguard. Confirm a DPA/SCC is in place and route the call through a vetted sharing wrapper.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\b(?:axios\\.(?:post|put)|fetch|sendgrid|segment|hubspot|salesforce|mailchimp)\\b\\s*\\([^)]*\\b(?:user\\.email|user\\.phone|ssn|fullName|profile\\.email|personalData)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "Soft-delete used instead of right-to-erasure",
    "severity": "high",
    "body": "A user/account record is flagged as deleted or deactivated rather than actually erased, leaving personal data retained. Implement a true erasure (or irreversible anonymisation) path that cascades to backups and caches.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "py",
      "java",
      "go"
    ],
    "regexSource": "\\b(?:users?|accounts?|customers?|members?)\\b[^;=]*\\b(?:isDeleted|deletedAt|isActive|deactivated|softDelete)\\b\\s*[:=]\\s*(?:true|false)",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "Cookie set without consent gating",
    "severity": "high",
    "body": "A cookie is written on the same line with no consent/necessary/essential guard, so non-essential cookies may be set before opt-in. Gate cookie writes behind a recorded consent check or mark them strictly necessary.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "^(?:(?!\\b(?:consent|necessary|essential|hasConsent|cookieConsent)\\b).)*(?:document\\.cookie\\s*=|res\\.cookie\\s*\\(|cookies\\.set\\s*\\()",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "Precise geolocation captured without notice",
    "severity": "medium",
    "body": "Precise device geolocation is captured via a high-accuracy location API. Confirm a clear notice and lawful basis precede the request, and prefer coarse/region-level location where exact coordinates are not required.",
    "fileExts": [],
    "regexSource": "\\b(?:getCurrentPosition|watchPosition|navigator\\.geolocation|CLLocationManager|requestLocationUpdates|FusedLocationProvider)\\b",
    "regexFlags": ""
  },
  {
    "packId": "privacy",
    "title": "Full PII table dumped",
    "severity": "high",
    "body": "A query selects every column from a user/customer table or exports all records, pulling far more personal data than the use-case needs. Select only the required fields and scope the export with filters and field allow-lists.",
    "fileExts": [
      "ts",
      "js",
      "mjs",
      "py",
      "java",
      "go",
      "sql"
    ],
    "regexSource": "\\b(?:SELECT\\s+\\*\\s+FROM\\s+(?:users|customers|accounts|members)|dumpTable|exportAll(?:Users|Customers))",
    "regexFlags": "i"
  },
  {
    "packId": "privacy",
    "title": "PII sent to analytics/ML without anonymisation",
    "severity": "high",
    "body": "Raw personal data is written to an analytics warehouse or ML pipeline without pseudonymisation or anonymisation. Hash or tokenise identifiers (or aggregate) before any secondary processing.",
    "fileExts": [
      "ts",
      "js",
      "mjs",
      "py"
    ],
    "regexSource": "\\b(?:trainModel|writeToWarehouse|sendToAnalyticsWarehouse|bigquery\\.insert|warehouse\\.write)\\b\\s*\\([^)]*\\b(?:rawEmail|user\\.email|ssn|fullName|rawPii|personalData)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Image missing alt attribute",
    "severity": "high",
    "body": "An <img> without an alt attribute is invisible to screen-reader users and fails non-text-content requirements. Add a descriptive alt, or alt=\"\" if the image is purely decorative.",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "<img\\b(?![^>]*\\balt\\s*=)[^>]*>",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Form input relies on placeholder instead of a label",
    "severity": "high",
    "body": "A text input with only a placeholder and no aria-label/aria-labelledby has no programmatic name; placeholders vanish on focus and are not announced as labels. Add an associated <label>, aria-label, or aria-labelledby.",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "<input\\b(?![^>]*(?:aria-label|aria-labelledby)\\s*=)(?![^>]*\\btype\\s*=\\s*[\"'](?:hidden|submit|button|reset)[\"'])[^>]*\\bplaceholder\\s*=",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Click handler on non-interactive element without role or keyboard handler",
    "severity": "high",
    "body": "A <div> or <span> with onClick but no role and no keyboard handler is unreachable and unoperable by keyboard users. Use a native <button>, or add role plus tabIndex and an onKeyDown handler.",
    "fileExts": [
      "jsx",
      "tsx"
    ],
    "regexSource": "<(?:div|span)\\b(?![^>]*\\brole\\s*=)[^>]*\\bonClick\\s*=",
    "regexFlags": ""
  },
  {
    "packId": "accessibility",
    "title": "Anchor with empty or placeholder href used as a button",
    "severity": "medium",
    "body": "An <a> with href=\"#\" or href=\"javascript:void(0)\" exposes a link role for what is really a button, breaking expected keyboard and screen-reader semantics. Use a <button> for actions, or give the anchor a real destination.",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "<a\\b[^>]*\\bhref\\s*=\\s*[\"'](?:#|javascript:void\\(0\\))?[\"']",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Root <html> element missing lang attribute",
    "severity": "high",
    "body": "An <html> element without a lang attribute leaves screen readers unable to choose the correct pronunciation rules for the page. Add lang with the document's primary language (e.g. lang=\"en\").",
    "fileExts": [
      "html",
      "jsx",
      "tsx",
      "vue",
      "svelte",
      "astro"
    ],
    "regexSource": "<html\\b(?![^>]*\\blang\\s*=)[^>]*>",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Positive tabindex value disrupts focus order",
    "severity": "medium",
    "body": "A tabIndex greater than zero forces an element ahead of the natural DOM order, producing a confusing and brittle tab sequence. Use tabIndex={0} to include an element in natural order, or -1 to remove it from the tab sequence.",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "\\btabIndex\\s*=\\s*[\"{]?\\s*\\+?[1-9]\\d*",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Icon-only button without an accessible name",
    "severity": "high",
    "body": "A <button> whose only child is an icon (svg/Icon/<i>) and which has no aria-label, aria-labelledby, or title has no accessible name and is announced as an empty button. Add aria-label or visually-hidden text describing the action.",
    "fileExts": [
      "jsx",
      "tsx"
    ],
    "regexSource": "<button\\b(?![^>]*(?:aria-label|aria-labelledby|title)\\s*=)[^>]*>\\s*<(?:svg|Icon|i)\\b",
    "regexFlags": ""
  },
  {
    "packId": "accessibility",
    "title": "Misspelled or invalid aria-* attribute",
    "severity": "medium",
    "body": "Misspelled ARIA attributes like aria-labeledby or aria-describ are silently ignored by browsers and assistive technology, so the intended semantics never apply. Correct the spelling to a valid WAI-ARIA attribute (e.g. aria-labelledby, aria-describedby).",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "\\baria-(?:role|hidden-label|labeledby|require|describ)\\b\\s*=",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Autoplaying media that is not muted",
    "severity": "medium",
    "body": "A <video> or <audio> with autoPlay but no muted attribute plays sound automatically, with no way for the user to stop it, violating audio-control requirements. Add muted (and controls) or remove autoPlay.",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "<(?:video|audio)\\b(?=[^>]*\\bautoPlay\\b)(?![^>]*\\bmuted\\b)[^>]*>",
    "regexFlags": "i"
  },
  {
    "packId": "accessibility",
    "title": "Heading level skipped (h1 directly to h3)",
    "severity": "medium",
    "body": "Jumping from <h1> straight to <h3> breaks the document outline that screen-reader users navigate by, since a level is skipped. Use the next sequential heading level (<h2>) or restructure the hierarchy.",
    "fileExts": [
      "jsx",
      "tsx",
      "html",
      "vue",
      "svelte"
    ],
    "regexSource": "<h1\\b[^>]*>[\\s\\S]*?</h1>\\s*<h(?:[3-6])\\b",
    "regexFlags": "i"
  },
  {
    "packId": "performance",
    "title": "await inside a loop (serialized I/O)",
    "severity": "high",
    "body": "Awaiting inside a for/while loop runs I/O strictly sequentially, so total latency scales with the number of iterations. Batch the work with Promise.all / asyncio.gather (or a bounded concurrency pool) so independent calls run in parallel.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "(?:for|while)\\s*\\(.*\\)\\s*\\{?.*\\bawait\\b",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "Database query inside a loop (N+1)",
    "severity": "high",
    "body": "Issuing a query per iteration produces an N+1 access pattern whose round-trip count grows linearly with the collection size. Replace it with a single batched IN/JOIN query, a dataloader, or an ORM include so the data is fetched in one round-trip.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "(?:for|while|\\.(?:forEach|map))\\s*\\(.*\\b(?:await\\s+)?(?:\\w+\\.)?(?:findOne|findById|findUnique|query|execute|aggregate)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "List endpoint missing pagination/LIMIT",
    "severity": "high",
    "body": "A repository call with no arguments (findAll()/find()) or a SELECT without a LIMIT returns the entire table, so memory and latency grow unbounded with data volume. Add an explicit LIMIT/take plus a pagination cursor or offset.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "py"
    ],
    "regexSource": "\\.(?:findAll|find|findMany)\\s*\\(\\s*\\)|SELECT\\s+\\*\\s+FROM\\b(?:(?!\\bLIMIT\\b).)*$",
    "regexFlags": "i"
  },
  {
    "packId": "performance",
    "title": "Synchronous fs call in a request path",
    "severity": "high",
    "body": "Synchronous fs calls (readFileSync, existsSync, statSync) block the event loop, stalling every concurrent request while the disk I/O completes. Use the async fs.promises API (or precompute/cache the value at startup) so the loop stays free.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\b(?:fs\\.)?(?:readFileSync|existsSync|writeFileSync|readdirSync|statSync)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "Outbound fetch/axios without a timeout",
    "severity": "high",
    "body": "A fetch/axios call with no signal, AbortController or timeout will hang indefinitely if the upstream stalls, pinning the connection and eventually exhausting the request pool. Always pass an AbortSignal.timeout or per-request timeout.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\b(?:fetch|axios(?:\\.(?:get|post|put|delete|patch))?)\\s*\\(\\s*[`'\"](?:(?!signal|timeout|AbortController|AbortSignal).)*\\)\\s*;?\\s*$",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "New DB connection per request (no pool)",
    "severity": "high",
    "body": "Constructing a fresh DB client/connection on a request path forces a full TCP+auth handshake every call and can exhaust the database's connection limit under load. Acquire from a shared, long-lived pool instead.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\b(?:new\\s+(?:pg\\.)?Client|createConnection|mongoose\\.connect|new\\s+MongoClient)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "Unbounded in-memory accumulator growth",
    "severity": "medium",
    "body": "Pushing onto a long-lived cache/results/buffer accumulator with no size cap or eviction lets memory grow without bound until the process OOMs. Cap the structure (LRU, ring buffer, or explicit max length) or stream the data instead of accumulating it.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\b(?:cache|store|buffer|items|results|history|accumulator|seen|allRows)\\.(?:push|unshift|concat)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "JSON.parse of an unbounded request body",
    "severity": "medium",
    "body": "Parsing an entire request/stream body with JSON.parse buffers the whole payload in memory, so an attacker or large client can drive memory and CPU spikes. Enforce a size limit before parsing (body-parser limit, content-length check, or streaming parser).",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "JSON\\.parse\\s*\\(\\s*(?:await\\s+)?(?:req|request|res|response|body|stream|rawBody)\\b",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "O(n^2) nested includes/indexOf scan",
    "severity": "medium",
    "body": "A linear array.includes/indexOf inside a filter/map callback is an O(n*m) scan that becomes a CPU cliff as inputs grow. Pre-build a Set/Map for O(1) membership lookups before the loop.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "\\.(?:filter|map|forEach|some|every|find)\\s*\\(.*=>.*\\.(?:includes|indexOf|find|some)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "performance",
    "title": "setInterval without cleanup handle (leak)",
    "severity": "medium",
    "body": "Calling setInterval without capturing its id means there is no handle to clearInterval, so the timer keeps firing (and its closure stays retained) for the lifetime of the process. Store the id and clear it on teardown/unmount.",
    "fileExts": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs"
    ],
    "regexSource": "^\\s*setInterval\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Unbounded string operation (strcpy/strcat/sprintf/gets)",
    "severity": "critical",
    "body": "strcpy, strcat, sprintf, and gets write without a destination-size bound and are a classic buffer-overflow source. Replace with bounded variants (strncpy, strncat, snprintf) or a length-checked copy.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "\\b(?:strcpy|strcat|sprintf|gets)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Allocation result used without NULL check",
    "severity": "high",
    "body": "The pointer returned by malloc/calloc/realloc is assigned but not validated against NULL before use; on a constrained device the allocation will fail and the dereference will fault. Check the result for NULL before dereferencing.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "=\\s*(?:malloc|calloc|realloc)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "memcpy/memmove with an unchecked length",
    "severity": "high",
    "body": "memcpy/memmove copies a caller-supplied length into a fixed destination without a visible bound against the destination size, risking overflow. Validate that the length cannot exceed sizeof(destination) before copying.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "\\b(?:memcpy|memmove)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Magic buffer-size literal in array declaration",
    "severity": "medium",
    "body": "A fixed-size array is declared with an inline numeric literal instead of a named constant, so the size cannot be reused or validated consistently across copies into it. Define the size as a single named constant (#define or const).",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "\\b(?:char|uint8_t|int8_t|u8)\\s+\\w+\\s*\\[\\s*\\d+\\s*\\]",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Hardware-register/ISR-shared variable missing volatile",
    "severity": "high",
    "body": "A pointer to a fixed hardware address is created without a volatile qualifier, letting the compiler cache or reorder register reads/writes and break device behaviour. Qualify memory-mapped and ISR-shared objects as volatile.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "=\\s*\\(\\s*(?:uint(?:8|16|32)_t|unsigned\\s+\\w+|int)\\s*\\*\\s*\\)\\s*0x",
    "regexFlags": "i"
  },
  {
    "packId": "embedded",
    "title": "Signed/unsigned comparison mismatch in loop bound",
    "severity": "medium",
    "body": "A signed int loop counter is compared against an unsigned size/length/count, so the implicit conversion can wrap and produce an infinite or under-running loop. Use an unsigned counter (size_t) matching the bound's type.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "for\\s*\\(\\s*int\\s+\\w+\\s*=[^;]*;[^;]*<\\s*\\w*(?:size|len|count|num)\\b",
    "regexFlags": "i"
  },
  {
    "packId": "embedded",
    "title": "Use of goto",
    "severity": "low",
    "body": "goto undermines structured control flow and complicates reasoning about resource cleanup and worst-case paths. Restructure with early returns, a status variable, or scoped RAII (C++) instead.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "\\bgoto\\s+\\w+",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Dynamic allocation via new on a real-time/ISR path",
    "severity": "high",
    "body": "The new operator performs non-deterministic heap allocation that can fragment memory and blow worst-case execution time on hot or interrupt paths. Use static or pool allocation reserved at startup instead.",
    "fileExts": [
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "=\\s*new\\s+[A-Za-z_]\\w*",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Ignored return value of a system/library call",
    "severity": "medium",
    "body": "A fallible system, HAL, or I/O call is invoked as a bare statement, discarding its status or error return so failures pass silently. Capture and check the return value before proceeding.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "^\\s*(?:read|write|recv|send|system|fread|fwrite|HAL_\\w+)\\s*\\(",
    "regexFlags": ""
  },
  {
    "packId": "embedded",
    "title": "Floating-point equality comparison",
    "severity": "medium",
    "body": "Comparing a floating-point value for exact equality is unreliable because of rounding and representation error. Compare against an epsilon tolerance (fabs(a - b) < EPS) instead.",
    "fileExts": [
      "c",
      "h",
      "cpp",
      "cc",
      "cxx",
      "hpp"
    ],
    "regexSource": "==\\s*[-+]?(?:\\d+\\.\\d*|\\.\\d+)f?",
    "regexFlags": ""
  }
];

function fileReFromExts(exts: string[]): RegExp | null {
  if (exts.length === 0) return null;
  return new RegExp(`\\.(${exts.join("|")})$`, "i");
}

/**
 * Compiled rule table consumed by the heuristic engine. The 'g' flag is
 * stripped because `RegExp.test` is stateful when global.
 */
export const PACK_HEURISTIC_RULES: PackHeuristicRule[] = RAW_PACK_HEURISTIC_RULES.map((rule) => ({
  packId: rule.packId,
  title: rule.title,
  severity: rule.severity,
  body: rule.body,
  fileRe: fileReFromExts(rule.fileExts),
  textRe: new RegExp(rule.regexSource, rule.regexFlags.replace(/g/g, "")),
}));
