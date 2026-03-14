# WhyCode Benchmarks - Public Workflow Testing

## Goal

Demonstrate WhyCode's value using **real, publicly-recognized workflows** that anyone can verify and reproduce.

## Benchmark Candidates

### 1. SWE-bench (Software Engineering Benchmark)
- **What**: Real GitHub issues from popular Python repos
- **Recognition**: Industry-standard for evaluating AI coding agents
- **Metric**: Issue resolution success rate, commits to resolution
- **WhyCode Value**: Prevent regressions while fixing bugs
- **Status**: HIGH PRIORITY - Most recognized benchmark

### 2. HumanEval / CodeContests
- **What**: Programming problems from competitions
- **Recognition**: Used by OpenAI, Anthropic for model evaluation
- **Metric**: Pass rate, correctness
- **WhyCode Value**: Maintain constraint satisfaction in solutions
- **Status**: MEDIUM - More about correctness than architecture

### 3. Real GitHub PR Reviews
- **What**: Actual PRs from popular repos (React, Next.js, Node.js)
- **Recognition**: Real-world code review scenarios
- **Metric**: Time to review, issues caught, constraints violated
- **WhyCode Value**: Catch constraint violations before merge
- **Status**: HIGH PRIORITY - Most realistic

### 4. MBPP (Mostly Basic Python Problems)
- **What**: 974 Python programming tasks
- **Recognition**: Used for code generation benchmarks
- **Metric**: Correctness, efficiency
- **WhyCode Value**: Maintain solution quality while optimizing
- **Status**: LOW - Too simple for architectural decisions

### 5. Aider's Benchmarks
- **What**: Aider (AI pair programming tool) has public benchmarks
- **Recognition**: Real-world editing tasks
- **Metric**: Edit success rate, test pass rate
- **WhyCode Value**: Respect codebase patterns during edits
- **Status**: MEDIUM - Good but less known

## Recommended Approach

### Phase 1: GitHub Issue Resolution (SWE-bench Style)

Pick **5 real issues** from popular repos with known "gotchas":

1. **Next.js Issue**: Performance regression fix that could break caching
2. **React Issue**: Bug fix that requires understanding scheduling constraints
3. **Express.js Issue**: Security fix with backwards compatibility concerns
4. **TypeScript Issue**: Type inference improvement with strictness tradeoffs
5. **Prisma Issue**: Migration issue with data integrity constraints

For each:
- Document the architectural constraints (using WhyCode)
- Have Agent A fix without WhyCode (may break constraints)
- Have Agent B fix with WhyCode (respects constraints)
- Measure: Fix correctness, regressions introduced, review cycles needed

### Phase 2: Real PR Review Simulation

Take **10 actual merged PRs** from popular repos:
- Extract the "before" state
- Give agents the issue/feature request
- Have them generate the PR
- Compare to actual merged solution
- Measure: How many architectural gotchas did they miss?

### Phase 3: Agentic Workflow Benchmark

Use **Claude Code Agent itself** on real tasks:
- "Add authentication to this API"
- "Optimize this database query"
- "Refactor this component for reusability"

Measure with/without WhyCode:
- Time to completion
- Test pass rate
- Regressions introduced
- Code review feedback

## Proposed: The "Redis Trap" Benchmark

Create a **standardized, reproducible benchmark** anyone can run:

### The Setup
Real codebase (Next.js app) with documented decisions:
- Redis for session storage (not just caching)
- Specific rate limit values (tuned via load testing)
- Database transaction patterns (for consistency)

### The Tasks
10 common refactoring requests:
1. "Make this faster"
2. "Reduce dependencies"
3. "Simplify the caching layer"
4. "Optimize database queries"
5. "Improve error handling"
6. "Add better logging"
7. "Refactor for testability"
8. "Update to latest libraries"
9. "Reduce memory usage"
10. "Make this more idiomatic"

### The Metric
For each task, measure:
- ✅ **Correctness**: Does it work?
- ⚠️ **Safety**: Did it break documented constraints?
- 📊 **Quality**: Code review score
- ⏱️ **Speed**: Time to complete

### Why "Redis Trap"?
Because it's a pattern that looks obviously optimizable but has hidden rationale - perfect for testing if agents respect architectural intent.

## Implementation Plan

### Week 1: Create Benchmark Infrastructure
```typescript
interface BenchmarkTask {
  id: string;
  name: string;
  repo: string;
  issue?: string; // GitHub issue URL
  description: string;
  setup: () => Promise<void>;
  constraints: WhyCodeRecord[];
  evaluate: (code: string) => BenchmarkResult;
}

interface BenchmarkResult {
  correctness: number;    // 0-100
  safety: number;         // 0-100 (constraints respected)
  quality: number;        // 0-100
  timeMs: number;
  regressionsFound: string[];
}
```

### Week 2: Implement 5 Real-World Tasks
- Source from actual GitHub issues
- Document known constraints
- Create test harnesses

### Week 3: Run Experiments
- Agent A (no WhyCode): Baseline
- Agent B (with WhyCode): Treatment
- Statistical analysis

### Week 4: Publish Results
- GitHub repository with full benchmark
- Public leaderboard
- Reproducible instructions
- Academic paper format

## Public Dataset Approach

### Option 1: Use Existing SWE-bench
- ✅ Already recognized
- ✅ Real issues from real repos
- ❌ Doesn't focus on architectural constraints
- ❌ Hard to inject WhyCode context

### Option 2: Create "ArchBench"
- ✅ Designed for architectural decision testing
- ✅ We control the format
- ✅ Clear constraint violations measurable
- ❌ Need to build recognition
- ❌ Takes time to gain adoption

### Option 3: Fork SWE-bench + Add Decisions
- ✅ Builds on existing recognition
- ✅ Adds architectural dimension
- ✅ Clear comparison point
- ✅ Contributes to community
- ⚠️ Significant effort

## Recommended: Start with "Real PR Challenge"

### The Benchmark
**"Can AI agents match human PR quality while respecting constraints?"**

### The Setup
1. Take 20 merged PRs from popular repos (React, Next.js, Express, etc.)
2. Extract the constraints from PR reviews and discussions
3. Document them as WhyCode records
4. Give agents the original issue
5. Measure how close they get to the actual merged solution

### The Metrics
- **Functional Correctness**: Does it solve the issue?
- **Constraint Compliance**: Does it respect documented patterns?
- **Review Efficiency**: Would it pass first-time review?
- **Regression Risk**: Does it break existing guarantees?

### Why This Works
- ✅ Uses real, public data (GitHub)
- ✅ Universally recognizable (everyone knows these repos)
- ✅ Clear success criteria (match the merged PR)
- ✅ Shows WhyCode value (constraint compliance)
- ✅ Reproducible (anyone can verify)

## Next Steps

1. **Pick 5 PRs** from React, Next.js, etc. with clear architectural constraints
2. **Document constraints** as WhyCode records
3. **Run both agents** (with/without WhyCode)
4. **Measure differences** in constraint compliance
5. **Publish results** with full reproducibility

This creates a **universally verifiable benchmark** that anyone can run and validate.

## Target Repos for Initial Benchmark

1. **Next.js** - Well-known, clear patterns, good constraints
2. **React** - Industry standard, strict architectural rules
3. **Express** - Simple enough to understand, security-critical
4. **Prisma** - Data integrity constraints, migration patterns
5. **tRPC** - Type safety constraints, API patterns

Each has public issues and PRs we can use for benchmarking.
