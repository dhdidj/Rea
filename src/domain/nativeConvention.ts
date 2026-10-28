/** Path-segment conventions. These are inferences, not observations of runtime behavior. */

export type NativeRuntimeConvention = "react-native" | "flutter" | "unity";

const foldSegment = (segment: string): string =>
  segment.toLocaleLowerCase("en-US");

const REACT_NATIVE_SEGMENTS = new Set([
  "react.framework",
  "reactnative.framework",
  "libreactnative.so",
  "libreactnativejni.so",
  "libhermes_executor.so",
  "libhermes.so",
  "hermes.framework",
]);
const FLUTTER_SEGMENTS = new Set(["libflutter.so", "flutter.framework"]);
const UNITY_SEGMENTS = new Set(["libunity.so", "unityframework.framework"]);
const DESKTOP_IL2CPP_LIBRARIES = new Set([
  "gameassembly.dll",
  "gameassembly.so",
  "gameassembly.dylib",
  "libil2cpp.so",
]);

/**
 * A runtime family named by the library filename or a containing framework.
 * A library-named ancestor directory does not establish a convention.
 */
export const nativeRuntimeConvention = (
  path: string,
): NativeRuntimeConvention | null => {
  const segments = path.split("/");
  for (const [index, segment] of segments.entries()) {
    const folded = foldSegment(segment);
    if (index !== segments.length - 1 && !folded.endsWith(".framework"))
      continue;
    if (REACT_NATIVE_SEGMENTS.has(folded)) return "react-native";
    if (FLUTTER_SEGMENTS.has(folded)) return "flutter";
    if (UNITY_SEGMENTS.has(folded)) return "unity";
  }
  return null;
};

/** Swift runtime libraries are `libswift*.dylib` segments, not every dynamic library. */
export const isSwiftRuntimeLibrary = (path: string): boolean =>
  path
    .split("/")
    .some((segment) => /^libswift.+\.dylib$/u.test(foldSegment(segment)));

const hasPathSequence = (
  path: readonly string[],
  sequence: readonly string[],
) =>
  path.some((_, index) =>
    sequence.every((part, offset) => path[index + offset] === part),
  );

/** Parse desktop layout conventions once while preserving original path segments. */
export const desktopPathConventions = (path: string, rootPath?: string) => {
  const segments = path.split("/");
  const folded = segments.map(foldSegment);
  const rootContext =
    rootPath === undefined
      ? []
      : rootPath.split(/[\\/]/u).slice(-5).map(foldSegment);
  const contextualSegments = [...rootContext, ...folded];
  let unityManagedDirectory: string | null = null;
  for (let index = 0; index + 2 < contextualSegments.length; index++) {
    const segment = contextualSegments[index];
    const namedDataDirectory =
      segment !== undefined && segment.length > 5 && segment.endsWith("_data");
    const bundleDataDirectory =
      segment === "data" &&
      contextualSegments[index - 1] === "resources" &&
      contextualSegments[index - 2] === "contents";
    const editorDataDirectory =
      segment === "editor" &&
      contextualSegments[index + 1] === "data" &&
      contextualSegments[index + 2] === "managed";
    const localIndex = index - rootContext.length;
    if (editorDataDirectory) {
      unityManagedDirectory =
        localIndex < 0
          ? "Editor/Data/Managed"
          : segments.slice(0, localIndex + 3).join("/");
      continue;
    }
    if (
      (namedDataDirectory || bundleDataDirectory) &&
      contextualSegments[index + 1] === "managed"
    ) {
      unityManagedDirectory =
        localIndex < 0
          ? `${segment}/${contextualSegments[index + 1]}`
          : segments.slice(0, localIndex + 2).join("/");
    }
  }
  const name = folded.at(-1) ?? "";
  const hasContextualSequence = (...sequence: string[]) =>
    hasPathSequence(contextualSegments, sequence);
  const engineInstallationMarker =
    hasContextualSequence("editor", "unity.exe") ||
    hasContextualSequence("editor", "unity")
      ? { engine: "unity" as const, role: "editor-executable" as const }
      : folded.length === 1 &&
          (name === "modules.json" || name === "metadata.hub.json")
        ? { engine: "unity" as const, role: "installation-manifest" as const }
        : name.startsWith("godot.") &&
            name.includes(".tools.") &&
            name.endsWith(".exe")
          ? { engine: "godot" as const, role: "editor-executable" as const }
          : (hasContextualSequence("engine", "binaries", "win64") ||
                hasContextualSequence("engine", "binaries", "mac") ||
                hasContextualSequence("engine", "binaries", "linux")) &&
              (name === "unrealeditor.exe" || name === "unrealeditor")
            ? { engine: "unreal" as const, role: "editor-executable" as const }
            : hasContextualSequence("engine", "build", "build.version") &&
                name === "build.version"
              ? {
                  engine: "unreal" as const,
                  role: "installation-manifest" as const,
                }
              : name.endsWith(".uplugin") &&
                  (hasContextualSequence("engine", "plugins") ||
                    contextualSegments.includes("plugins"))
                ? {
                    engine: "unreal" as const,
                    role: "plugin-descriptor" as const,
                  }
                : null;
  return {
    unityManagedDirectory,
    engineInstallationMarker,
    il2cppLibrary: DESKTOP_IL2CPP_LIBRARIES.has(name),
    electronArchive:
      contextualSegments.at(-2) === "resources" &&
      (name === "app.asar" || name === "default_app.asar"),
    unrealContainer:
      (name.endsWith(".pak") || name.endsWith(".utoc")) &&
      contextualSegments.some(
        (segment, index) =>
          segment === "content" &&
          contextualSegments[index + 1] === "paks" &&
          index + 2 < contextualSegments.length,
      ),
  };
};
