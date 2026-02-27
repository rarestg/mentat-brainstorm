# The Self-Driving Codebase — Background Agents and the Next Era of Enterprise Software Delivery

<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-P4LP64V" height="0" width="0" style="display:none;visibility:hidden"></iframe>

# The Self-Driving Codebase

Background agents and the next era of software delivery

Enter

Scroll down

In this report

Our systems are bottlenecked by localhost

The False Summit

The answer: agents that run in the background

Patterns of Background Agents

Establish Background Agent Primitives

Find Your Systems Bottlenecks

Build Your Software Factory

Webinars→

The self-driving codebase

# Background agents work across the entire SDLC.

Software delivery was designed around constraints of humans at keyboards. Now, agents run autonomously across thousands of repos in the background. This trend is already in motion at companies like Stripe, who recently published about their [Minions platform](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents), and [Ramp](https://builders.ramp.com/post/why-we-built-our-background-agent). Our old processes can't absorb these changes anymore. Now, every engineering leader is asking the same question: **how do we get from today's delivery process to a self-driving codebase?**

PLANCODEREVIEWTESTDEPLOY

## Our systems are bottlenecked by localhost

Autocomplete became coding agents. Coding agents became three coding agents running in parallel on your laptop. Engineers reached for worktrees, more and more terminals, spare Mac Minis. Anything to run more agents.

But localhost wasn't built for this. Agents fight over machine state, secrets become exposed, and everything stops when the machine sleeps.

That works for indie-hackers, but is **untenable for professional engineering.** We must de-couple engineers from workstations. Agents need to run in the background, securely, and at scale.

[Read: The Last Year of Localhostby Johannes Landgraf, co-founder of Ona](https://ona.com/stories/the-last-year-of-localhost?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

The false summit

## Individual speed ≠ organizational velocity.

You rolled out coding agents. Engineers are faster. PRs flood in.  
  
Yet, cycle time doesn't budge. DORA metrics are flat. The backlog grows.  
  
Because gains are compounding with the individual, not the organization. The longer you invest in coding agents without addressing the system around it, the deeper you entrench.  
**This is the false summit.**

AGENTS ON DEVELOPER MACHINESThe false summitStep 01Establish background agent primitivesStep 02Find your systems bottlenecksStep 03Scale your software factory

What is a background agent

## The answer: agents that run in the background

A coding agent needs your machine and your attention. A background agent needs neither. It runs in its own development environment in the cloud: full toolchain, test suite, everything. Completely decoupled from your device and your session.

Kick one off from your laptop, check the result from your phone. Trigger it from a PR, a Slack thread, a Linear ticket, a webhook, or just spin one up manually.

You're not steering it. You're not watching it. It's an asynchronous task: delegate, walk away, review later. It runs for as long as it needs to.

Coding agent

Background agent

Where they run

Your laptop or local machine

Cloud infrastructure, triggered remotely

How they’re triggered

You invoke them manually

Events, schedules, Slack messages, API calls — any signal

Scope

Single task in one repo

Across repos, teams, and the full SDLC

Developer’s role

In the loop — watching, steering, iterating

On the loop — prompt, walk away, review the output

Step 01

## Establish background agent primitives

Autonomous agents need infrastructure that doesn't exist on your laptop. The building blocks below are what separate a demo from a deployment — sandboxed execution, governance, connectivity to your internal systems, trigger automation, and fleet coordination. Each one unlocks the next.

Development Environment

#### The agent needs a computer

Agents running in the background need their own execution environment with a full toolchain, ability to run tests and access via secrets to systems.  
  
Environments should be isolated, and reproducible with close parity to production systems to allow fleets of agents. Everything else builds on top of this.

Pattern 1

Pattern 2

Agent has dev environment

Sandbox as toolE2B

The agent has a full development environment. A VM running a dev container with your codebase, test suite, databases, and internal network access.  
  
This is the closest to how a human developer works. Every enterprise that has shared their agent architecture publicly including Stripe and Ramp chose this pattern.

The agent runs on a server or locally. When it needs to execute code, it calls a separate remote sandbox via API. The sandbox runs the code and returns the result. This keeps secrets and execution somewhat isolated, but the agent can only execute code and not fully develop.  
  
Best suited for companies building agent products than organizations improving their own engineering workflows.

VMDev ContainerAgentCodebaseTest suiteBuild systemDatabasesInternal APIsSecretsPrivate registries

Your ServerAgentSecretsStateReasoningSandbox(container)Execute codeReturn resultAPI

[Read: Don't Build Your Own Sandboxby Lou Bichard, Field CTO at Ona](https://ona.com/stories/dont-build-a-coding-agent-sandbox?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

Governance

#### Enforced at runtime, not by prompt

Agents are actors in your system. They need the same controls as human contributors — identity, permissions, audit trails.  
  
The difference: governance enforced by a system prompt ("please don't delete files") is a suggestion. Governance enforced at the execution layer — deny lists, scoped credentials, deterministic command blocking — is actual governance. Without it, security teams veto autonomous agents entirely. And they're right to.

Context & Connectivity

#### Behind your firewall

A sandbox that can't reach your internal systems is a toy. Agents need to assume IAM roles, query database replicas, hit internal APIs, and pull from private registries — all from inside your network. Context and connectivity turn isolated execution into real work.

Triggers

#### Remove the human from the invocation loop

If every agent run starts with a developer typing a prompt, you haven't automated the workflow — just the work. Triggers connect agents to the events that matter: schedules, webhooks, system signals. Each pattern maps to a different scope and cadence.

⏱

#### Scheduled agents

Triggered on a timer. Predictable, bounded, high-volume — dependency updates, lint sweeps, coverage enforcement.

⚡︎

#### Event-driven agents

Triggered by system events — a PR opened, a CVE published, an alert fired. Reactive, concurrent, always listening.

⊞

#### Agent fleets

One task across many repositories. Each agent works independently and produces its own contribution.

◉

#### Agent swarms

Many agents, one outcome. Every agent works on a different facet and results converge into a single deliverable.

#### Mobile

Trigger one, or many agents direct from your phone, or iMessage. One text, and a fleet fans out. The new TDD, Taxi Driven Development.

Fleet Coordination

#### One intent, every repo

Updating one repository is a coding agent task. Updating 500 is a fleet task. The same sandbox, replicated across every repository that needs the change — parallel provisioning, progress tracking, aggregated results. This is where individual productivity becomes organizational throughput.

Step 02

## Find your systems bottlenecks

The primitives give you the capability. Where you apply them is what matters. That means doing the work: surveying your developers, sitting with your teams, mapping where time goes. Every organization's bottlenecks are different. The ones worth solving first aren't always obvious.

Code reviews that pile up faster than ever

PRs sit for hours while you context-switch. At scale, review queues back up and lead time stays flat despite faster coding. A background agent reviews every PR before a human sees it, so reviewers focus on design, not formatting.

Step 03

## Scale your software factory

The engineering organization is an industrial system. Today, developers stand at every station: writing, reviewing, testing. Background agents change the operating model. The factory runs, but your engineers move _on_ the loop instead of _in_ it.

PLANCODEREVIEWTESTDEPLOY

Every PR is reviewed by an agent before a human sees it

CI failures are investigated and fixed before a developer is paged

Developers never manually resolve merge conflicts on agent PRs

Agents do the first-pass investigation into every production incident

Security vulnerabilities are patched within hours, not sprints

[Read: Industrializing Software Developmentby Christian Weichel, co-founder of Ona](https://ona.com/stories/industrializing-software-development?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

Towards a self-driving codebase

## Your engineers aren't in the loop.  
They're on the loop.

The factory floor is running. Code is being written, reviewed, tested, deployed — continuously, autonomously. Your engineers are observing. Setting constraints. Verifying outcomes.

Can I just run coding agents in the background on my laptop?+

What infrastructure do background agents need?+

Are background agents safe?+

Do background agents replace developers?+

What are common use cases for background agents?+

How are background agents different from CI/CD pipelines?+

## Background agents in practice

Featured webinar

The primitives of a self-driving codebase

Why background agents can't run on localhost

Sandboxed execution, governance, context and connectivity, and orchestration for agent fleets — the infrastructure primitives that turn coding agents into a self-driving codebase.

Feb 26, 2026 · 30 min

[Register](https://ona.com/events/background-agent-primitives?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

Use-case deep dives

Webinar

CI Migrations at Scale

See how background agents automate CI pipeline migrations across hundreds of repos — no human in the loop.

Mar 4, 2026

[Register](https://ona.com/events/agent-fleet-ci-migration?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

Webinar

CVE Remediation

From disclosure to deployed fix in hours, not weeks. Background agents that patch vulnerabilities across your entire codebase.

Mar 11, 2026

[Register](https://ona.com/events/ai-cve-remediation?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

Webinar

COBOL to Java Migration

Legacy modernization with background agents — real patterns from enterprise migrations running autonomously at scale.

Mar 18, 2026

[Register](https://ona.com/events/cobol-agent-fleets?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)

## Further reading

1.  \[1\]
    
    [Why We Built Our Background Agent](https://builders.ramp.com/post/why-we-built-our-background-agent)https://builders.ramp.com/post/why-we-built-our-background-agent
    
    Ramp
2.  \[2\]
    
    [Minions: Stripe's One-Shot, End-to-End Coding Agents](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents
    
    Stripe
3.  \[3\]
    
    [Minions: Stripe's One-Shot, End-to-End Coding Agents—Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
    
    Stripe
4.  \[4\]
    
    [Time Between Disengagements: The Rise of the Software Conductor](https://ona.com/stories/time-between-disengagements-the-rise-of-the-software-conductor?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)https://ona.com/stories/time-between-disengagements-the-rise-of-the-software-conductor
    
    Ona
5.  \[5\]
    
    [Industrializing Software Development](https://ona.com/stories/industrializing-software-development?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual)https://ona.com/stories/industrializing-software-development
    
    Ona
6.  \[6\]
    
    [Towards Self-Driving Codebases](https://cursor.com/blog/long-running-agents)https://cursor.com/blog/long-running-agents
    
    Cursor
7.  \[7\]
    
    [Expanding Our Long-Running Agents Research Preview](https://cursor.com/blog/self-driving-codebases)https://cursor.com/blog/self-driving-codebases
    
    Cursor

<iframe></iframe>

## Embedded Content

<iframe></iframe>