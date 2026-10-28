# Reference engine audits

Use this workflow to collect comparable, read-only evidence from installed Unity,
Godot and Unreal distributions. It is designed for engine-wide capability audits
that cover editor tools, rendering, content, programming, plugins, platforms and
delivery. A directory marker or package inventory is evidence about shipped
artifacts; it does not prove that a feature works or how it behaves at runtime.

## Evidence contract

For each reference, record the exact product version, installation root,
operating system, architecture, source/installation origin, license or
authorization basis, and hashes of the selected evidence. The desktop scan is a
bounded sequential observation, not an atomic snapshot or a digest of every byte
under the root. Keep partial coverage, omitted paths, unavailable probes and
unknowns explicit.

Use these states in the capability matrix:

| State           | Meaning                                                               |
| --------------- | --------------------------------------------------------------------- |
| `observed`      | Directly present in the retained REA Evidence or a captured scenario. |
| `derived`       | Deterministically calculated from cited observations.                 |
| `inferred`      | A bounded interpretation that cites its evidence and limitations.     |
| `unknown`       | The evidence needed to answer the question was not collected.         |
| `unsupported`   | The selected REA provider or parser cannot produce this evidence.     |
| `contradiction` | Compatible observations disagree.                                     |

Do not turn `unknown`, `unsupported` or partial coverage into a negative claim.
Keep static package inspection separate from runtime behavior and performance.

## Collect the installation inventory

Inspect each selected installation root with the desktop application workflow:

```powershell
rea inspect-desktop-application "C:\Program Files\Unity\Hub\Editor\7000.0.0a12" `
  --detail summary --evidence_output "D:\engine-audit\unity.evidence.json" --json

rea inspect-desktop-application "C:\Program Files (x86)\Steam\steamapps\common\Godot Engine" `
  --detail summary --evidence_output "D:\engine-audit\godot.evidence.json" --json

rea inspect-desktop-application "C:\Program Files\Epic Games\UE_5.8" `
  --detail summary --evidence_output "D:\engine-audit\unreal.evidence.json" --json
```

Use new output paths; existing Evidence files are not overwritten. Retain the
complete Evidence bundle even when a summary is returned. Page the retained
`files`, `candidates`, `components`, `omissions` and `next_probes` collections to
review exact paths and coverage. Select only files relevant to the next question
instead of decoding every binary in an installation.

The scan can identify path conventions and inspect selected headers and metadata.
For example, Unity Mono/IL2CPP, Godot PCK and Unreal IoStore markers are useful
target-selection evidence. Candidate labels do not prove that the editor, module,
plugin or runtime component loaded.

### When a root scan is partial

If `source_coverage.status` is `partial` or the representation-budget limitation
is present, keep that root result as an overview only. Continue within the same
engine/version manifest by scanning the observed top-level functional
directories separately and saving one Evidence bundle per selected root. Typical
groups include Unity `Editor/Data/Managed`, `Editor/Data/PlaybackEngines`,
`Editor/Modules` and `Editor/Data/Resources`; Unreal `Engine/Binaries`,
`Engine/Content`, `Engine/Plugins`, `Engine/Programs` and `Engine/Config`; and
the Godot distribution root or separately installed export templates. Select
only directories that exist in the retained root inventory.

Record each subroot path, identity and Evidence ID. Multiple sequential scans
are still not an atomic view of the installation, and a page exhausting its
retained rows does not establish that another subroot or unread file is absent.
Do not combine the subroot snapshots into one completeness claim unless the
target boundary and every required subroot have been reconciled.

## Follow the format readers that exist today

| Reference | Available static path                                                                                                    | What it establishes                                                                                                      | What remains unknown                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unity     | Canonical Editor binary and hub/module manifest paths; Unity Editor `Data/Managed` references; IL2CPP metadata; UnityFS. | Editor installation-path evidence, managed references, supported IL2CPP metadata tables, and UnityFS container entries.  | Hub/module manifest contents, runtime binding, asset serialization semantics, scene/prefab behavior, shader execution, editor interaction and performance.                                               |
| Godot     | Tools-editor binary path convention; Godot PCK inventory for supported formats 2, 3 and 4, including validated trailers. | Editor-binary path evidence, PCK header, bounded directory entries and observed integrity results for inspected members. | Editor version/build options, encrypted or unexamined payloads, project/runtime behavior, scene semantics, editor interaction, rendering and performance.                                                |
| Unreal    | Canonical Editor binary, `Build.version` and `.uplugin` path markers; IoStore TOC signature; Unreal content paths.       | Editor installation-path evidence and plugin descriptor names by path; container-like path/header markers.               | Build-version/descriptor contents, plugin enablement/loading, and Unreal `.pak`, `.utoc` or `.ucas` content reading; asset registry, `.uasset`/`.uexp`, Blueprint/Kismet, shaders and runtime semantics. |

Use `inspect_artifact` for a supported container and preserve its complete
inventory Evidence. `compare_artifacts` compares exact occurrence paths,
identities, metadata and graph relations; it does not establish semantic parity
between different engines or product features. See the specific
[Godot PCK](godot-pck.md), [UnityFS](unityfs.md), and
[desktop application](desktop-applications.md) guides.

Unreal container and serialized asset support is tracked separately in the
[Unreal Engine analysis discussion](https://github.com/morluto/rea/issues/3625).
Do not claim that the current marker detection can list or decode container
contents.

## Cover the complete engine, not just its renderer

Create one matrix row per capability family. Include the families relevant to
the installed version, even when the result is `unknown` or `unsupported`:

- editor shell, panels, inspectors, hierarchy, asset browsers, viewports,
  canvases, HUD/UI editors, undo/redo, collaboration and accessibility;
- visual scripting, native and managed programming, language services, build
  graphs, debugging, profiling, plugins, extensions and MCP integrations;
- renderers, shader/material graphs, lighting, shadows, virtualized geometry,
  GPU backends, render targets, post-production, filters, VFX, water, weather
  and audio;
- terrain creation, sculpt/paint brushes, masks, layers, procedural content,
  PCG, simulation and world streaming;
- physics, collision shapes, queries, constraints, rigs, skinning, animation
  authoring, retargeting, importers, exporters and asset databases;
- build system, dependencies, native modules, OpenGL/OpenGL ES, Vulkan,
  WebGPU/WebGL, Rust/Cargo/FFI, WASM/Emscripten, browser, Android, iOS and
  packaging;
- memory, CPU/GPU scheduling, caching, LOD, culling, streaming, scalability,
  diagnostics and recovery.

For each row record: capability question, reference/version, direct Evidence IDs
and hashes, observed files/ranges or scenario, state, limits, the BTA subsystem
to compare, and the next discriminating probe. Separate shared engine invariants
from version-specific choices and unresolved disagreements. Treat directory or
symbol names as leads for a follow-up, not proof of implementation behavior.

## Runtime and performance follow-up

Static inventories do not prove editor workflows, runtime feature behavior or
optimization. If a later task authorizes runtime observation, select a narrow
scenario with an initial state, actions, environment, oracle and cleanup
conditions; retain the scenario as separate Evidence. Performance comparisons
require the same workload, content, output quality, hardware, build mode and
measurement method for each engine. Report raw metrics and uncertainty before
claiming that BTA is faster or more efficient.

Keep reference installations read-only. Do not bypass encryption, DRM, license
checks or access controls. Any extraction, target execution or instrumentation
must go through an explicitly selected, bounded workflow and its own permission
and cleanup contract.
