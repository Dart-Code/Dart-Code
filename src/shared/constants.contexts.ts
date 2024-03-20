// General.
export const IS_LSP_CONTEXT = "dart-code:isLsp";
export const DART_IS_CAPTURING_LOGS_CONTEXT = "dart-code:isCapturingLogs";
export const IS_RUNNING_LOCALLY_CONTEXT = "dart-code:isRunningLocally";

// Project/workspace kinds.
export const PROJECT_LOADED = "dart-code:anyProjectLoaded";
export const DART_PROJECT_LOADED = "dart-code:anyStandardDartProjectLoaded";
export const FLUTTER_PROJECT_LOADED = "dart-code:anyFlutterProjectLoaded";
export const WEB_PROJECT_LOADED = "dart-code:WebProjectLoaded";
export const DART_PLATFORM_NAME = "dart-code:dartPlatformName";

// SDK version specific.
export const SDK_IS_PRE_RELEASE = "dart-code:isPreReleaseSdk";
export const PUB_OUTDATED_SUPPORTED_CONTEXT = "dart-code:pubOutdatedSupported";
export const FLUTTER_SIDEBAR_SUPPORTED_CONTEXT = "dart-code:flutterSidebarSupported";
export const SUPPORTS_DEBUG_VALUE_FORMAT = "dart-code:supportsDebugValueFormat";
export const DTD_AVAILABLE = "dart-code:dtdAvailable";
export const LSP_COMMAND_CONTEXT_PREFIX = "dart-code:lsp.command.";
export const LSP_REQUEST_CONTEXT_PREFIX = "dart-code:lsp.request.";
export const FLUTTER_SUPPORTS_ATTACH = "dart-code:flutterSupportsAttach";

// Debug session related.
export const SERVICE_EXTENSION_CONTEXT_PREFIX = "dart-code:serviceExtension.";
export const SERVICE_CONTEXT_PREFIX = "dart-code:service.";
export const HAS_LAST_DEBUG_CONFIG = "dart-code:hasLastDebugConfig";
export const HAS_LAST_TEST_DEBUG_CONFIG = "dart-code:hasLastTestDebugConfig";
export const isInDartDebugSessionContext = "dart-code:isInDartDebugSession";
export const isInFlutterDebugModeDebugSessionContext = "dart-code:isInFlutterDebugModeDebugSession";
export const isInFlutterProfileModeDebugSessionContext = "dart-code:isInFlutterProfileModeDebugSession";
export const isInFlutterReleaseModeDebugSessionContext = "dart-code:isInFlutterReleaseModeDebugSession";

// Dependencies tree.
export const DART_DEP_PROJECT_NODE_CONTEXT = "dart-code:depProjectNode";
export const DART_DEP_DEPENDENCIES_NODE_CONTEXT = "dart-code:depDependenciesNode";
export const DART_DEP_DEV_DEPENDENCIES_NODE_CONTEXT = "dart-code:depDevDependenciesNode";
export const DART_DEP_TRANSITIVE_DEPENDENCIES_NODE_CONTEXT = "dart-code:depTransitiveDependenciesNode";
export const DART_DEP_PACKAGE_NODE_CONTEXT = "dart-code:depPackageNode";
export const DART_DEP_DEPENDENCY_PACKAGE_NODE_CONTEXT = "dart-code:depDependencyPackageNode";
export const DART_DEP_DEV_DEPENDENCY_PACKAGE_NODE_CONTEXT = "dart-code:depDevDependencyPackageNode";
export const DART_DEP_TRANSITIVE_DEPENDENCY_PACKAGE_NODE_CONTEXT = "dart-code:depTransitiveDependencyPackageNode";
export const DART_DEP_FOLDER_NODE_CONTEXT = "dart-code:depFolderNode";
export const DART_DEP_FILE_NODE_CONTEXT = "dart-code:depFileNode";
