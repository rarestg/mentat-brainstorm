# Don't build a coding agent sandbox yourself | Ona - AI software engineers

<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-P4LP64V" height="0" width="0" style="display:none;visibility:hidden"></iframe>

[](/)

-   Platform
-   Use cases
-   Resources
-   [Blog](/stories)
-   [Docs](/docs)
-   [Pricing](/pricing)

-   [Sign in](https://app.gitpod.io/)
-   [Request a demo](/contact/demo)

Menu

[Ona Automations: proactive background agents now generally available](/stories/ona-automations-proactive-background-agents)

Lou Bichard/January 13, 2026Platform Engineering

# Don't build a coding agent sandbox yourself

Agents need sandboxes, yet building them is deceptively complex.

Something shifted over the Christmas break in 2025.

The internet got time to experiment with coding agents, and many discovered the incredible productivity that comes with autonomous coding agents, particularly when running them in parallel or the background. **Unlike code assistants in your editor, agents can run autonomously for long periods of time, executing test suites, compiling builds and iterating towards task completion entirely autonomously, without explicit human supervision.**

Naturally, many organizations are reaching the same conclusion about these agents:

‘**We can’t run agents like this on our developer laptops anymore, we need sandboxes’**

Security is often the principal concern and main motivation for wanting agent sandboxing. That said, sandboxing is also a prerequisite to productivity gains. When you run agents remotely, you can then scale them horizontally, run them 24/7 and wake up/shut them down on schedules.

Agent sandboxing enables organizations to automate anything and everything with agents from builds that fix themselves, scheduling 10 code refactoring pull requests to run overnight, and fleets of agents that do mass refactoring across 1000s of legacy repositories. At this point, teams face a choice: to either implement sandboxes themselves or engage with a partner.

At Ona, we've also observed a trend of organizations reflexively taking internally available infrastructure primitives such as Kubernetes or CI platforms and adding coding sandbox functionality without considering the ‘day 2’ and total cost of ownership implications. **At Ona, we’ve seen first-hand what happens when you force stateful, interactive workloads into infrastructure that it was not designed for, which is _****why we left Kubernetes****_.**

## What you’ll need that you’re not thinking about

Autonomous agents are unusual workloads that you’ve most likely never supported before. They aren’t short-lived applications you can bundle into a container and forget about. They’re long-running, stateful, and interactive, executing arbitrary code with real side effects. That combination forces you to think about isolation boundaries, security models, and lifecycle management in ways most existing infrastructure was never designed for.

![The hidden complexity of agent sandbox infrastructure](/_next/image?url=%2Fimages%2Fcontent%2Fsanity%2Fsandbox.png&w=3840&q=75)
The hidden complexity of agent sandbox infrastructure

What you’ll need that you’re likely not thinking about:

-   **Isolation and blast radius -** Agents will do exactly what they’re instructed to do, including actions you wish they wouldn’t. In the worst cases that’s prompt injection from bad actors, so strong isolation is non-negotiable to contain destructive actions, while still allowing agents the requisite freedom required to complete the tasks delegated to them.
-   **Real development environments -** Unlike production workloads, agents need environments that look a lot like developer laptops. Shell access, CLIs, language runtimes, package managers, even Docker itself. Many aspects of coding sandbox infra are red flags in production workloads, but are expected behavior for sandboxed agents.
-   **Identity and access -** Agents need credentials to do useful work: access to source code repositories, artifact stores, cloud APIs, and the countless internal services running in your private or corporate network. Those credentials are ideally short-lived, tightly scoped, and auditable, meaning deep integration with identity, secrets, and permission systems.
-   **Observability and audit trails -** When something goes wrong, you need to answer basic questions: What did the agent do? What data did it touch? Why did it make those changes? Without audit logs and visibility, agents become hard to trust and therefore scale.

And that’s before you get to everything else: persisting volumes for start/stop, backup and recovery, timeouts and resource limits for cost, tight integration with source control, image registries, identity providers, and all the editors from JetBrains to VS Code to Cursor. Secrets and environment variables, role-based access controls, MCP support, LLM and API gateway integrations, caching and performance tuning. Not to mention that building this infrastructure means **committing to owning and maintaining mission-critical infrastructure.**

At this point, some teams will still be tempted to think that coding sandboxes can fit into their existing infrastructure. But this is where **many teams discover, and often too late, that the most ‘obvious’ infrastructure primitives turn out to be the least suitable. Because agents don’t behave like the workloads those systems were designed for and the mismatch only becomes obvious once you’re deep into implementation.**

## Why the ‘obvious’ runtimes fall short

Containers, CI pipelines and Kubernetes are the primitives most teams reach for. But each encodes assumptions with implications for the capabilities of your agent sandbox. What looks like a safe choice can often become a source of friction once agents start running continuously and at scale for reasons you might not predict. The mismatch doesn’t show up immediately but instead shows up later down the line in complexity and workarounds.

![Coding sandbox primitives](/_next/image?url=%2Fimages%2Fcontent%2Fsanity%2Fprimitives.png&w=3840&q=75)
Coding sandbox primitives

-   **Containers** were never designed to be a strong security boundary. Containers share a host kernel, which makes them a poor isolation primitive for arbitrary code executing with real credentials and access to sensitive data. Once agents need realistic tooling like Docker-in-Docker, system packages, systemd, or multi-service setups, container boundaries start to leak and fail to deliver a ‘real’ development environment.
-   **CI runners** are designed for short-lived, deterministic jobs that start clean, do one thing, and disappear. Agent workloads are the opposite: long-running, stateful, iterative, and often requiring hours of continuous execution. CI’s ephemeral model forces awkward workarounds like job chaining, checkpoints, or committing half-finished work just to persist state. It also breaks down for human-agent handoff as you can’t meaningfully “step into” a running CI job to inspect, debug, or continue work.
-   **Kubernetes** inherits all the limitations of containers and comes with its own new ones. K8s excels at orchestrating predictable services, yet agents are highly stateful, interactive, and disruption intolerant. Persisting state across restarts, consistent startup times, enforcing least-privilege access all fight the platform’s assumptions. Making Kubernetes work here usually means custom scheduling and storage hacks that create significantly more platform engineering than most teams anticipate.
-   **MicroVMs** (for example, Firecracker) promise the best of both worlds: VM-level isolation with startup times in milliseconds. They achieve this by stripping away the bloat of a full operating system and booting only selected parts of the kernel. But what you gain in performance, you lose in interoperability and production parity. Additionally, MicroVMs are a low-level compute primitive, and not an ecosystem so choosing them means building your own orchestration, networking, storage, image management, and lifecycle tooling.

As you can see, the obvious runtimes all fall short in different ways. For organizations who are focused on capturing the value from coding agents by rolling out AI software engineers, running them in parallel, and applying them across the business **the faster path is to treat sandboxing as something you adopt, not something you build**, **and focus internal effort on deploying your virtual workforce** rather than reinventing the foundation. And that's where Ona helps.

## The Ona approach

Ona is built for organizations to get on with deploying AI software engineers. So if your goal is to deploy coding agents that run in parallel, in the background, and ship real work, without spending months building infrastructure, Ona is designed for you.

Critically, Ona removes operational overhead as it’s both _**self-hosted, but not self-managed**_ so runs securely inside your environment or VPC but without you having to operate any of the infrastructure or spin up a dedicated team of infrastructure engineers to support it.

You focus on deploying your hybrid workforce and let Ona handle the rest.

If you want to spend the next year transforming your organization by deploying AI software engineers, and not building sandbox infrastructure then **try Ona for free** or **get a demo**.

## Try Ona

[Start for free](https://app.ona.com)[Request a demo](/contact/demo)

### Join 440K engineers getting biweekly insights on building AI organizations and practices

Subscribe

[View past newsletters](/newsletter)