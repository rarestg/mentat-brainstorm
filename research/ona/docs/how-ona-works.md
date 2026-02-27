> ## Documentation Index
> Fetch the complete documentation index at: https://ona.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# How Ona Works

> Understand how Ona combines environments, agents, and runners to deliver a complete development platform.

Ona is the AI software engineer that works with and for your teams across the entire development lifecycle. It runs inside secure, sandboxed environments automatically set up with your code, secrets, and policies — in your cloud or ours.

## The big picture

Ona has a hybrid architecture split into two parts:

* **Management Plane** hosted by Ona. Handles authentication, organization settings, guardrails, and coordination. This is what you interact with through the dashboard, CLI, and API.
* **Runners** deployed in your cloud account (AWS, GCP) or on Ona Cloud. Runners provision and manage the actual environments where code runs. Source code, credentials, and build artifacts are managed by runners — in your infrastructure or on Ona Cloud.

This split means your source code and credentials are handled by runners, not the management plane. With [Ona Cloud](/ona/runners/ona-cloud), Ona manages the runner infrastructure for you. With a [self-hosted runner](/ona/runners/aws/overview), everything stays in your VPC.

## How a developer uses Ona

A typical workflow looks like this:

1. **Open a project** - A developer selects a repository from the dashboard, CLI, or browser extension. Ona looks up the project configuration, including which runner and environment class to use.

2. **Environment spins up** - The runner provisions an environment based on the project's [Dev Container](/ona/configuration/devcontainer/overview) configuration. Dependencies install, services start, and the workspace is ready. With [prebuilds](/ona/projects/prebuilds), startup takes seconds because dependencies are pre-installed.

3. **Connect an editor** - The developer opens the environment in their preferred editor: [VS Code](/ona/editors/vscode), [Cursor](/ona/editors/cursor), [JetBrains](/ona/editors/jetbrains), or the browser. The connection goes directly to the environment running on the runner.

4. **Work with Ona Agent** - [Ona Agent](/ona/agents/overview) is available inside the environment to assist with coding tasks: writing features, fixing bugs, running tests, and opening pull requests. It operates under the same [guardrails](/ona/guardrails/overview) as the developer.

5. **Code ships** - Changes are committed and pushed to the source control provider. Environments can be stopped or archived; they're ephemeral by design.

## What makes this different

**Ona Environments.** Sandboxed development environments with full OS-level isolation, pre-configured with your tools, dependencies, and controls. Deploy on [Ona Cloud](/ona/runners/ona-cloud) for zero setup or on your own infrastructure ([AWS](/ona/runners/aws/overview), [GCP](/ona/runners/gcp/overview)) for complete control over source, secrets, and network. Environment definitions live in your repository as `devcontainer.json` and `automations.yaml` — versioned, reviewed, and shared like any other code. For more on how the management plane and runners keep your code separate, see the [architecture overview](/ona/understanding/architecture).

**Ona Agents.** AI software engineers that run inside the same environments as developers, using the same tools and dependencies. Seamlessly transition between [Ona Agent](/ona/agents/overview) conversations, browser-based VS Code, or your desktop IDE. Agents operate under the same [guardrails](/ona/guardrails/overview) as human developers.

**Ona Guardrails.** Fine-grained organizational permissions and policies, detailed audit trails, and complete network control. [Guardrails](/ona/guardrails/overview) enforce the same rules on agents and humans: command deny lists, audit logging, and organization-level controls.

## Next steps

* [Architecture overview](/ona/understanding/architecture) - how the management plane and runners interact in detail
* [Core components](/ona/understanding/core-components) - what each part of Ona does and where to learn more
* [Introduction](/ona/getting-started) - set up your first environment
