interface RoleVoice {
  role: "architect" | "security" | "qa" | "performance" | "maintainer";
  name: string;
  reviews: string;
  /** Short sample finding rendered in mono — verdict, severity, file:line, note. */
  sample: {
    verdict: "PASS" | "WARN" | "FAIL";
    severity: string;
    location: string;
    note: string;
  };
  /** Tailwind span classes for the 12-col bento; two voices carry more weight. */
  span: string;
  /** When true, render the larger "feature" layout with extra rhythm. */
  emphasis?: boolean;
}

const VERDICT_TONE: Record<RoleVoice["sample"]["verdict"], string> = {
  PASS: "text-quorate-pass",
  WARN: "text-quorate-warn",
  FAIL: "text-quorate-fail"
};

const ROLE_ACCENT: Record<RoleVoice["role"], string> = {
  architect: "text-quorate-architect",
  security: "text-quorate-security",
  qa: "text-quorate-qa",
  performance: "text-quorate-performance",
  maintainer: "text-quorate-maintainer"
};

const ROLE_BORDER: Record<RoleVoice["role"], string> = {
  architect: "hover:border-quorate-architect/45",
  security: "hover:border-quorate-security/45",
  qa: "hover:border-quorate-qa/45",
  performance: "hover:border-quorate-performance/45",
  maintainer: "hover:border-quorate-maintainer/45"
};

const VOICES: readonly RoleVoice[] = [
  {
    role: "security",
    name: "Security",
    reviews:
      "Hunts for the change that ships an exploit — missing authz, unsafe input, leaked secrets, and trust placed where it shouldn't be.",
    sample: {
      verdict: "FAIL",
      severity: "HIGH",
      location: "programs/escrow/src/lib.rs:88",
      note: "Anchor vault constraint removed"
    },
    span: "lg:col-span-7",
    emphasis: true
  },
  {
    role: "architect",
    name: "Architect",
    reviews:
      "Weighs the shape of the system — boundaries, coupling, and whether this change still fits the design six months from now.",
    sample: {
      verdict: "WARN",
      severity: "MED",
      location: "programs/escrow/src/accounts.rs:44",
      note: "authority boundary is split across handlers"
    },
    span: "lg:col-span-5",
    emphasis: true
  },
  {
    role: "qa",
    name: "QA",
    reviews:
      "Reads for the untested path and the silent edge case — the branch no test covers and the input nobody expected.",
    sample: {
      verdict: "WARN",
      severity: "MED",
      location: "tests/close-escrow.test.ts:19",
      note: "unauthorized closer path has no test"
    },
    span: "lg:col-span-4"
  },
  {
    role: "performance",
    name: "Performance",
    reviews:
      "Flags the hot path that won't hold under load — the N+1 query, the unbounded loop, the allocation in the inner loop.",
    sample: {
      verdict: "PASS",
      severity: "LOW",
      location: "app/actions/closeEscrow.ts:41",
      note: "confirmation polling is bounded"
    },
    span: "lg:col-span-4"
  },
  {
    role: "maintainer",
    name: "Maintainer",
    reviews:
      "Guards the codebase a year on — naming, dead code, drift, and the small inconsistencies that compound into debt.",
    sample: {
      verdict: "PASS",
      severity: "LOW",
      location: "programs/escrow/src/state.rs:9",
      note: "seed helper can move into shared module"
    },
    span: "lg:col-span-4"
  }
] as const;

function FindingLine({ sample }: { sample: RoleVoice["sample"] }) {
  return (
    <p className="font-mono text-[13px] leading-relaxed">
      <span className={`font-bold ${VERDICT_TONE[sample.verdict]}`}>
        {sample.verdict}
      </span>{" "}
      <span className="text-quorate-dim">{sample.severity}</span>{" "}
      <span className="text-gray-200">{sample.location}</span>{" "}
      <span className="text-quorate-muted">{sample.note}</span>
    </p>
  );
}

export function FeatureCards() {
  return (
    <section id="features" className="relative px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="h-px w-6 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(110,151,255,0.7), rgba(110,151,255,0.2))"
            }}
            aria-hidden
          />
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-quorate-accent">
            The council
          </p>
        </div>

        <h2 className="display-section text-3xl text-white md:text-5xl">
          Five voices, one chamber
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-quorate-muted">
          Every change is read by five specialised reviewers, each with a
          distinct mandate. Quorate dedupes what they find and returns a single{" "}
          <span className="text-quorate-pass">PASS</span>,{" "}
          <span className="text-quorate-warn">WARN</span>, or{" "}
          <span className="text-quorate-fail">FAIL</span> — with file-and-line
          evidence.
        </p>

        <div className="reveal is-visible mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-12">
          {VOICES.map((voice) => (
            <article
              key={voice.role}
              className={`group flex flex-col rounded-2xl border border-quorate-border bg-quorate-surface/80 shadow-terminal backdrop-blur transition ${ROLE_BORDER[voice.role]} ${voice.span} ${
                voice.emphasis ? "p-7 md:p-8" : "p-6"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-xs uppercase tracking-[0.22em] ${ROLE_ACCENT[voice.role]}`}
                >
                  {voice.name}
                </span>
                <span
                  className={`h-px flex-1 rounded-full border-t border-current opacity-25 ${ROLE_ACCENT[voice.role]}`}
                  aria-hidden
                />
              </div>

              <p
                className={`mt-4 leading-relaxed text-quorate-muted ${
                  voice.emphasis ? "text-base" : "text-sm"
                }`}
              >
                {voice.reviews}
              </p>

              <div className="mt-auto pt-6">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-quorate-dim">
                  sample finding
                </p>
                <div className="rounded-xl border border-quorate-border bg-quorate-bg/70 px-4 py-3">
                  <FindingLine sample={voice.sample} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
