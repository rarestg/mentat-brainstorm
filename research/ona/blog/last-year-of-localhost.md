# The last year of localhost | Ona - AI software engineers

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

Johannes Landgraf/February 13, 2026AI

# The last year of localhost

Background agents humming across a software assembly line can't run on a laptop.

![](/_next/image?url=%2Fimages%2Fcontent%2Fsanity%2Fona-rip-localhost-blog-2x.webp&w=3840&q=75)

Stripe's Minions [merge over a thousand agent-authored pull requests](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) per week. Ramp's background agent accounts for [57% of all merged PRs](https://builders.ramp.com/post/why-we-built-our-background-agent). Last week, [Ona authored 88.5% of the PRs we merged on main.](https://x.com/jolandgraf/status/2021014978367717769?s=20)

What these teams share isn't a special agent harness or a smarter model. They standardized their development environments years ago. Stripe had cloud-based devboxes before GPT-3 existed. Those investments predated the agent era by years, and now they're paying compound returns.

What's blocking your team is what has been broken all along: your development environment.

## The end of localhost

We started Gitpod (now Ona) five years ago to move software development to the cloud. To do for dev what Figma did for design. We set out to solve the 'works on my machine' problem: dev environments drift out of sync with production, with CI, with each other. Every team has slightly different setups. Onboarding takes days, sometimes months. Debugging local environment issues is a full-time job for some platform engineers. We believed the answer was cloud development environments, and we said it over and over.

Between 2020–2022 it felt like we were right. [Swyx agreed, Hacker News didn't](https://news.ycombinator.com/item?id=31669762). Then it felt like we were too early.

"[The year of the cloud development environment](https://redmonk.com/jgovernor/the-year-of-the-cloud-development-environment/)" was becoming the new "year of the Linux desktop": always right in theory, never in practice.

Cloud development environments solve real problems: environment drift, onboarding time, reproducibility. But for most developers, local setups were good enough. Apple's M1 closed the performance gap, and the pull of "just use my laptop" was strong: zero latency, years of customization, a workflow that felt like identity. The case for CDEs was real, but never urgent enough to force a move.

As with so many things, AI changed that. Fleets of agents humming across a software assembly line don't fit on a laptop. Each agent needs its own isolated, fully provisioned environment with access to internal services and production-grade toolchains. Development is finally moving to the cloud, for a reason nobody originally expected.

This time for real: with four years of delay, [localhost is going to end](https://news.ycombinator.com/item?id=31669762).

## Cloud development environments are a prerequisite for agents

Look at the companies leading the background agent wave and trace their dev infrastructure history.

Stripe built its remote development environment years ago. [As Soam Vasani described](https://www.infoq.com/presentations/stripe-dev-env-infrastructure/), every Stripe engineer gets an EC2 devbox with a Sorbet server, full monorepo checkout, and rsync from their laptop. Standardized, reproducible, managed centrally. When Stripe built Minions, their one-shot coding agent, they didn't need to figure out where the agent runs. The answer already existed: the same environment every engineer uses. Same dependencies, same test suite, same credentials and network access. That's how they went from prototype to thousands of merged PRs per week in months. The agent infrastructure was a thin layer on top of years of environment investment.

Ramp followed a similar path, [building their own background agent](https://builders.ramp.com/post/why-we-built-our-background-agent) on standardized environments and running it across their codebase. Same pattern: environment standardization first, agents on top.

The inverse is equally telling. We talk to teams that have already wired agents to their issue trackers, automatically assigning tickets and generating code. The agent can read the codebase, maybe even compile it. But it can't run the application, execute tests against real services, or validate its own work. It produces code that looks right but hasn't been tested.

The gap between "generates a diff" and "opens a merge-ready PR" is the development environment.

The companies moving fastest on agents already have a standardized, reproducible environment layer. Everyone else is discovering they need to build one first. Done right, this is a major infrastructure project before you even deploy your first agent at scale, let alone manage day-two operations.

## Why git worktrees break and localhost can't do what agents need

If you're a developer productivity engineer at a company with a monorepo, tasked by your frenetic CEO to get to the same % of PRs merged by background agents as Ramp, you've probably started with git worktrees. You want to run three agents in parallel, so you create three git worktrees. Each worktree gets its own branch, its own checkout, its own agent.

In a monorepo, this breaks immediately.

Each worktree needs its own dependency install, its own running services, its own database instance. The filesystem is shared but the runtime state is not. You end up with port conflicts, shared caches corrupting each other, and a machine that grinds to a halt. We hear this constantly from teams: three worktrees running simultaneously and the laptop becomes unusable.

The problem is amplified by what monorepo environment setup looks like. It's not "clone and run." It's install 15 tools, configure 3 databases, seed test data, start 8 services, wait for compilation. At some companies, setting up a local dev environment from scratch takes days. Doing this once is painful. Doing it 5 times in parallel on a laptop is impossible.

There's an organizational issue on top of this. Most companies have no standardized approach to running agents. Individual developers are experimenting with different tools, different setups, different workarounds. Some run agents in CI. Some try local worktrees. Some use GitHub Actions. There is no shared foundation, which means every team rediscovers the same limitations independently and your organisation doesn't get the productivity lift that your board mandates.

Agents need many environments doing many things simultaneously. This is a fundamentally different workload shape, and no amount of local hardware will solve it. You can't buy a laptop big enough to run five full monorepo environments in parallel.

## What we built (and what we got wrong along the way)

We've spent five years learning what a cloud development environment needs to serve both human engineers and autonomous agents. Some of those lessons came from getting it right. Many came from getting it wrong. [For example to not rely on Kubernetes.](https://ona.com/stories/we-are-leaving-kubernetes)

But rather than cataloging which infrastructure primitives fail (we've [written about that elsewhere](https://ona.com/stories/dont-build-a-coding-agent-sandbox)), I want to focus on what works. What properties does a cloud development environment need to serve both human engineers and autonomous agents?

### Isolation: VMs, not containers

Agents can run arbitrary code remotely. So the isolation boundary matters. Containers share a kernel with the host. A container escape gives an attacker access to every other container on the same machine: other agents, other users, other customers. For human developers, this risk is tolerable because the developer is trusted. For agents, it's not.

The right primitive is a virtual machine. Each environment gets its own kernel, memory space, and network stack. A compromised agent inside a VM cannot reach anything outside it. At Ona, every environment runs in its own VM. It's the only isolation boundary that holds when the tenant is an autonomous agent executing untrusted code.

### Declarative, reproducible environment definition

The [Dev Container spec](https://containers.dev/) is the underappreciated hero of this story. A `devcontainer.json` codifies everything an environment needs: base image, language runtimes, tool versions, editor extensions, environment variables, port forwarding, lifecycle hooks. Given this file, any machine—a human's laptop, a cloud VM, or an agent sandbox—produces an identical environment.

Dev containers have a marketing problem. Most engineers think of them as "that VS Code remote container thing." The spec is actually an open standard that solves reproducibility at the config-as-code level, the closest thing the industry has to a universal environment definition format.

When we first tackled this at Gitpod, we created `.gitpod.yml`. Naming a spec after your company is a mistake. We were genuinely happy when Microsoft pushed the Dev Container spec as an open standard building on a lot of the core ideas of our `.gitpod.yml`. That validation mattered, and it's why we adopted Dev Containers as the foundation when we rewrote Gitpod's architecture from scratch in late 2023 to be AI-first. The industry needed a vendor-neutral way to define "what does this project need to run," and Dev Containers are that.

### Automated environment lifecycle

Reproducibility alone isn't enough. The environment also needs to set itself up without human intervention.

At Ona, we solve this with an `automations.yaml` file that defines two primitives: **services** (long-running processes like databases, dev servers, language servers) and **tasks** (one-time setup like dependency installation, code generation, database migration). Each has explicit triggers: run on environment start, on prebuild, or manually. An agent's environment boots, installs dependencies, starts all required services, seeds test data, and is ready to accept work. No manual steps.

What you need are clean-room environments reliable enough for autonomous operation. The automation layer is what turns a reproducible environment into a self-assembling one.

### Connectivity and context

An agent's output is proportional to the context quality it can access. An agent running in a third-party sandbox can read your code. An agent running inside your network can read your code, query your databases, hit your internal APIs, and run your full test suite against staging. When those environments run inside the company's own cloud account, an engineer can assign a single IAM role to the instance and immediately have access to everything relevant — no tunnels, no exported secrets, no proxy hacks.

Most agent sandboxes punt on this. They give you a container or microVM in someone else's cloud and tell you to figure out networking yourself oftentimes resulting in brittle setups that break constantly.

To maximize the output of background agents they need the complete development workflow: clone, branch, install, build, test, iterate, commit, push. SCM integration, build toolchains, test runners, linters, end-to-end execution. The difference between "a container with a shell" and "a development environment" is this full loop.

At Ona, environments live inside the customer's own VPC on AWS, GCP, and soon Azure with native network access to everything a developer would have, no tunneling required. When an agent opens a pull request, it has run the same tests, linters, and build process a human engineer would. We wrote about this in more detail in ["don't build a coding agent sandbox yourself"](https://ona.com/stories/dont-build-a-coding-agent-sandbox).

### Security: assume compromise, enforce at the kernel

Agents are not trusted users. They cannot be. Anyone who tells you they've "solved" prompt injection is selling something that doesn't exist.

The right question isn't "how do we prevent compromise?" it's "what can the agent reach and attempt to compromise?"

Ona's security operates at two layers. First, credentials: environments get short-lived, scoped tokens tied to organization, project, and user. Second, kernel-level enforcement. We monitor every system call, file access, network packet, and what agents execute in the kernel. A jailbroken agent hits a wall enforced by the operating system. Policy-as-code lets organizations define hard constraints — "no public S3 buckets," "no writes to production databases" — that override agent autonomy entirely.

We're writing more about our approach to agent runtime security soon, and I'm excited to share that [Leo](https://github.com/leodido) and [Lorenzo](https://github.com/fntlnz), creators of [Falco](https://falco.org), have joined Ona.

## The compounding effect

Companies that standardized their environments now run agents in parallel, automate code review, clear backlogs overnight, and mass-refactor across hundreds of packages. Scheduled agents pick up tickets from issue trackers at 7am and have PRs ready by standup, already churning away the next task during meetings. Background agents triggered from error monitoring tools like Sentry triage and fix bugs without human initiation reducing noise and cloud bills. At Ona, we use this internally and it accelerated our engineering capacity in ways we didn't think possible.

The same infrastructure that makes an engineer productive on day one makes an agent productive on task one.

The impact extends beyond engineering. When a development environment is one click away, product managers, engineering managers and designers can access the codebase directly. A designer adjusting spacing can spin up an environment, have an agent make the change, and send a PR instead of pulling an engineer out of deep work for a trivial fix. Support teams can answer customer questions against actual source code. Onboarding a non-technical person to the local dev environment takes days of hand-holding, and the setup breaks the moment they stop maintaining it. A cloud environment that sets itself up eliminates that entirely, breaks silos and accelerates how you collaborate.

## What this means for your team

If you're evaluating background agents, start by auditing your dev environment standardization:

-   Can a new engineer go from zero to running code in one-click under 10 minutes?
-   Can you spin up 10 identical environments programmatically?
-   Is your environment definition checked into your repo?
-   Does your environment set itself up without manual steps?
-   Can your environments reach all the internal services they need, securely?
-   If an agent is compromised, what limits the blast radius? Are credentials ephemeral and cryptographically bound, or are they long-lived secrets sitting in environment variables?

If the answer to any of these is no, you will not get the lift that you expect from background agents. Regardless of how great model capability will be.

The investment in standardizing your development workflows pays dividends across human productivity, agent productivity, security posture, and onboarding. It's the foundation layer that everything else builds on.

We have been building this infrastructure for five years because we believed software development would move to the cloud.

With the arrival of background agents it's finally happening, through a different door than we expected.

We'd love to help you beat our 88.5% of merged PRs on main. The technology exists, [let's go](https://app.ona.com)!

### Join 440K engineers getting biweekly insights on building AI organizations and practices

Subscribe

[View past newsletters](/newsletter)