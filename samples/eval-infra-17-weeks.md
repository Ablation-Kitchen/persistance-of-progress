# 17-Week Plan: Eval Infrastructure Engineer

Nov 9, 2026

## How to use this plan

In 17 weeks you close the gaps between 8 years of backend work and the Software Engineer, Evaluation Infrastructure role: LLM inference, the platform layer, GPU scheduling and eval methodology. You finish with a capstone project that covers almost every bullet in the posting.

**Assumptions:** about 6 hours a week (1 hour each weekday, 1 hour on Saturday), a budget of roughly $50–100 for rented GPU time, and Python as the working language. Items marked *Optional* can be skipped if you fall behind.

**Weekly rhythm**

- **Monday and Wednesday (1 hour each):** read and watch the week's material and take notes.
- **Tuesday, Thursday and Friday (1 hour each):** build the hands-on exercise in small steps. Commit at the end of every session so you can pick up where you left off.
- **Saturday (1 hour):** tick off the checkpoints, write 3 sentences on what you learned in a `LEARNINGS.md`, and choose next week's tasks. These notes become interview material.

**Apply in parallel.** Don't wait until week 17. Start applying around week 8; early interviews are practice, and your capstone will be far enough along to talk about.

**Core resources used throughout** (all listed with links in the Resource index at the end):

- *AI Engineering* by Chip Huyen (2025): evaluation and inference chapters
- *Designing Data-Intensive Applications* by Martin Kleppmann
- *How to Scale Your Model* (Google DeepMind, free online)
- Andrej Karpathy's YouTube lectures
- Stanford CS336, Language Modeling from Scratch (free lectures)

## Weeks 1–3: How LLMs work and run

Goal: be able to explain, with numbers, why LLM inference is expensive and where the time goes. This is the vocabulary every later week depends on.

**Weeks 1–2: The model**

- Watch: [Intro to Large Language Models](https://www.youtube.com/watch?v=zjkBMFhNj_g) (Karpathy, 1 hr) for the big picture.
- Watch and code along: [Let's build GPT: from scratch, in code, spelled out](https://www.youtube.com/watch?v=kCc8FmEb1nY) (Karpathy, 2 hrs). Type the code yourself; don't just watch.
- Optional visual intuition: the [3Blue1Brown neural networks series](https://www.3blue1brown.com/topics/neural-networks), chapters on transformers and attention.
- Skim: [Attention Is All You Need](https://arxiv.org/abs/1706.03762), focusing on the architecture figure and section 3.

**Week 3: Inference arithmetic**

- Read: [Transformer Inference Arithmetic](https://kipp.ly/transformer-inference-arithmetic/) (kipply). The single most useful post for this role.
- Read: the "All About Transformer Inference" chapter of [How to Scale Your Model](https://jax-ml.github.io/scaling-book/).
- Read: [Making Deep Learning Go Brrrr From First Principles](https://horace.io/brrr_intro.html) (Horace He): compute-bound vs. memory-bound vs. overhead-bound.
- Read: [Large Transformer Model Inference Optimization](https://lilianweng.github.io/posts/2023-01-10-inference-optimization/) (Lilian Weng) as an overview of the techniques you'll meet in weeks 7–9.
- Optional: [Let's reproduce GPT-2 (124M)](https://www.youtube.com/watch?v=l8pRSuU81PU) (Karpathy, 4 hrs). Watch the sections on mixed precision, FlashAttention and torch.compile.

**Hands-on exercises**

1. Add a KV cache to your GPT from weeks 1–2 and measure the generation speedup.
2. On paper, compute the KV cache size per token for Llama 3 8B (32 layers, 8 KV heads, head dimension 128, fp16). Check: it should come to 128 KB per token, about 1 GB for one 8K-token sequence.
3. Explain in 5 sentences in `LEARNINGS.md` why prefill is compute-bound and decode is memory-bandwidth-bound.

**Checkpoints**

- [ ] I can draw a transformer block and explain attention without notes.
- [ ] I can estimate KV cache memory and max batch size for a model on a given GPU.
- [ ] I can explain why batching makes decode cheaper per token.

## Weeks 4–6: The platform layer

Goal: move from "I write services" to "I run long batch workloads on a cluster and they survive failures." This is your biggest gap coming from backend services.

**Weeks 4–5: Async Python and Kubernetes**

- Read: *Python Concurrency with asyncio* (Matthew Fowler), the chapters on tasks, semaphores, queues and error handling. Skip what you know.
- Watch: David Beazley's PyCon talk "Python Concurrency From the Ground Up: LIVE!" (search the title on YouTube) for intuition on event loops.
- Read: *Kubernetes: Up and Running* (3rd ed.), the chapters on Pods, Deployments and Jobs, plus resource requests and limits.
- Read: the Kubernetes docs on [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) and [scheduling GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/).
- Read: *Designing Data-Intensive Applications*, chapter "The Trouble with Distributed Systems."

**Week 6: Ray, durable workflows, failure handling**

- Read: the [Ray paper](https://arxiv.org/abs/1712.05889) and the [Ray Core walkthrough](https://docs.ray.io/en/latest/ray-core/walkthrough.html): tasks, actors, object store, fault tolerance.
- Read: [Temporal's core concepts](https://docs.temporal.io/) on durable execution. Eval runs are hours-long workflows that must resume after a crash.
- Read: the [Google SRE book](https://sre.google/sre-book/table-of-contents/) chapters "Handling Overload," "Addressing Cascading Failures" and "Data Processing Pipelines."
- Read: *Designing Data-Intensive Applications*, chapter "Stream Processing" (message brokers and exactly-once semantics).

**Hands-on exercises**

1. Write an async Python job runner: a queue of 10,000 fake "eval tasks" (each sleeps randomly and fails 5% of the time), with a concurrency limit, retries with exponential backoff and jitter, and results saved so a restart skips finished work.
2. Run a local cluster with [kind](https://kind.sigs.k8s.io/) and deploy the runner as several worker pods pulling from Redis. Kill pods at random and confirm nothing is lost or done twice.
3. Optional: port the same job to Ray tasks and compare: lines of code, failure behavior, how it scales.

**Checkpoints**

- [ ] My runner survives killed workers with no lost or duplicated results.
- [ ] I can explain when to use Kubernetes Jobs vs. Ray vs. a workflow engine.
- [ ] I can explain backpressure and why unbounded retries cause cascading failures.

## Weeks 7–9: Hands-on LLM inference

Goal: serve a real model, load-test it with your own client, and be able to explain every number on the throughput–latency curve. This covers the "Experience in LLM inference" bullet.

**Week 7: How serving engines work**

- Read (core papers):
  - [Efficient Memory Management for LLM Serving with PagedAttention](https://arxiv.org/abs/2309.06180) (vLLM)
  - [Orca: continuous batching](https://www.usenix.org/conference/osdi22/presentation/yu) (OSDI '22)
  - [FlashAttention](https://arxiv.org/abs/2205.14135), sections 1–3
- Read: *AI Engineering* (Chip Huyen), chapter "Inference Optimization."
- Watch: the inference lecture from [Stanford CS336](https://stanford-cs336.github.io/) (lecture videos are linked from the course site).
- Read: the [vLLM docs](https://docs.vllm.ai/) on the OpenAI-compatible server, prefix caching and benchmarking.

**Week 8: Advanced serving and profiling**

- Read (pick at least two):
  - [Speculative decoding](https://arxiv.org/abs/2211.17192) (Leviathan et al.)
  - [SGLang and RadixAttention](https://arxiv.org/abs/2312.07104): why prefix sharing matters for evals, where many prompts share a long few-shot prefix
  - [Sarathi-Serve](https://arxiv.org/abs/2403.02310): chunked prefill and the throughput–latency tradeoff
  - [DistServe](https://arxiv.org/abs/2401.09670): separating prefill and decode
- Learn the tools: `nvidia-smi`, [NVIDIA DCGM](https://developer.nvidia.com/dcgm) metrics, the [PyTorch profiler](https://pytorch.org/tutorials/recipes/recipes/profiler_recipe.html), and py-spy for the Python side.

**Hands-on exercises** (rent one GPU on RunPod, Modal or Lambda; an L4, A10 or A100 is plenty)

1. Serve an open 7–8B model with vLLM. Write your own async load generator that reports time to first token, inter-token latency and total tokens/sec.
2. Sweep concurrency from 1 to 256 and plot throughput against p50/p99 latency. Find the knee in the curve and explain it in terms of KV cache memory.
3. Turn on prefix caching and run a few-shot benchmark where every prompt shares a long prefix. Measure the speedup.
4. Optional: repeat one run with SGLang or a quantized (FP8 or AWQ) model and compare.
5. Write a one-page benchmark report with charts. It goes in your portfolio.

**Checkpoints**

- [ ] I can explain continuous batching, PagedAttention and prefix caching to an interviewer.
- [ ] I know the max useful concurrency for my setup and why.
- [ ] I can tell from metrics whether a slow run is bottlenecked on GPU, network, or my client.

## Weeks 10–13: Evals and the capstone

Goal: understand what makes an eval signal trustworthy, then build a mini eval platform that ties weeks 1–9 together. This capstone is the centerpiece of your interviews.

**Weeks 10–11: Eval methodology (read while you start building)**

- Read: [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640) (Evan Miller). This is what "maintaining evaluation signal quality" means in practice.
- Read: [Quantifying Variance in Evaluation Benchmarks](https://arxiv.org/abs/2406.10229): how much scores move between seeds and checkpoints.
- Read: section 2.1 of the [Codex paper](https://arxiv.org/abs/2107.03374) for the unbiased pass@k estimator.
- Read: *AI Engineering* (Chip Huyen), the two evaluation chapters (methodology, and evaluating AI systems), including model-as-judge.
- Skim, for how real benchmarks are built and scored: [SWE-bench](https://arxiv.org/abs/2310.06770), [HELM](https://arxiv.org/abs/2211.09110) and [Chatbot Arena](https://arxiv.org/abs/2403.04132) (pairwise comparison, Elo/Bradley–Terry).
- Study the code: [Inspect](https://inspect.aisi.org.uk/) (datasets, solvers, scorers, logs) and [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) (how tasks are defined and batched).

**Capstone spec: a mini eval platform**

1. **Runner:** an async harness that runs 2–3 benchmarks (e.g. GSM8K, a slice of MMLU, a small coding set with pass@k) against any OpenAI-compatible endpoint. Use your runner from weeks 4–6: concurrency limits, retries, caching, resume.
2. **Execution:** runs as jobs on your kind cluster, workers autoscaled on queue depth, results in Postgres.
3. **Scoring:** accuracy with 95% confidence intervals, plus paired comparison between two models on the same questions.
4. **Comparison UI:** a small web page (FastAPI plus a simple frontend, or Streamlit): pick two runs, see score deltas with error bars, and drill into the questions where the models disagree.
5. **Performance write-up:** profile one full run, find the bottleneck (client concurrency, GPU memory, tokenization, scoring), fix it, and report before/after wall-clock time and GPU utilization.
6. **README:** architecture diagram, design decisions, what you would do at 1,000 times the scale.

**Weeks 12–13: Finish and polish the capstone**

- Run it end to end on a rented GPU against two models (e.g. two sizes from the same family).
- Record a 3-minute demo video and pin the repo on GitHub.

**Checkpoints**

- [ ] I can say whether a 1.5-point benchmark gain is real, and how many questions I'd need to detect it.
- [ ] My platform resumes a half-finished run after I kill it.
- [ ] Someone else can run my capstone from the README in under 15 minutes.

## Weeks 14–15: GPU fleet scheduling

Goal: speak fluently about sharing scarce GPUs between training, evals and research, which is the "capacity fleet management" and "dynamic resource optimization" part of the posting.

**Read**

- [Large-scale cluster management at Google with Borg](https://research.google/pubs/large-scale-cluster-management-at-google-with-borg/): priorities, quotas and preemption, the ancestor of Kubernetes.
- [Analysis of Large-Scale Multi-Tenant GPU Clusters for DNN Training Workloads](https://www.usenix.org/conference/atc19/presentation/jeon) (Microsoft's Philly cluster): why real GPU fleets sit underused.
- [Tiresias](https://www.usenix.org/conference/nsdi19/presentation/gu) and [Gandiva](https://www.usenix.org/conference/osdi18/presentation/xiao): GPU-specific schedulers. Optional: read the intro and design sections.
- [MegaScale](https://arxiv.org/abs/2402.15627) (ByteDance): fault tolerance and diagnosis at 10,000+ GPUs.
- The infrastructure section of [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783): real numbers on failures and interruptions at scale.
- Docs: [Kueue](https://kueue.sigs.k8s.io/docs/overview/) (job queueing, quotas, fair sharing and preemption on Kubernetes) and the [Ray autoscaler](https://docs.ray.io/en/latest/cluster/key-concepts.html).

**Concepts to be able to whiteboard**

- Gang scheduling: why a multi-GPU job needs all its GPUs at once
- Bin-packing and fragmentation: why 8 free GPUs spread over 8 nodes can be useless
- Priority and preemption: evals for a new checkpoint vs. a nightly regression suite vs. ad hoc research
- Opportunistic use of idle capacity, with checkpoint-and-resume so preemption costs little
- Right-sizing: choosing model replicas, tensor parallelism and batch size per eval to maximize throughput per GPU

**Hands-on exercise**

1. Install Kueue on your kind cluster, using a fake extended resource as "GPUs." Define two queues (high-priority checkpoint evals, low-priority nightly suite) with a shared quota.
2. Submit a burst of jobs and show low-priority jobs being preempted and then resuming, using your capstone's checkpointing.
3. Add this to the capstone README as "Scheduling."

**Checkpoints**

- [ ] I can design a scheduling policy for evals sharing a fleet with training, and defend its trade-offs.
- [ ] I can explain the main causes of low GPU utilization and how to fix each.

## Weeks 16–17: Interview prep

Goal: turn 8 years of backend work plus the capstone into crisp answers for the three interview types you're likely to face: practical coding, system design, and past-project deep dives.

**Practical coding (5 one-hour timed sessions)**

These tend to look like real infrastructure work, not puzzles. Practice from a blank file:

1. An async worker pool with a concurrency limit, per-task timeout, and retries with backoff.
2. A token-bucket rate limiter, then make it safe across threads or coroutines.
3. A priority job scheduler with preemption: jobs have priority and GPU count; the cluster has N GPUs.
4. An LRU cache with TTL, plus a prefix cache keyed on token sequences (a simplified version of RadixAttention).
5. Parse a large log of eval results and compute per-model accuracy with confidence intervals, streaming, in bounded memory.

From week 8, when you start applying, swap one build session a week for 1–2 LeetCode mediums (heaps, graphs, intervals) in case the loop includes a classic round.

**System design (practice each out loud, 45 minutes)**

- Design a platform that runs thousands of evals on every new training checkpoint, on a GPU fleet shared with training, and flags regressions within hours.
- Design the inference layer for evals: hundreds of model checkpoints, bursty demand, a fixed GPU budget.
- Design a model comparison service: store every completion and score, and support slicing by benchmark, category and checkpoint.
- Design the eval runner for agentic tasks that run for an hour each in sandboxes (e.g. SWE-bench style).

For each, cover the requirements and scale numbers, data model, scheduling, failure handling and resume, observability, and cost. Reference: *System Design Interview* (Alex Xu), vol. 1 and 2, for format practice; your capstone for content.

**Story bank (fill this in)**

| Posting bullet | My story (situation, action, result) | Numbers |
| --- | --- | --- |
| Highly reliable, easy-to-use infrastructure |  |  |
| Collaborating with other teams on internal tooling |  |  |
| Resolving a performance bottleneck |  |  |
| Large-scale distributed systems |  |  |
| Diving deep into a hard bug at any level of the stack |  |  |
| Capstone: eval platform and benchmark report |  |  |

**Final checks**

- [ ] Two mock system design interviews with a peer or a paid mock service
- [ ] A 2-minute "why evals, why now" answer that links your backend background to this role
- [ ] Resume updated: capstone and benchmark report near the top, with numbers

## Resource index

Every resource in the plan in one place, by week. The links were compiled from memory, not checked one by one; if one is broken, search the title.

| Resource | Type | Week |
| --- | --- | --- |
| [Intro to Large Language Models](https://www.youtube.com/watch?v=zjkBMFhNj_g) (Karpathy) | Video | 1 |
| [Let's build GPT](https://www.youtube.com/watch?v=kCc8FmEb1nY) (Karpathy) | Video | 1–2 |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | Paper | 2 |
| [Transformer Inference Arithmetic](https://kipp.ly/transformer-inference-arithmetic/) | Article | 3 |
| [How to Scale Your Model](https://jax-ml.github.io/scaling-book/) | Online book | 3 |
| [Making Deep Learning Go Brrrr](https://horace.io/brrr_intro.html) | Article | 3 |
| [Large Transformer Model Inference Optimization](https://lilianweng.github.io/posts/2023-01-10-inference-optimization/) | Article | 3 |
| [Let's reproduce GPT-2 (124M)](https://www.youtube.com/watch?v=l8pRSuU81PU) (Karpathy) | Video, optional | 3 |
| *Python Concurrency with asyncio* (Fowler) | Book | 4 |
| *Kubernetes: Up and Running*, 3rd ed. | Book | 4–5 |
| *Designing Data-Intensive Applications* (Kleppmann) | Book | 5–6 |
| [Ray paper](https://arxiv.org/abs/1712.05889) | Paper | 6 |
| [Google SRE book](https://sre.google/sre-book/table-of-contents/) | Online book | 6 |
| [Temporal docs](https://docs.temporal.io/) | Docs | 6 |
| [PagedAttention / vLLM](https://arxiv.org/abs/2309.06180) | Paper | 7 |
| [Orca](https://www.usenix.org/conference/osdi22/presentation/yu) | Paper | 7 |
| [FlashAttention](https://arxiv.org/abs/2205.14135) | Paper | 7 |
| *AI Engineering* (Chip Huyen) | Book | 7, 10–11 |
| [Stanford CS336](https://stanford-cs336.github.io/) | Course videos | 7 |
| [Speculative decoding](https://arxiv.org/abs/2211.17192) | Paper | 8 |
| [SGLang](https://arxiv.org/abs/2312.07104) | Paper | 8 |
| [Sarathi-Serve](https://arxiv.org/abs/2403.02310) | Paper | 8 |
| [DistServe](https://arxiv.org/abs/2401.09670) | Paper | 8 |
| [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640) | Paper | 10 |
| [Quantifying Variance in Evaluation Benchmarks](https://arxiv.org/abs/2406.10229) | Paper | 10 |
| [Codex / pass@k](https://arxiv.org/abs/2107.03374) | Paper | 10 |
| [SWE-bench](https://arxiv.org/abs/2310.06770) | Paper | 11 |
| [HELM](https://arxiv.org/abs/2211.09110) | Paper | 11 |
| [Chatbot Arena](https://arxiv.org/abs/2403.04132) | Paper | 11 |
| [Inspect](https://inspect.aisi.org.uk/) | Framework | 10–11 |
| [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) | Framework | 10–11 |
| [Borg](https://research.google/pubs/large-scale-cluster-management-at-google-with-borg/) | Paper | 14 |
| [Philly GPU cluster analysis](https://www.usenix.org/conference/atc19/presentation/jeon) | Paper | 14 |
| [Tiresias](https://www.usenix.org/conference/nsdi19/presentation/gu) | Paper, optional | 14 |
| [Gandiva](https://www.usenix.org/conference/osdi18/presentation/xiao) | Paper, optional | 14 |
| [MegaScale](https://arxiv.org/abs/2402.15627) | Paper | 15 |
| [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783) | Paper | 15 |
| [Kueue](https://kueue.sigs.k8s.io/docs/overview/) | Docs | 15 |
| *System Design Interview*, vol. 1–2 (Alex Xu) | Book | 16–17 |
