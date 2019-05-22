// This file was code-generated from the Analysis Server API doc
// and should not be hand-edited!
// https://github.com/Dart-Code/analysis-server-typescript-generator

"use strict";

/**
 * Return the version number of the analysis server.
 */
export interface ServerGetVersionResponse {
	/**
	 * The version number of the analysis server.
	 */
	version: string;
}

/**
 * Subscribe for services. All previous subscriptions are
 * replaced by the given set of services.
 * 
 * It is an error if any of the elements in the list are not
 * valid services. If there is an error, then the current
 * subscriptions will remain unchanged.
 */
export interface ServerSetSubscriptionsRequest {
	/**
	 * A list of the services being subscribed to.
	 */
	subscriptions: ServerService[];
}

/**
 * Return the errors associated with the given file. If the
 * errors for the given file have not yet been computed, or the
 * most recently computed errors for the given file are out of
 * date, then the response for this request will be delayed
 * until they have been computed. If some or all of the errors
 * for the file cannot be computed, then the subset of the
 * errors that can be computed will be returned and the
 * response will contain an error to indicate why the errors
 * could not be computed. If the content of the file changes after this
 * request was received but before a response could be sent, then an
 * error of type CONTENT_MODIFIED will be generated.
 * 
 * This request is intended to be used by clients that cannot
 * asynchronously apply updated error information. Clients that
 * can apply error information as it becomes available
 * should use the information provided by the 'analysis.errors'
 * notification.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_ERRORS_INVALID_FILE will be generated.
 */
export interface AnalysisGetErrorsRequest {
	/**
	 * The file for which errors are being requested.
	 */
	file: FilePath;
}

/**
 * Return the errors associated with the given file. If the
 * errors for the given file have not yet been computed, or the
 * most recently computed errors for the given file are out of
 * date, then the response for this request will be delayed
 * until they have been computed. If some or all of the errors
 * for the file cannot be computed, then the subset of the
 * errors that can be computed will be returned and the
 * response will contain an error to indicate why the errors
 * could not be computed. If the content of the file changes after this
 * request was received but before a response could be sent, then an
 * error of type CONTENT_MODIFIED will be generated.
 * 
 * This request is intended to be used by clients that cannot
 * asynchronously apply updated error information. Clients that
 * can apply error information as it becomes available
 * should use the information provided by the 'analysis.errors'
 * notification.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_ERRORS_INVALID_FILE will be generated.
 */
export interface AnalysisGetErrorsResponse {
	/**
	 * The errors associated with the file.
	 */
	errors: AnalysisError[];
}

/**
 * Return the hover information associate with the given
 * location. If some or all of the hover information is not
 * available at the time this request is processed the
 * information will be omitted from the response.
 */
export interface AnalysisGetHoverRequest {
	/**
	 * The file in which hover information is being requested.
	 */
	file: FilePath;

	/**
	 * The offset for which hover information is being requested.
	 */
	offset: number;
}

/**
 * Return the hover information associate with the given
 * location. If some or all of the hover information is not
 * available at the time this request is processed the
 * information will be omitted from the response.
 */
export interface AnalysisGetHoverResponse {
	/**
	 * The hover information associated with the
	 * location. The list will be empty if no information
	 * could be determined for the location. The list can
	 * contain multiple items if the file is being analyzed
	 * in multiple contexts in conflicting ways (such as a
	 * part that is included in multiple libraries).
	 */
	hovers: HoverInformation[];
}

/**
 * Return a description of all of the elements referenced in a given region
 * of a given file that come from imported libraries.
 * 
 * If a request is made for a file that does not exist, or that is not
 * currently subject to analysis (e.g. because it is not associated with any
 * analysis root specified via analysis.setAnalysisRoots), an error of type
 * GET_IMPORTED_ELEMENTS_INVALID_FILE will be generated.
 */
export interface AnalysisGetImportedElementsRequest {
	/**
	 * The file in which import information is being requested.
	 */
	file: FilePath;

	/**
	 * The offset of the region for which import information is being
	 * requested.
	 */
	offset: number;

	/**
	 * The length of the region for which import information is being
	 * requested.
	 */
	length: number;
}

/**
 * Return a description of all of the elements referenced in a given region
 * of a given file that come from imported libraries.
 * 
 * If a request is made for a file that does not exist, or that is not
 * currently subject to analysis (e.g. because it is not associated with any
 * analysis root specified via analysis.setAnalysisRoots), an error of type
 * GET_IMPORTED_ELEMENTS_INVALID_FILE will be generated.
 */
export interface AnalysisGetImportedElementsResponse {
	/**
	 * The information about the elements that are referenced in the
	 * specified region of the specified file that come from imported
	 * libraries.
	 */
	elements: ImportedElements[];
}

/**
 * Return library dependency information for use in client-side indexing
 * and package URI resolution.
 * 
 * Clients that are only using the libraries field should consider using the
 * analyzedFiles notification instead.
 */
export interface AnalysisGetLibraryDependenciesResponse {
	/**
	 * A list of the paths of library elements referenced by
	 * files in existing analysis roots.
	 */
	libraries: FilePath[];

	/**
	 * A mapping from context source roots to package maps which map
	 * package names to source directories for use in client-side
	 * package URI resolution.
	 */
	packageMap: { [key: string]: { [key: string]: FilePath[] | undefined; } | undefined; };
}

/**
 * Return the navigation information associated with the given region of
 * the given file. If the navigation information for the given file has
 * not yet been computed, or the most recently computed navigation
 * information for the given file is out of date, then the response for
 * this request will be delayed until it has been computed. If the
 * content of the file changes after this request was received but before
 * a response could be sent, then an error of type
 * CONTENT_MODIFIED will be generated.
 * 
 * If a navigation region overlaps (but extends either before or after)
 * the given region of the file it will be included in the result. This
 * means that it is theoretically possible to get the same navigation
 * region in response to multiple requests. Clients can avoid this by
 * always choosing a region that starts at the beginning of a line and
 * ends at the end of a (possibly different) line in the file.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_NAVIGATION_INVALID_FILE will be generated.
 */
export interface AnalysisGetNavigationRequest {
	/**
	 * The file in which navigation information is being requested.
	 */
	file: FilePath;

	/**
	 * The offset of the region for which navigation information is being
	 * requested.
	 */
	offset: number;

	/**
	 * The length of the region for which navigation information is being
	 * requested.
	 */
	length: number;
}

/**
 * Return the navigation information associated with the given region of
 * the given file. If the navigation information for the given file has
 * not yet been computed, or the most recently computed navigation
 * information for the given file is out of date, then the response for
 * this request will be delayed until it has been computed. If the
 * content of the file changes after this request was received but before
 * a response could be sent, then an error of type
 * CONTENT_MODIFIED will be generated.
 * 
 * If a navigation region overlaps (but extends either before or after)
 * the given region of the file it will be included in the result. This
 * means that it is theoretically possible to get the same navigation
 * region in response to multiple requests. Clients can avoid this by
 * always choosing a region that starts at the beginning of a line and
 * ends at the end of a (possibly different) line in the file.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_NAVIGATION_INVALID_FILE will be generated.
 */
export interface AnalysisGetNavigationResponse {
	/**
	 * A list of the paths of files that are referenced by the navigation
	 * targets.
	 */
	files: FilePath[];

	/**
	 * A list of the navigation targets that are referenced by the
	 * navigation regions.
	 */
	targets: NavigationTarget[];

	/**
	 * A list of the navigation regions within the requested region of
	 * the file.
	 */
	regions: NavigationRegion[];
}

/**
 * Return the transitive closure of reachable sources for a given file.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_REACHABLE_SOURCES_INVALID_FILE will be generated.
 */
export interface AnalysisGetReachableSourcesRequest {
	/**
	 * The file for which reachable source information is being requested.
	 */
	file: FilePath;
}

/**
 * Return the transitive closure of reachable sources for a given file.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_REACHABLE_SOURCES_INVALID_FILE will be generated.
 */
export interface AnalysisGetReachableSourcesResponse {
	/**
	 * A mapping from source URIs to directly reachable source URIs. For
	 * example,
	 * a file "foo.dart" that imports "bar.dart" would have the corresponding
	 * mapping
	 * { "file:///foo.dart" : ["file:///bar.dart"] }. If "bar.dart" has
	 * further imports
	 * (or exports) there will be a mapping from the URI "file:///bar.dart"
	 * to them.
	 * To check if a specific URI is reachable from a given file, clients can
	 * check
	 * for its presence in the resulting key set.
	 */
	sources: { [key: string]: string[] | undefined; };
}

/**
 * Return the signature information associated with the given
 * location in the given file. If the signature information
 * for the given file has not yet been computed, or the most
 * recently computed signature information for the given file
 * is out of date, then the response for this request will be
 * delayed until it has been computed.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_SIGNATURE_INVALID_FILE will be generated.
 * 
 * If the location given is not inside the argument list for a
 * function (including method and constructor) invocation, then
 * an error of type GET_SIGNATURE_INVALID_OFFSET will
 * be generated. If the location is inside an argument list but
 * the function is not defined or cannot be determined (such as
 * a method invocation where the target has type 'dynamic')
 * then an error of type GET_SIGNATURE_UNKNOWN_FUNCTION
 * will be generated.
 */
export interface AnalysisGetSignatureRequest {
	/**
	 * The file in which signature information is being requested.
	 */
	file: FilePath;

	/**
	 * The location for which signature information is being requested.
	 */
	offset: number;
}

/**
 * Return the signature information associated with the given
 * location in the given file. If the signature information
 * for the given file has not yet been computed, or the most
 * recently computed signature information for the given file
 * is out of date, then the response for this request will be
 * delayed until it has been computed.
 * 
 * If a request is made for a file which does not exist, or
 * which is not currently subject to analysis (e.g. because it
 * is not associated with any analysis root specified to
 * analysis.setAnalysisRoots), an error of type
 * GET_SIGNATURE_INVALID_FILE will be generated.
 * 
 * If the location given is not inside the argument list for a
 * function (including method and constructor) invocation, then
 * an error of type GET_SIGNATURE_INVALID_OFFSET will
 * be generated. If the location is inside an argument list but
 * the function is not defined or cannot be determined (such as
 * a method invocation where the target has type 'dynamic')
 * then an error of type GET_SIGNATURE_UNKNOWN_FUNCTION
 * will be generated.
 */
export interface AnalysisGetSignatureResponse {
	/**
	 * The name of the function being invoked at the given offset.
	 */
	name: string;

	/**
	 * A list of information about each of the parameters of the function being invoked.
	 */
	parameters: ParameterInfo[];

	/**
	 * The dartdoc associated with the function being invoked. Other
	 * than the removal of the comment delimiters, including leading
	 * asterisks in the case of a block comment, the dartdoc is
	 * unprocessed markdown. This data is omitted if there is no
	 * referenced element, or if the element has no dartdoc.
	 */
	dartdoc?: string;
}

/**
 * Sets the root paths used to determine which files to analyze. The set
 * of files to be analyzed are all of the files in one of the root paths
 * that are not either explicitly or implicitly excluded. A file is
 * explicitly excluded if it is in one of the excluded paths. A file is
 * implicitly excluded if it is in a subdirectory of one of the root
 * paths where the name of the subdirectory starts with a period (that
 * is, a hidden directory).
 * 
 * Note that this request determines the set of requested
 * analysis roots. The actual set of analysis roots at any
 * given time is the intersection of this set with the set of
 * files and directories actually present on the
 * filesystem. When the filesystem changes, the actual set of
 * analysis roots is automatically updated, but the set of
 * requested analysis roots is unchanged. This means that if
 * the client sets an analysis root before the root becomes
 * visible to server in the filesystem, there is no error; once
 * the server sees the root in the filesystem it will start
 * analyzing it. Similarly, server will stop analyzing files
 * that are removed from the file system but they will remain
 * in the set of requested roots.
 * 
 * If an included path represents a file, then server will look
 * in the directory containing the file for a pubspec.yaml
 * file. If none is found, then the parents of the directory
 * will be searched until such a file is found or the root of
 * the file system is reached. If such a file is found, it will
 * be used to resolve package: URI’s within the file.
 */
export interface AnalysisSetAnalysisRootsRequest {
	/**
	 * A list of the files and directories that should be
	 * analyzed.
	 */
	included: FilePath[];

	/**
	 * A list of the files and directories within the
	 * included directories that should not be analyzed.
	 */
	excluded: FilePath[];

	/**
	 * A mapping from source directories to package roots
	 * that should override the normal package: URI resolution
	 * mechanism.
	 * 
	 * If a package root is a directory, then
	 * the analyzer will behave as though the associated
	 * source directory in the map contains a special
	 * pubspec.yaml file which resolves any package: URI to the
	 * corresponding path within that package root directory. The
	 * effect is the same as specifying the package root directory as
	 * a "--package_root" parameter to the Dart VM when
	 * executing any Dart file inside the source directory.
	 * 
	 * If a package root is a file, then the analyzer
	 * will behave as though that file is a ".packages" file in the
	 * source directory. The effect is the same as specifying the file
	 * as a "--packages" parameter to the Dart VM when
	 * executing any Dart file inside the source directory.
	 * 
	 * Files in any directories that are not overridden by this
	 * mapping have their package: URI's resolved using the
	 * normal pubspec.yaml mechanism. If this field is absent,
	 * or the empty map is specified, that indicates that the
	 * normal pubspec.yaml mechanism should always be used.
	 */
	packageRoots?: { [key: string]: FilePath | undefined; };
}

/**
 * Subscribe for general services (that is, services that are not
 * specific to individual files). All previous subscriptions are replaced
 * by the given set of services.
 * 
 * It is an error if any of the elements in the list are not valid
 * services. If there is an error, then the current subscriptions will
 * remain unchanged.
 */
export interface AnalysisSetGeneralSubscriptionsRequest {
	/**
	 * A list of the services being subscribed to.
	 */
	subscriptions: GeneralAnalysisService[];
}

/**
 * Set the priority files to the files in the given list. A
 * priority file is a file that is given priority when
 * scheduling which analysis work to do first. The list
 * typically contains those files that are visible to the user
 * and those for which analysis results will have the biggest
 * impact on the user experience. The order of the files within
 * the list is significant: the first file will be given higher
 * priority than the second, the second higher priority than
 * the third, and so on.
 * 
 * Note that this request determines the set of requested
 * priority files. The actual set of priority files is the
 * intersection of the requested set of priority files with the
 * set of files currently subject to analysis. (See
 * analysis.setSubscriptions for a description of files that
 * are subject to analysis.)
 * 
 * If a requested priority file is a directory it is ignored,
 * but remains in the set of requested priority files so that
 * if it later becomes a file it can be included in the set of
 * actual priority files.
 */
export interface AnalysisSetPriorityFilesRequest {
	/**
	 * The files that are to be a priority for analysis.
	 */
	files: FilePath[];
}

/**
 * Subscribe for services that are specific to individual files.
 * All previous subscriptions are replaced by the current set of
 * subscriptions. If a given service is not included as a key in the map
 * then no files will be subscribed to the service, exactly as if the
 * service had been included in the map with an explicit empty list of
 * files.
 * 
 * Note that this request determines the set of requested
 * subscriptions. The actual set of subscriptions at any given
 * time is the intersection of this set with the set of files
 * currently subject to analysis. The files currently subject
 * to analysis are the set of files contained within an actual
 * analysis root but not excluded, plus all of the files
 * transitively reachable from those files via import, export
 * and part directives. (See analysis.setAnalysisRoots for an
 * explanation of how the actual analysis roots are
 * determined.) When the actual analysis roots change, the
 * actual set of subscriptions is automatically updated, but
 * the set of requested subscriptions is unchanged.
 * 
 * If a requested subscription is a directory it is ignored,
 * but remains in the set of requested subscriptions so that if
 * it later becomes a file it can be included in the set of
 * actual subscriptions.
 * 
 * It is an error if any of the keys in the map are not valid
 * services. If there is an error, then the existing
 * subscriptions will remain unchanged.
 */
export interface AnalysisSetSubscriptionsRequest {
	/**
	 * A table mapping services to a list of the files being
	 * subscribed to the service.
	 */
	subscriptions: { [key: string]: FilePath[] | undefined; };
}

/**
 * Update the content of one or more files. Files that were
 * previously updated but not included in this update remain
 * unchanged. This effectively represents an overlay of the
 * filesystem. The files whose content is overridden are
 * therefore seen by server as being files with the given
 * content, even if the files do not exist on the filesystem or
 * if the file path represents the path to a directory on the
 * filesystem.
 */
export interface AnalysisUpdateContentRequest {
	/**
	 * A table mapping the files whose content has changed to a
	 * description of the content change.
	 */
	files: { [key: string]: AddContentOverlay | ChangeContentOverlay | RemoveContentOverlay | undefined; };
}

/**
 * Deprecated: all of the options can be set by users in
 * an analysis options file.
 * 
 * Update the options controlling analysis based on the given
 * set of options. Any options that are not included in the
 * analysis options will not be changed. If there are options
 * in the analysis options that are not valid, they will be
 * silently ignored.
 */
export interface AnalysisUpdateOptionsRequest {
	/**
	 * The options that are to be used to control analysis.
	 */
	options: AnalysisOptions;
}

/**
 * Request that completion suggestions for the given offset in
 * the given file be returned.
 */
export interface CompletionGetSuggestionsRequest {
	/**
	 * The file containing the point at which suggestions are
	 * to be made.
	 */
	file: FilePath;

	/**
	 * The offset within the file at which suggestions are to
	 * be made.
	 */
	offset: number;
}

/**
 * Request that completion suggestions for the given offset in
 * the given file be returned.
 */
export interface CompletionGetSuggestionsResponse {
	/**
	 * The identifier used to associate results with this
	 * completion request.
	 */
	id: CompletionId;
}

/**
 * Subscribe for completion services. All previous subscriptions are
 * replaced by the given set of services.
 * 
 * It is an error if any of the elements in the list are not valid
 * services. If there is an error, then the current subscriptions will
 * remain unchanged.
 */
export interface CompletionSetSubscriptionsRequest {
	/**
	 * A list of the services being subscribed to.
	 */
	subscriptions: CompletionService[];
}

/**
 * The client can make this request to express interest in certain
 * libraries to receive completion suggestions from based on the client path.
 * If this request is received before the client has used
 * 'completion.setSubscriptions' to subscribe to the AVAILABLE_SUGGESTION_SETS
 * service, then an error of type NOT_SUBSCRIBED_TO_AVAILABLE_SUGGESTION_SETS
 * will be generated. All previous paths are replaced by the given set of paths.
 */
export interface CompletionRegisterLibraryPathsRequest {
	/**
	 * A list of objects each containing a path and the additional libraries from which
	 * the client is interested in receiving completion suggestions.
	 * If one configured path is beneath another, the descendent
	 * will override the ancestors' configured libraries of interest.
	 */
	paths: LibraryPathSet[];
}

/**
 * Clients must make this request when the user has selected a completion
 * suggestion from an AvailableSuggestionSet. Analysis server will respond with
 * the text to insert as well as any SourceChange that needs to be applied
 * in case the completion requires an additional import to be added. It is an error
 * if the id is no longer valid, for instance if the library has been removed after
 * the completion suggestion is accepted.
 */
export interface CompletionGetSuggestionDetailsRequest {
	/**
	 * The path of the file into which this completion is being inserted.
	 */
	file: FilePath;

	/**
	 * The identifier of the AvailableSuggestionSet containing
	 * the selected label.
	 */
	id: number;

	/**
	 * The label from the AvailableSuggestionSet with the `id`
	 * for which insertion information is requested.
	 */
	label: string;

	/**
	 * The offset in the file where the completion will be inserted.
	 */
	offset: number;
}

/**
 * Clients must make this request when the user has selected a completion
 * suggestion from an AvailableSuggestionSet. Analysis server will respond with
 * the text to insert as well as any SourceChange that needs to be applied
 * in case the completion requires an additional import to be added. It is an error
 * if the id is no longer valid, for instance if the library has been removed after
 * the completion suggestion is accepted.
 */
export interface CompletionGetSuggestionDetailsResponse {
	/**
	 * The full text to insert, including any optional import prefix.
	 */
	completion: string;

	/**
	 * A change for the client to apply in case the library containing
	 * the accepted completion suggestion needs to be imported. The field
	 * will be omitted if there are no additional changes that need to be made.
	 */
	change?: SourceChange;
}

/**
 * Inspect analysis server's knowledge about all of a file's tokens including
 * their lexeme, type, and what element kinds would have been appropriate for
 * the token's program location.
 */
export interface CompletionListTokenDetailsRequest {
	/**
	 * The path to the file from which tokens should be returned.
	 */
	file: FilePath;
}

/**
 * Inspect analysis server's knowledge about all of a file's tokens including
 * their lexeme, type, and what element kinds would have been appropriate for
 * the token's program location.
 */
export interface CompletionListTokenDetailsResponse {
	/**
	 * A list of the file's scanned tokens including analysis information
	 * about them.
	 */
	tokens: TokenDetails[];
}

/**
 * Perform a search for references to the element defined or
 * referenced at the given offset in the given file.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindElementReferencesRequest {
	/**
	 * The file containing the declaration of or reference to
	 * the element used to define the search.
	 */
	file: FilePath;

	/**
	 * The offset within the file of the declaration of or
	 * reference to the element.
	 */
	offset: number;

	/**
	 * True if potential matches are to be included in the
	 * results.
	 */
	includePotential: boolean;
}

/**
 * Perform a search for references to the element defined or
 * referenced at the given offset in the given file.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindElementReferencesResponse {
	/**
	 * The identifier used to associate results with this
	 * search request.
	 * 
	 * If no element was found at the given location, this
	 * field will be absent, and no results will be reported
	 * via the search.results notification.
	 */
	id?: SearchId;

	/**
	 * The element referenced or defined at the given offset
	 * and whose references will be returned in the search
	 * results.
	 * 
	 * If no element was found at the given location, this
	 * field will be absent.
	 */
	element?: Element;
}

/**
 * Perform a search for declarations of members whose name is
 * equal to the given name.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindMemberDeclarationsRequest {
	/**
	 * The name of the declarations to be found.
	 */
	name: string;
}

/**
 * Perform a search for declarations of members whose name is
 * equal to the given name.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindMemberDeclarationsResponse {
	/**
	 * The identifier used to associate results with this
	 * search request.
	 */
	id: SearchId;
}

/**
 * Perform a search for references to members whose name is
 * equal to the given name. This search does not check to see
 * that there is a member defined with the given name, so it is
 * able to find references to undefined members as well.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindMemberReferencesRequest {
	/**
	 * The name of the references to be found.
	 */
	name: string;
}

/**
 * Perform a search for references to members whose name is
 * equal to the given name. This search does not check to see
 * that there is a member defined with the given name, so it is
 * able to find references to undefined members as well.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindMemberReferencesResponse {
	/**
	 * The identifier used to associate results with this
	 * search request.
	 */
	id: SearchId;
}

/**
 * Perform a search for declarations of top-level elements
 * (classes, typedefs, getters, setters, functions and fields)
 * whose name matches the given pattern.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindTopLevelDeclarationsRequest {
	/**
	 * The regular expression used to match the names of the
	 * declarations to be found.
	 */
	pattern: string;
}

/**
 * Perform a search for declarations of top-level elements
 * (classes, typedefs, getters, setters, functions and fields)
 * whose name matches the given pattern.
 * 
 * An identifier is returned immediately, and individual
 * results will be returned via the search.results notification
 * as they become available.
 */
export interface SearchFindTopLevelDeclarationsResponse {
	/**
	 * The identifier used to associate results with this
	 * search request.
	 */
	id: SearchId;
}

/**
 * Return top-level and class member declarations.
 */
export interface SearchGetElementDeclarationsRequest {
	/**
	 * If this field is provided, return only declarations in this file.
	 * If this field is missing, return declarations in all files.
	 */
	file?: FilePath;

	/**
	 * The regular expression used to match the names of declarations.
	 * If this field is missing, return all declarations.
	 */
	pattern?: string;

	/**
	 * The maximum number of declarations to return.
	 * If this field is missing, return all matching declarations.
	 */
	maxResults?: number;
}

/**
 * Return top-level and class member declarations.
 */
export interface SearchGetElementDeclarationsResponse {
	/**
	 * The list of declarations.
	 */
	declarations: ElementDeclaration[];

	/**
	 * The list of the paths of files with declarations.
	 */
	files: FilePath[];
}

/**
 * Return the type hierarchy of the class declared or
 * referenced at the given location.
 */
export interface SearchGetTypeHierarchyRequest {
	/**
	 * The file containing the declaration or reference to the
	 * type for which a hierarchy is being requested.
	 */
	file: FilePath;

	/**
	 * The offset of the name of the type within the file.
	 */
	offset: number;

	/**
	 * True if the client is only requesting superclasses and
	 * interfaces hierarchy.
	 */
	superOnly?: boolean;
}

/**
 * Return the type hierarchy of the class declared or
 * referenced at the given location.
 */
export interface SearchGetTypeHierarchyResponse {
	/**
	 * A list of the types in the requested hierarchy. The
	 * first element of the list is the item representing the
	 * type for which the hierarchy was requested. The index of
	 * other elements of the list is unspecified, but
	 * correspond to the integers used to reference supertype
	 * and subtype items within the items.
	 * 
	 * This field will be absent if the code at the given file
	 * and offset does not represent a type, or if the file has
	 * not been sufficiently analyzed to allow a type hierarchy
	 * to be produced.
	 */
	hierarchyItems?: TypeHierarchyItem[];
}

/**
 * Format the contents of a single file. The currently selected region of
 * text is passed in so that the selection can be preserved across the
 * formatting operation. The updated selection will be as close to
 * matching the original as possible, but whitespace at the beginning or
 * end of the selected region will be ignored. If preserving selection
 * information is not required, zero (0) can be specified for both the
 * selection offset and selection length.
 * 
 * If a request is made for a file which does not exist, or which is not
 * currently subject to analysis (e.g. because it is not associated with
 * any analysis root specified to analysis.setAnalysisRoots), an error of
 * type FORMAT_INVALID_FILE will be generated. If the source
 * contains syntax errors, an error of type FORMAT_WITH_ERRORS
 * will be generated.
 */
export interface EditFormatRequest {
	/**
	 * The file containing the code to be formatted.
	 */
	file: FilePath;

	/**
	 * The offset of the current selection in the file.
	 */
	selectionOffset: number;

	/**
	 * The length of the current selection in the file.
	 */
	selectionLength: number;

	/**
	 * The line length to be used by the formatter.
	 */
	lineLength?: number;
}

/**
 * Format the contents of a single file. The currently selected region of
 * text is passed in so that the selection can be preserved across the
 * formatting operation. The updated selection will be as close to
 * matching the original as possible, but whitespace at the beginning or
 * end of the selected region will be ignored. If preserving selection
 * information is not required, zero (0) can be specified for both the
 * selection offset and selection length.
 * 
 * If a request is made for a file which does not exist, or which is not
 * currently subject to analysis (e.g. because it is not associated with
 * any analysis root specified to analysis.setAnalysisRoots), an error of
 * type FORMAT_INVALID_FILE will be generated. If the source
 * contains syntax errors, an error of type FORMAT_WITH_ERRORS
 * will be generated.
 */
export interface EditFormatResponse {
	/**
	 * The edit(s) to be applied in order to format the code. The list
	 * will be empty if the code was already formatted (there are no
	 * changes).
	 */
	edits: SourceEdit[];

	/**
	 * The offset of the selection after formatting the code.
	 */
	selectionOffset: number;

	/**
	 * The length of the selection after formatting the code.
	 */
	selectionLength: number;
}

/**
 * Return the set of assists that are available at the given
 * location. An assist is distinguished from a refactoring
 * primarily by the fact that it affects a single file and does
 * not require user input in order to be performed.
 */
export interface EditGetAssistsRequest {
	/**
	 * The file containing the code for which assists are being
	 * requested.
	 */
	file: FilePath;

	/**
	 * The offset of the code for which assists are being
	 * requested.
	 */
	offset: number;

	/**
	 * The length of the code for which assists are being
	 * requested.
	 */
	length: number;
}

/**
 * Return the set of assists that are available at the given
 * location. An assist is distinguished from a refactoring
 * primarily by the fact that it affects a single file and does
 * not require user input in order to be performed.
 */
export interface EditGetAssistsResponse {
	/**
	 * The assists that are available at the given location.
	 */
	assists: SourceChange[];
}

/**
 * Get a list of the kinds of refactorings that are valid for
 * the given selection in the given file.
 */
export interface EditGetAvailableRefactoringsRequest {
	/**
	 * The file containing the code on which the refactoring
	 * would be based.
	 */
	file: FilePath;

	/**
	 * The offset of the code on which the refactoring would be
	 * based.
	 */
	offset: number;

	/**
	 * The length of the code on which the refactoring would be
	 * based.
	 */
	length: number;
}

/**
 * Get a list of the kinds of refactorings that are valid for
 * the given selection in the given file.
 */
export interface EditGetAvailableRefactoringsResponse {
	/**
	 * The kinds of refactorings that are valid for the given
	 * selection.
	 */
	kinds: RefactoringKind[];
}

/**
 * Request information about edit.dartfix
 * such as the list of known fixes that can be specified
 * in an edit.dartfix request.
 */
export interface EditGetDartfixInfoResponse {
	/**
	 * A list of fixes that can be specified
	 * in an edit.dartfix request.
	 */
	fixes: DartFix[];
}

/**
 * Analyze the specified sources for recommended changes
 * and return a set of suggested edits for those sources.
 * These edits may include changes to sources outside the set
 * of specified sources if a change in a specified source requires it.
 * 
 * If includedFixes is specified, then those fixes will be applied.
 * If includeRequiredFixes is specified, then "required" fixes will be applied
 * in addition to whatever fixes are specified in includedFixes if any.
 * If neither includedFixes nor includeRequiredFixes is specified,
 * then all fixes will be applied.
 * If excludedFixes is specified, then those fixes will not be applied
 * regardless of whether they are "required" or specified in includedFixes.
 */
export interface EditDartfixRequest {
	/**
	 * A list of the files and directories for which edits should be suggested.
	 * 
	 * If a request is made with a path that is invalid, e.g. is not absolute and normalized,
	 * an error of type INVALID_FILE_PATH_FORMAT will be generated.
	 * If a request is made for a file which does not exist, or which is not currently subject to analysis
	 * (e.g. because it is not associated with any analysis root specified to analysis.setAnalysisRoots),
	 * an error of type FILE_NOT_ANALYZED will be generated.
	 */
	included: FilePath[];

	/**
	 * A list of names indicating which fixes should be applied.
	 * 
	 * If a name is specified that does not match the name of a known fix,
	 * an error of type UNKNOWN_FIX will be generated.
	 */
	includedFixes?: string[];

	/**
	 * A flag indicating that "required" fixes should be applied.
	 */
	includeRequiredFixes?: boolean;

	/**
	 * A list of names indicating which fixes should not be applied.
	 * 
	 * If a name is specified that does not match the name of a known fix,
	 * an error of type UNKNOWN_FIX will be generated.
	 */
	excludedFixes?: string[];
}

/**
 * Analyze the specified sources for recommended changes
 * and return a set of suggested edits for those sources.
 * These edits may include changes to sources outside the set
 * of specified sources if a change in a specified source requires it.
 * 
 * If includedFixes is specified, then those fixes will be applied.
 * If includeRequiredFixes is specified, then "required" fixes will be applied
 * in addition to whatever fixes are specified in includedFixes if any.
 * If neither includedFixes nor includeRequiredFixes is specified,
 * then all fixes will be applied.
 * If excludedFixes is specified, then those fixes will not be applied
 * regardless of whether they are "required" or specified in includedFixes.
 */
export interface EditDartfixResponse {
	/**
	 * A list of recommended changes that can be automatically made
	 * by applying the 'edits' included in this response.
	 */
	suggestions: DartFixSuggestion[];

	/**
	 * A list of recommended changes that could not be automatically made.
	 */
	otherSuggestions: DartFixSuggestion[];

	/**
	 * True if the analyzed source contains errors that might impact the correctness
	 * of the recommended changes that can be automatically applied.
	 */
	hasErrors: boolean;

	/**
	 * A list of source edits to apply the recommended changes.
	 */
	edits: SourceFileEdit[];
}

/**
 * Return the set of fixes that are available for the errors at
 * a given offset in a given file.
 */
export interface EditGetFixesRequest {
	/**
	 * The file containing the errors for which fixes are being
	 * requested.
	 */
	file: FilePath;

	/**
	 * The offset used to select the errors for which fixes
	 * will be returned.
	 */
	offset: number;
}

/**
 * Return the set of fixes that are available for the errors at
 * a given offset in a given file.
 */
export interface EditGetFixesResponse {
	/**
	 * The fixes that are available for the errors at the given offset.
	 */
	fixes: AnalysisErrorFixes[];
}

/**
 * Get the changes required to convert the postfix template at the given
 * location into the template's expanded form.
 */
export interface EditGetPostfixCompletionRequest {
	/**
	 * The file containing the postfix template to be expanded.
	 */
	file: FilePath;

	/**
	 * The unique name that identifies the template in use.
	 */
	key: string;

	/**
	 * The offset used to identify the code to which the template will be
	 * applied.
	 */
	offset: number;
}

/**
 * Get the changes required to convert the postfix template at the given
 * location into the template's expanded form.
 */
export interface EditGetPostfixCompletionResponse {
	/**
	 * The change to be applied in order to complete the statement.
	 */
	change: SourceChange;
}

/**
 * Get the changes required to perform a refactoring.
 * 
 * If another refactoring request is received during the processing
 * of this one, an error of type REFACTORING_REQUEST_CANCELLED
 * will be generated.
 */
export interface EditGetRefactoringRequest {
	/**
	 * The kind of refactoring to be performed.
	 */
	kind: RefactoringKind;

	/**
	 * The file containing the code involved in the
	 * refactoring.
	 */
	file: FilePath;

	/**
	 * The offset of the region involved in the refactoring.
	 */
	offset: number;

	/**
	 * The length of the region involved in the refactoring.
	 */
	length: number;

	/**
	 * True if the client is only requesting that the values of
	 * the options be validated and no change be generated.
	 */
	validateOnly: boolean;

	/**
	 * Data used to provide values provided by the user. The
	 * structure of the data is dependent on the kind of
	 * refactoring being performed. The data that is expected is
	 * documented in the section titled Refactorings, labeled as
	 * "Options". This field can be omitted if the refactoring
	 * does not require any options or if the values of those
	 * options are not known.
	 */
	options?: RefactoringOptions;
}

/**
 * Get the changes required to perform a refactoring.
 * 
 * If another refactoring request is received during the processing
 * of this one, an error of type REFACTORING_REQUEST_CANCELLED
 * will be generated.
 */
export interface EditGetRefactoringResponse {
	/**
	 * The initial status of the refactoring, i.e. problems related to
	 * the context in which the refactoring is requested.
	 * The array will be empty if there are no known problems.
	 */
	initialProblems: RefactoringProblem[];

	/**
	 * The options validation status, i.e. problems in the given options,
	 * such as light-weight validation of a new name, flags
	 * compatibility, etc.
	 * The array will be empty if there are no known problems.
	 */
	optionsProblems: RefactoringProblem[];

	/**
	 * The final status of the refactoring, i.e. problems identified in
	 * the result of a full, potentially expensive validation and / or
	 * change creation.
	 * The array will be empty if there are no known problems.
	 */
	finalProblems: RefactoringProblem[];

	/**
	 * Data used to provide feedback to the user. The structure
	 * of the data is dependent on the kind of refactoring
	 * being created. The data that is returned is documented
	 * in the section titled Refactorings, labeled as
	 * "Feedback".
	 */
	feedback?: RefactoringFeedback;

	/**
	 * The changes that are to be applied to affect the
	 * refactoring. This field will be omitted if there are
	 * problems that prevent a set of changes from being
	 * computed, such as having no options specified for a
	 * refactoring that requires them, or if only validation
	 * was requested.
	 */
	change?: SourceChange;

	/**
	 * The ids of source edits that are not known to be valid. An edit is
	 * not known to be valid if there was insufficient type information
	 * for the server to be able to determine whether or not the code
	 * needs to be modified, such as when a member is being renamed and
	 * there is a reference to a member from an unknown type. This field
	 * will be omitted if the change field is omitted or if there are no
	 * potential edits for the refactoring.
	 */
	potentialEdits?: string[];
}

/**
 * Get the changes required to convert the partial statement at the given
 * location into a syntactically valid statement. If the current statement
 * is already valid the change will insert a newline plus appropriate
 * indentation at the end of the line containing the offset.
 * If a change that makes the statement valid cannot be determined (perhaps
 * because it has not yet been implemented) the statement will be considered
 * already valid and the appropriate change returned.
 */
export interface EditGetStatementCompletionRequest {
	/**
	 * The file containing the statement to be completed.
	 */
	file: FilePath;

	/**
	 * The offset used to identify the statement to be completed.
	 */
	offset: number;
}

/**
 * Get the changes required to convert the partial statement at the given
 * location into a syntactically valid statement. If the current statement
 * is already valid the change will insert a newline plus appropriate
 * indentation at the end of the line containing the offset.
 * If a change that makes the statement valid cannot be determined (perhaps
 * because it has not yet been implemented) the statement will be considered
 * already valid and the appropriate change returned.
 */
export interface EditGetStatementCompletionResponse {
	/**
	 * The change to be applied in order to complete the statement.
	 */
	change: SourceChange;

	/**
	 * Will be true if the change contains nothing but whitespace
	 * characters, or is empty.
	 */
	whitespaceOnly: boolean;
}

/**
 * Determine if the request postfix completion template is applicable at
 * the given location in the given file.
 */
export interface EditIsPostfixCompletionApplicableRequest {
	/**
	 * The file containing the postfix template to be expanded.
	 */
	file: FilePath;

	/**
	 * The unique name that identifies the template in use.
	 */
	key: string;

	/**
	 * The offset used to identify the code to which the template will be
	 * applied.
	 */
	offset: number;
}

/**
 * Determine if the request postfix completion template is applicable at
 * the given location in the given file.
 */
export interface EditIsPostfixCompletionApplicableResponse {
	/**
	 * True if the template can be expanded at the given location.
	 */
	value: boolean;
}

/**
 * Return a list of all postfix templates currently available.
 */
export interface EditListPostfixCompletionTemplatesResponse {
	/**
	 * The list of available templates.
	 */
	templates: PostfixTemplateDescriptor[];
}

/**
 * Return a list of edits that would need to be applied in order to ensure
 * that all of the elements in the specified list of imported elements are
 * accessible within the library.
 * 
 * If a request is made for a file that does not exist, or that is not
 * currently subject to analysis (e.g. because it is not associated with any
 * analysis root specified via analysis.setAnalysisRoots), an error of type
 * IMPORT_ELEMENTS_INVALID_FILE will be generated.
 */
export interface EditImportElementsRequest {
	/**
	 * The file in which the specified elements are to be made accessible.
	 */
	file: FilePath;

	/**
	 * The elements to be made accessible in the specified file.
	 */
	elements: ImportedElements[];
}

/**
 * Return a list of edits that would need to be applied in order to ensure
 * that all of the elements in the specified list of imported elements are
 * accessible within the library.
 * 
 * If a request is made for a file that does not exist, or that is not
 * currently subject to analysis (e.g. because it is not associated with any
 * analysis root specified via analysis.setAnalysisRoots), an error of type
 * IMPORT_ELEMENTS_INVALID_FILE will be generated.
 */
export interface EditImportElementsResponse {
	/**
	 * The edits to be applied in order to make the specified elements accessible. The file to be edited will be the
	 * defining compilation unit of the library containing the file specified in the request, which can be different
	 * than the file specified in the request if the specified file is a part file. This field will be omitted if
	 * there are no edits that need to be applied.
	 */
	edit?: SourceFileEdit;
}

/**
 * Sort all of the directives, unit and class members
 * of the given Dart file.
 * 
 * If a request is made for a file that does not exist, does not belong
 * to an analysis root or is not a Dart file,
 * SORT_MEMBERS_INVALID_FILE will be generated.
 * 
 * If the Dart file has scan or parse errors,
 * SORT_MEMBERS_PARSE_ERRORS will be generated.
 */
export interface EditSortMembersRequest {
	/**
	 * The Dart file to sort.
	 */
	file: FilePath;
}

/**
 * Sort all of the directives, unit and class members
 * of the given Dart file.
 * 
 * If a request is made for a file that does not exist, does not belong
 * to an analysis root or is not a Dart file,
 * SORT_MEMBERS_INVALID_FILE will be generated.
 * 
 * If the Dart file has scan or parse errors,
 * SORT_MEMBERS_PARSE_ERRORS will be generated.
 */
export interface EditSortMembersResponse {
	/**
	 * The file edit that is to be applied to the given file to effect
	 * the sorting.
	 */
	edit: SourceFileEdit;
}

/**
 * Organizes all of the directives - removes unused imports and sorts
 * directives of the given Dart file according to the
 * Dart Style
 * Guide.
 * 
 * If a request is made for a file that does not exist, does not belong
 * to an analysis root or is not a Dart file,
 * FILE_NOT_ANALYZED will be generated.
 * 
 * If directives of the Dart file cannot be organized, for example
 * because it has scan or parse errors, or by other reasons,
 * ORGANIZE_DIRECTIVES_ERROR will be generated. The message
 * will provide details about the reason.
 */
export interface EditOrganizeDirectivesRequest {
	/**
	 * The Dart file to organize directives in.
	 */
	file: FilePath;
}

/**
 * Organizes all of the directives - removes unused imports and sorts
 * directives of the given Dart file according to the
 * Dart Style
 * Guide.
 * 
 * If a request is made for a file that does not exist, does not belong
 * to an analysis root or is not a Dart file,
 * FILE_NOT_ANALYZED will be generated.
 * 
 * If directives of the Dart file cannot be organized, for example
 * because it has scan or parse errors, or by other reasons,
 * ORGANIZE_DIRECTIVES_ERROR will be generated. The message
 * will provide details about the reason.
 */
export interface EditOrganizeDirectivesResponse {
	/**
	 * The file edit that is to be applied to the given file to effect
	 * the organizing.
	 */
	edit: SourceFileEdit;
}

/**
 * Create an execution context for the executable file with the given
 * path. The context that is created will persist until
 * execution.deleteContext is used to delete it. Clients, therefore, are
 * responsible for managing the lifetime of execution contexts.
 */
export interface ExecutionCreateContextRequest {
	/**
	 * The path of the Dart or HTML file that will be launched, or the
	 * path of the directory containing the file.
	 */
	contextRoot: FilePath;
}

/**
 * Create an execution context for the executable file with the given
 * path. The context that is created will persist until
 * execution.deleteContext is used to delete it. Clients, therefore, are
 * responsible for managing the lifetime of execution contexts.
 */
export interface ExecutionCreateContextResponse {
	/**
	 * The identifier used to refer to the execution context that was
	 * created.
	 */
	id: ExecutionContextId;
}

/**
 * Delete the execution context with the given identifier. The context id
 * is no longer valid after this command. The server is allowed to re-use
 * ids when they are no longer valid.
 */
export interface ExecutionDeleteContextRequest {
	/**
	 * The identifier of the execution context that is to be deleted.
	 */
	id: ExecutionContextId;
}

/**
 * Request completion suggestions for the given runtime context.
 * 
 * It might take one or two requests of this type to get completion
 * suggestions. The first request should have only "code", "offset",
 * and "variables", but not "expressions". If there are sub-expressions that
 * can have different runtime types, and are considered to be safe to
 * evaluate at runtime (e.g. getters), so using their actual runtime types
 * can improve completion results, the server will not include the
 * "suggestions" field in the response, and instead will return the
 * "expressions" field. The client will use debug API to get current runtime
 * types for these sub-expressions and send another request, this time with
 * "expressions". If there are no interesting sub-expressions to get
 * runtime types for, or when the "expressions" field is provided by the
 * client, the server will return "suggestions" in the response.
 */
export interface ExecutionGetSuggestionsRequest {
	/**
	 * The code to get suggestions in.
	 */
	code: string;

	/**
	 * The offset within the code to get suggestions at.
	 */
	offset: number;

	/**
	 * The path of the context file, e.g. the file of the current debugger
	 * frame. The combination of the context file and context offset can
	 * be used to ensure that all variables of the context are available
	 * for completion (with their static types).
	 */
	contextFile: FilePath;

	/**
	 * The offset in the context file, e.g. the line offset in the current
	 * debugger frame.
	 */
	contextOffset: number;

	/**
	 * The runtime context variables that are potentially referenced in the
	 * code.
	 */
	variables: RuntimeCompletionVariable[];

	/**
	 * The list of sub-expressions in the code for which the client wants
	 * to provide runtime types. It does not have to be the full list of
	 * expressions requested by the server, for missing expressions their
	 * static types will be used.
	 * 
	 * When this field is omitted, the server will return completion
	 * suggestions only when there are no interesting sub-expressions in the
	 * given code. The client may provide an empty list, in this case the
	 * server will return completion suggestions.
	 */
	expressions?: RuntimeCompletionExpression[];
}

/**
 * Request completion suggestions for the given runtime context.
 * 
 * It might take one or two requests of this type to get completion
 * suggestions. The first request should have only "code", "offset",
 * and "variables", but not "expressions". If there are sub-expressions that
 * can have different runtime types, and are considered to be safe to
 * evaluate at runtime (e.g. getters), so using their actual runtime types
 * can improve completion results, the server will not include the
 * "suggestions" field in the response, and instead will return the
 * "expressions" field. The client will use debug API to get current runtime
 * types for these sub-expressions and send another request, this time with
 * "expressions". If there are no interesting sub-expressions to get
 * runtime types for, or when the "expressions" field is provided by the
 * client, the server will return "suggestions" in the response.
 */
export interface ExecutionGetSuggestionsResponse {
	/**
	 * The completion suggestions. In contrast to usual completion request,
	 * suggestions for private elements also will be provided.
	 * 
	 * If there are sub-expressions that can have different runtime types,
	 * and are considered to be safe to evaluate at runtime (e.g. getters),
	 * so using their actual runtime types can improve completion results,
	 * the server omits this field in the response, and instead will return
	 * the "expressions" field.
	 */
	suggestions?: CompletionSuggestion[];

	/**
	 * The list of sub-expressions in the code for which the server would
	 * like to know runtime types to provide better completion suggestions.
	 * 
	 * This field is omitted the field "suggestions" is returned.
	 */
	expressions?: RuntimeCompletionExpression[];
}

/**
 * Map a URI from the execution context to the file that it corresponds
 * to, or map a file to the URI that it corresponds to in the execution
 * context.
 * 
 * Exactly one of the file and uri fields must be provided. If both
 * fields are provided, then an error of type INVALID_PARAMETER
 * will be generated. Similarly, if neither field is provided, then an
 * error of type INVALID_PARAMETER will be generated.
 * 
 * If the file field is provided and the value is not the path of a file
 * (either the file does not exist or the path references something other
 * than a file), then an error of type INVALID_PARAMETER will
 * be generated.
 * 
 * If the uri field is provided and the value is not a valid URI or if
 * the URI references something that is not a file (either a file that
 * does not exist or something other than a file), then an error of type
 * INVALID_PARAMETER will be generated.
 * 
 * If the contextRoot used to create the execution context does not
 * exist, then an error of type INVALID_EXECUTION_CONTEXT will
 * be generated.
 */
export interface ExecutionMapUriRequest {
	/**
	 * The identifier of the execution context in which the URI is to be
	 * mapped.
	 */
	id: ExecutionContextId;

	/**
	 * The path of the file to be mapped into a URI.
	 */
	file?: FilePath;

	/**
	 * The URI to be mapped into a file path.
	 */
	uri?: string;
}

/**
 * Map a URI from the execution context to the file that it corresponds
 * to, or map a file to the URI that it corresponds to in the execution
 * context.
 * 
 * Exactly one of the file and uri fields must be provided. If both
 * fields are provided, then an error of type INVALID_PARAMETER
 * will be generated. Similarly, if neither field is provided, then an
 * error of type INVALID_PARAMETER will be generated.
 * 
 * If the file field is provided and the value is not the path of a file
 * (either the file does not exist or the path references something other
 * than a file), then an error of type INVALID_PARAMETER will
 * be generated.
 * 
 * If the uri field is provided and the value is not a valid URI or if
 * the URI references something that is not a file (either a file that
 * does not exist or something other than a file), then an error of type
 * INVALID_PARAMETER will be generated.
 * 
 * If the contextRoot used to create the execution context does not
 * exist, then an error of type INVALID_EXECUTION_CONTEXT will
 * be generated.
 */
export interface ExecutionMapUriResponse {
	/**
	 * The file to which the URI was mapped. This field is omitted if the
	 * uri field was not given in the request.
	 */
	file?: FilePath;

	/**
	 * The URI to which the file path was mapped. This field is omitted
	 * if the file field was not given in the request.
	 */
	uri?: string;
}

/**
 * Deprecated: the analysis server no longer fires
 * LAUNCH_DATA events.
 * 
 * Subscribe for services. All previous subscriptions are replaced by the
 * given set of services.
 * 
 * It is an error if any of the elements in the list are not valid
 * services. If there is an error, then the current subscriptions will
 * remain unchanged.
 */
export interface ExecutionSetSubscriptionsRequest {
	/**
	 * A list of the services being subscribed to.
	 */
	subscriptions: ExecutionService[];
}

/**
 * Return server diagnostics.
 */
export interface DiagnosticGetDiagnosticsResponse {
	/**
	 * The list of analysis contexts.
	 */
	contexts: ContextData[];
}

/**
 * Return the port of the diagnostic web server. If the server is not running
 * this call will start the server. If unable to start the diagnostic web
 * server,
 * this call will return an error of DEBUG_PORT_COULD_NOT_BE_OPENED.
 */
export interface DiagnosticGetServerPortResponse {
	/**
	 * The diagnostic server port.
	 */
	port: number;
}

/**
 * Query whether analytics is enabled.
 * 
 * This flag controls whether the analysis server sends any analytics data to
 * the cloud. If disabled, the analysis server does not send any analytics
 * data, and any data sent to it by clients (from sendEvent and
 * sendTiming) will be ignored.
 * 
 * The value of this flag can be changed by other tools outside of the
 * analysis server's process. When you query the flag, you get the value of
 * the flag at a given moment. Clients should not use the value returned to
 * decide whether or not to send the sendEvent and
 * sendTiming requests. Those requests should be used
 * unconditionally and server will determine whether or not it is appropriate
 * to forward the information to the cloud at the time each request is
 * received.
 */
export interface AnalyticsIsEnabledResponse {
	/**
	 * Whether sending analytics is enabled or not.
	 */
	enabled: boolean;
}

/**
 * Enable or disable the sending of analytics data. Note that there are other
 * ways for users to change this setting, so clients cannot assume that they
 * have complete control over this setting. In particular, there is no
 * guarantee that the result returned by the isEnabled request will
 * match the last value set via this request.
 */
export interface AnalyticsEnableRequest {
	/**
	 * Enable or disable analytics.
	 */
	value: boolean;
}

/**
 * Send information about client events.
 * 
 * Ask the analysis server to include the fact that an action was performed
 * in the client as part of the analytics data being sent. The data will only
 * be included if the sending of analytics data is enabled at the time the
 * request is processed. The action that was performed is indicated by the
 * value of the action field.
 * 
 * The value of the action field should not include the identity of the
 * client. The analytics data sent by server will include the client id
 * passed in using the --client-id command-line argument. The
 * request will be ignored if the client id was not provided when server was
 * started.
 */
export interface AnalyticsSendEventRequest {
	/**
	 * The value used to indicate which action was performed.
	 */
	action: string;
}

/**
 * Send timing information for client events (e.g. code completions).
 * 
 * Ask the analysis server to include the fact that a timed event occurred as
 * part of the analytics data being sent. The data will only be included if
 * the sending of analytics data is enabled at the time the request is
 * processed.
 * 
 * The value of the event field should not include the identity of the
 * client. The analytics data sent by server will include the client id
 * passed in using the --client-id command-line argument. The
 * request will be ignored if the client id was not provided when server was
 * started.
 */
export interface AnalyticsSendTimingRequest {
	/**
	 * The name of the event.
	 */
	event: string;

	/**
	 * The duration of the event in milliseconds.
	 */
	millis: number;
}

/**
 * Return the list of KytheEntry objects for some file, given the
 * current state of the file system populated by "analysis.updateContent".
 * 
 * If a request is made for a file that does not exist, or that is not
 * currently subject to analysis (e.g. because it is not associated with any
 * analysis root specified to analysis.setAnalysisRoots), an error of type
 * GET_KYTHE_ENTRIES_INVALID_FILE will be generated.
 */
export interface KytheGetKytheEntriesRequest {
	/**
	 * The file containing the code for which the Kythe Entry objects are
	 * being requested.
	 */
	file: FilePath;
}

/**
 * Return the list of KytheEntry objects for some file, given the
 * current state of the file system populated by "analysis.updateContent".
 * 
 * If a request is made for a file that does not exist, or that is not
 * currently subject to analysis (e.g. because it is not associated with any
 * analysis root specified to analysis.setAnalysisRoots), an error of type
 * GET_KYTHE_ENTRIES_INVALID_FILE will be generated.
 */
export interface KytheGetKytheEntriesResponse {
	/**
	 * The list of KytheEntry objects for the queried file.
	 */
	entries: KytheEntry[];

	/**
	 * The set of files paths that were required, but not in the file system,
	 * to give a complete and accurate Kythe graph for the file. This could
	 * be due to a referenced file that does not exist or generated files not
	 * being generated or passed before the call to "getKytheEntries".
	 */
	files: FilePath[];
}

/**
 * Return the change that adds the forDesignTime() constructor for the
 * widget class at the given offset.
 */
export interface FlutterGetChangeAddForDesignTimeConstructorRequest {
	/**
	 * The file containing the code of the class.
	 */
	file: FilePath;

	/**
	 * The offset of the class in the code.
	 */
	offset: number;
}

/**
 * Return the change that adds the forDesignTime() constructor for the
 * widget class at the given offset.
 */
export interface FlutterGetChangeAddForDesignTimeConstructorResponse {
	/**
	 * The change that adds the forDesignTime() constructor.
	 * If the change cannot be produced, an error is returned.
	 */
	change: SourceChange;
}

/**
 * Subscribe for services that are specific to individual files.
 * All previous subscriptions are replaced by the current set of
 * subscriptions. If a given service is not included as a key in the map
 * then no files will be subscribed to the service, exactly as if the
 * service had been included in the map with an explicit empty list of
 * files.
 * 
 * Note that this request determines the set of requested
 * subscriptions. The actual set of subscriptions at any given
 * time is the intersection of this set with the set of files
 * currently subject to analysis. The files currently subject
 * to analysis are the set of files contained within an actual
 * analysis root but not excluded, plus all of the files
 * transitively reachable from those files via import, export
 * and part directives. (See analysis.setAnalysisRoots for an
 * explanation of how the actual analysis roots are
 * determined.) When the actual analysis roots change, the
 * actual set of subscriptions is automatically updated, but
 * the set of requested subscriptions is unchanged.
 * 
 * If a requested subscription is a directory it is ignored,
 * but remains in the set of requested subscriptions so that if
 * it later becomes a file it can be included in the set of
 * actual subscriptions.
 * 
 * It is an error if any of the keys in the map are not valid
 * services. If there is an error, then the existing
 * subscriptions will remain unchanged.
 */
export interface FlutterSetSubscriptionsRequest {
	/**
	 * A table mapping services to a list of the files being
	 * subscribed to the service.
	 */
	subscriptions: { [key: string]: FilePath[] | undefined; };
}

/**
 * Reports that the server is running. This notification is
 * issued once after the server has started running but before
 * any requests are processed to let the client know that it
 * started correctly.
 * 
 * It is not possible to subscribe to or unsubscribe from this
 * notification.
 */
export interface ServerConnectedNotification {
	/**
	 * The version number of the analysis server.
	 */
	version: string;

	/**
	 * The process id of the analysis server process.
	 */
	pid: number;

	/**
	 * The session id for this session.
	 */
	sessionId?: string;
}

/**
 * Reports that an unexpected error has occurred while
 * executing the server. This notification is not used for
 * problems with specific requests (which are returned as part
 * of the response) but is used for exceptions that occur while
 * performing other tasks, such as analysis or preparing
 * notifications.
 * 
 * It is not possible to subscribe to or unsubscribe from this
 * notification.
 */
export interface ServerErrorNotification {
	/**
	 * True if the error is a fatal error, meaning that the
	 * server will shutdown automatically after sending this
	 * notification.
	 */
	isFatal: boolean;

	/**
	 * The error message indicating what kind of error was
	 * encountered.
	 */
	message: string;

	/**
	 * The stack trace associated with the generation of the
	 * error, used for debugging the server.
	 */
	stackTrace: string;
}

/**
 * Reports the current status of the server. Parameters are
 * omitted if there has been no change in the status
 * represented by that parameter.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "STATUS" in
 * the list of services passed in a server.setSubscriptions
 * request.
 */
export interface ServerStatusNotification {
	/**
	 * The current status of analysis, including whether
	 * analysis is being performed and if so what is being
	 * analyzed.
	 */
	analysis?: AnalysisStatus;

	/**
	 * The current status of pub execution, indicating whether we are
	 * currently running pub.
	 * 
	 * Note: this status type is deprecated, and is no longer sent by
	 * the server.
	 */
	pub?: PubStatus;
}

/**
 * Reports the paths of the files that are being analyzed.
 * 
 * This notification is not subscribed to by default. Clients can
 * subscribe by including the value "ANALYZED_FILES" in the list
 * of services passed in an analysis.setGeneralSubscriptions request.
 */
export interface AnalysisAnalyzedFilesNotification {
	/**
	 * A list of the paths of the files that are being analyzed.
	 */
	directories: FilePath[];
}

/**
 * Reports closing labels relevant to a given file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "CLOSING_LABELS"
 * in the list of services passed in an
 * analysis.setSubscriptions request.
 */
export interface AnalysisClosingLabelsNotification {
	/**
	 * The file the closing labels relate to.
	 */
	file: FilePath;

	/**
	 * Closing labels relevant to the file. Each item
	 * represents a useful label associated with some range
	 * with may be useful to display to the user within the editor
	 * at the end of the range to indicate what construct is closed
	 * at that location. Closing labels include constructor/method
	 * calls and List arguments that span multiple lines.
	 * Note that the ranges that are returned can overlap
	 * each other because they may be associated with
	 * constructs that can be nested.
	 */
	labels: ClosingLabel[];
}

/**
 * Reports the errors associated with a given file. The set of
 * errors included in the notification is always a complete
 * list that supersedes any previously reported errors.
 */
export interface AnalysisErrorsNotification {
	/**
	 * The file containing the errors.
	 */
	file: FilePath;

	/**
	 * The errors contained in the file.
	 */
	errors: AnalysisError[];
}

/**
 * Reports that any analysis results that were previously
 * associated with the given files should be considered to be
 * invalid because those files are no longer being analyzed,
 * either because the analysis root that contained it is no
 * longer being analyzed or because the file no longer exists.
 * 
 * If a file is included in this notification and at some later
 * time a notification with results for the file is received,
 * clients should assume that the file is once again being
 * analyzed and the information should be processed.
 * 
 * It is not possible to subscribe to or unsubscribe from this
 * notification.
 */
export interface AnalysisFlushResultsNotification {
	/**
	 * The files that are no longer being analyzed.
	 */
	files: FilePath[];
}

/**
 * Reports the folding regions associated with a given
 * file. Folding regions can be nested, but will not be
 * overlapping. Nesting occurs when a foldable element, such as
 * a method, is nested inside another foldable element such as
 * a class.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "FOLDING" in
 * the list of services passed in an analysis.setSubscriptions
 * request.
 */
export interface AnalysisFoldingNotification {
	/**
	 * The file containing the folding regions.
	 */
	file: FilePath;

	/**
	 * The folding regions contained in the file.
	 */
	regions: FoldingRegion[];
}

/**
 * Reports the highlight regions associated with a given file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "HIGHLIGHTS"
 * in the list of services passed in an
 * analysis.setSubscriptions request.
 */
export interface AnalysisHighlightsNotification {
	/**
	 * The file containing the highlight regions.
	 */
	file: FilePath;

	/**
	 * The highlight regions contained in the file. Each
	 * highlight region represents a particular syntactic or
	 * semantic meaning associated with some range. Note that
	 * the highlight regions that are returned can overlap
	 * other highlight regions if there is more than one
	 * meaning associated with a particular region.
	 */
	regions: HighlightRegion[];
}

/**
 * Reports the classes that are implemented or extended and
 * class members that are implemented or overridden in a file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "IMPLEMENTED" in
 * the list of services passed in an analysis.setSubscriptions
 * request.
 */
export interface AnalysisImplementedNotification {
	/**
	 * The file with which the implementations are associated.
	 */
	file: FilePath;

	/**
	 * The classes defined in the file that are implemented or extended.
	 */
	classes: ImplementedClass[];

	/**
	 * The member defined in the file that are implemented or overridden.
	 */
	members: ImplementedMember[];
}

/**
 * Reports that the navigation information associated with a region of a
 * single file has become invalid and should be re-requested.
 * 
 * This notification is not subscribed to by default. Clients can
 * subscribe by including the value "INVALIDATE" in the list of
 * services passed in an analysis.setSubscriptions request.
 */
export interface AnalysisInvalidateNotification {
	/**
	 * The file whose information has been invalidated.
	 */
	file: FilePath;

	/**
	 * The offset of the invalidated region.
	 */
	offset: number;

	/**
	 * The length of the invalidated region.
	 */
	length: number;

	/**
	 * The delta to be applied to the offsets in information that follows
	 * the invalidated region in order to update it so that it doesn't
	 * need to be re-requested.
	 */
	delta: number;
}

/**
 * Reports the navigation targets associated with a given file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "NAVIGATION"
 * in the list of services passed in an
 * analysis.setSubscriptions request.
 */
export interface AnalysisNavigationNotification {
	/**
	 * The file containing the navigation regions.
	 */
	file: FilePath;

	/**
	 * The navigation regions contained in the file.
	 * The regions are sorted by their offsets.
	 * Each navigation region represents a list of targets
	 * associated with some range. The lists will usually
	 * contain a single target, but can contain more in the
	 * case of a part that is included in multiple libraries
	 * or in Dart code that is compiled against multiple
	 * versions of a package. Note that the navigation
	 * regions that are returned do not overlap other
	 * navigation regions.
	 */
	regions: NavigationRegion[];

	/**
	 * The navigation targets referenced in the file.
	 * They are referenced by NavigationRegions by their
	 * index in this array.
	 */
	targets: NavigationTarget[];

	/**
	 * The files containing navigation targets referenced in the file.
	 * They are referenced by NavigationTargets by their
	 * index in this array.
	 */
	files: FilePath[];
}

/**
 * Reports the occurrences of references to elements within a
 * single file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "OCCURRENCES"
 * in the list of services passed in an
 * analysis.setSubscriptions request.
 */
export interface AnalysisOccurrencesNotification {
	/**
	 * The file in which the references occur.
	 */
	file: FilePath;

	/**
	 * The occurrences of references to elements within the
	 * file.
	 */
	occurrences: Occurrences[];
}

/**
 * Reports the outline associated with a single file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "OUTLINE" in
 * the list of services passed in an analysis.setSubscriptions
 * request.
 */
export interface AnalysisOutlineNotification {
	/**
	 * The file with which the outline is associated.
	 */
	file: FilePath;

	/**
	 * The kind of the file.
	 */
	kind: FileKind;

	/**
	 * The name of the library defined by the file using a "library"
	 * directive, or referenced by a "part of" directive. If both
	 * "library" and "part of" directives are present, then the
	 * "library" directive takes precedence.
	 * This field will be omitted if the file has neither "library"
	 * nor "part of" directives.
	 */
	libraryName?: string;

	/**
	 * The outline associated with the file.
	 */
	outline: Outline;
}

/**
 * Reports the overriding members in a file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "OVERRIDES" in
 * the list of services passed in an analysis.setSubscriptions
 * request.
 */
export interface AnalysisOverridesNotification {
	/**
	 * The file with which the overrides are associated.
	 */
	file: FilePath;

	/**
	 * The overrides associated with the file.
	 */
	overrides: Override[];
}

/**
 * Reports the completion suggestions that should be presented
 * to the user. The set of suggestions included in the
 * notification is always a complete list that supersedes any
 * previously reported suggestions.
 */
export interface CompletionResultsNotification {
	/**
	 * The id associated with the completion.
	 */
	id: CompletionId;

	/**
	 * The offset of the start of the text to be
	 * replaced. This will be different than the offset used
	 * to request the completion suggestions if there was a
	 * portion of an identifier before the original
	 * offset. In particular, the replacementOffset will be
	 * the offset of the beginning of said identifier.
	 */
	replacementOffset: number;

	/**
	 * The length of the text to be replaced if the remainder
	 * of the identifier containing the cursor is to be
	 * replaced when the suggestion is applied (that is, the
	 * number of characters in the existing identifier).
	 */
	replacementLength: number;

	/**
	 * The completion suggestions being reported. The
	 * notification contains all possible completions at the
	 * requested cursor position, even those that do not match
	 * the characters the user has already typed. This allows
	 * the client to respond to further keystrokes from the
	 * user without having to make additional requests.
	 */
	results: CompletionSuggestion[];

	/**
	 * True if this is that last set of results that will be
	 * returned for the indicated completion.
	 */
	isLast: boolean;

	/**
	 * References to AvailableSuggestionSet objects previously sent
	 * to the client. The client can include applicable names from the
	 * referenced library in code completion suggestions.
	 */
	includedSuggestionSets?: IncludedSuggestionSet[];

	/**
	 * The client is expected to check this list against the
	 * ElementKind sent in IncludedSuggestionSet to decide
	 * whether or not these symbols should should be presented to the user.
	 */
	includedElementKinds?: ElementKind[];

	/**
	 * The client is expected to check this list against the values of the
	 * field relevanceTags of AvailableSuggestion to
	 * decide if the suggestion should be given a different relevance than
	 * the IncludedSuggestionSet that contains it. This might be
	 * used for example to give higher relevance to suggestions of matching
	 * types.
	 * 
	 * If an AvailableSuggestion has relevance tags that match more
	 * than one IncludedSuggestionRelevanceTag, the maximum
	 * relevance boost is used.
	 */
	includedSuggestionRelevanceTags?: IncludedSuggestionRelevanceTag[];
}

/**
 * Reports the pre-computed, candidate completions from symbols defined
 * in a corresponding library. This notification may be sent multiple times.
 * When a notification is processed, clients should replace any previous
 * information about the libraries in the list of changedLibraries, discard
 * any information about the libraries in the list of removedLibraries, and
 * preserve any previously received information about any libraries that are
 * not included in either list.
 */
export interface CompletionAvailableSuggestionsNotification {
	/**
	 * A list of pre-computed, potential completions coming from
	 * this set of completion suggestions.
	 */
	changedLibraries?: AvailableSuggestionSet[];

	/**
	 * A list of library ids that no longer apply.
	 */
	removedLibraries?: number[];
}

/**
 * Reports some or all of the results of performing a requested
 * search. Unlike other notifications, this notification
 * contains search results that should be added to any
 * previously received search results associated with the same
 * search id.
 */
export interface SearchResultsNotification {
	/**
	 * The id associated with the search.
	 */
	id: SearchId;

	/**
	 * The search results being reported.
	 */
	results: SearchResult[];

	/**
	 * True if this is that last set of results that will be
	 * returned for the indicated search.
	 */
	isLast: boolean;
}

/**
 * Reports information needed to allow a single file to be launched.
 * 
 * This notification is not subscribed to by default. Clients can
 * subscribe by including the value "LAUNCH_DATA" in the list of services
 * passed in an execution.setSubscriptions request.
 */
export interface ExecutionLaunchDataNotification {
	/**
	 * The file for which launch data is being provided. This will either
	 * be a Dart library or an HTML file.
	 */
	file: FilePath;

	/**
	 * The kind of the executable file. This field is omitted if the file
	 * is not a Dart file.
	 */
	kind?: ExecutableKind;

	/**
	 * A list of the Dart files that are referenced by the file. This
	 * field is omitted if the file is not an HTML file.
	 */
	referencedFiles?: FilePath[];
}

/**
 * Reports the Flutter outline associated with a single file.
 * 
 * This notification is not subscribed to by default. Clients
 * can subscribe by including the value "OUTLINE" in
 * the list of services passed in an flutter.setSubscriptions
 * request.
 */
export interface FlutterOutlineNotification {
	/**
	 * The file with which the outline is associated.
	 */
	file: FilePath;

	/**
	 * The outline associated with the file.
	 */
	outline: FlutterOutline;

	/**
	 * If the file has Flutter widgets that can be rendered, this field
	 * has the instrumented content of the file, that allows associating
	 * widgets with corresponding outline nodes. If there are no widgets
	 * to render, this field is absent.
	 */
	instrumentedCode?: string;
}

/**
 * A list of fixes associated with a specific error.
 */
export interface AnalysisErrorFixes {
	/**
	 * The error with which the fixes are associated.
	 */
	error: AnalysisError;

	/**
	 * The fixes associated with the error.
	 */
	fixes: SourceChange[];
}

/**
 * Deprecated: the only reference to this type has been
 * deprecated.
 * 
 * A set of options controlling what kind of analysis is to be
 * performed. If the value of a field is omitted the value of the
 * option will not be changed.
 */
export interface AnalysisOptions {
	/**
	 * Deprecated: this feature is always enabled.
	 * 
	 * True if the client wants to enable support for the
	 * proposed async feature.
	 */
	enableAsync?: boolean;

	/**
	 * Deprecated: this feature is always enabled.
	 * 
	 * True if the client wants to enable support for the
	 * proposed deferred loading feature.
	 */
	enableDeferredLoading?: boolean;

	/**
	 * Deprecated: this feature is always enabled.
	 * 
	 * True if the client wants to enable support for the
	 * proposed enum feature.
	 */
	enableEnums?: boolean;

	/**
	 * Deprecated: this feature is always enabled.
	 * 
	 * True if the client wants to enable support for the
	 * proposed "null aware operators" feature.
	 */
	enableNullAwareOperators?: boolean;

	/**
	 * True if the client wants to enable support for the
	 * proposed "less restricted mixins" proposal (DEP 34).
	 */
	enableSuperMixins?: boolean;

	/**
	 * True if hints that are specific to dart2js should be
	 * generated. This option is ignored if generateHints is false.
	 */
	generateDart2jsHints?: boolean;

	/**
	 * True if hints should be generated as part of generating
	 * errors and warnings.
	 */
	generateHints?: boolean;

	/**
	 * True if lints should be generated as part of generating
	 * errors and warnings.
	 */
	generateLints?: boolean;
}

/**
 * An enumeration of the services provided by the analysis domain that
 * are related to a specific list of files.
 */
export type AnalysisService =
	"CLOSING_LABELS"
	| "FOLDING"
	| "HIGHLIGHTS"
	| "IMPLEMENTED"
	| "INVALIDATE"
	| "NAVIGATION"
	| "OCCURRENCES"
	| "OUTLINE"
	| "OVERRIDES";

/**
 * An indication of the current state of analysis.
 */
export interface AnalysisStatus {
	/**
	 * True if analysis is currently being performed.
	 */
	isAnalyzing: boolean;

	/**
	 * The name of the current target of analysis. This field is
	 * omitted if analyzing is false.
	 */
	analysisTarget?: string;
}

/**
 * A label that is associated with a range of code that may be useful to
 * render at the end of the range to aid code readability. For example, a
 * constructor call that spans multiple lines may result in a closing label
 * to allow the constructor type/name to be rendered alongside the closing
 * parenthesis.
 */
export interface ClosingLabel {
	/**
	 * The offset of the construct being labelled.
	 */
	offset: number;

	/**
	 * The length of the whole construct to be labelled.
	 */
	length: number;

	/**
	 * The label associated with this range that should be displayed to the
	 * user.
	 */
	label: string;
}

/**
 * An identifier used to associate completion results with a
 * completion request.
 */
export type CompletionId = string;

/**
 * Information about an analysis context.
 */
export interface ContextData {
	/**
	 * The name of the context.
	 */
	name: string;

	/**
	 * Explicitly analyzed files.
	 */
	explicitFileCount: number;

	/**
	 * Implicitly analyzed files.
	 */
	implicitFileCount: number;

	/**
	 * The number of work items in the queue.
	 */
	workItemQueueLength: number;

	/**
	 * Exceptions associated with cache entries.
	 */
	cacheEntryExceptions: string[];
}

/**
 * A declaration - top-level (class, field, etc) or a class member (method,
 * field, etc).
 */
export interface ElementDeclaration {
	/**
	 * The name of the declaration.
	 */
	name: string;

	/**
	 * The kind of the element that corresponds to the declaration.
	 */
	kind: ElementKind;

	/**
	 * The index of the file (in the enclosing response).
	 */
	fileIndex: number;

	/**
	 * The offset of the declaration name in the file.
	 */
	offset: number;

	/**
	 * The one-based index of the line containing the declaration name.
	 */
	line: number;

	/**
	 * The one-based index of the column containing the declaration name.
	 */
	column: number;

	/**
	 * The offset of the first character of the declaration code in the file.
	 */
	codeOffset: number;

	/**
	 * The length of the declaration code in the file.
	 */
	codeLength: number;

	/**
	 * The name of the class enclosing this declaration. If the declaration
	 * is not a class member, this field will be absent.
	 */
	className?: string;

	/**
	 * The name of the mixin enclosing this declaration. If the declaration
	 * is not a mixin member, this field will be absent.
	 */
	mixinName?: string;

	/**
	 * The parameter list for the element. If the element is not a method or
	 * function this field will not be defined. If the element doesn't have
	 * parameters (e.g. getter), this field will not be defined. If the
	 * element has zero parameters, this field will have a value of "()".
	 * 
	 * The value should not be treated as exact presentation of parameters,
	 * it is just approximation of parameters to give the user general idea.
	 */
	parameters?: string;
}

/**
 * A description of an executable file.
 */
export interface ExecutableFile {
	/**
	 * The path of the executable file.
	 */
	file: FilePath;

	/**
	 * The kind of the executable file.
	 */
	kind: ExecutableKind;
}

/**
 * An enumeration of the kinds of executable files.
 */
export type ExecutableKind =
	"CLIENT"
	| "EITHER"
	| "NOT_EXECUTABLE"
	| "SERVER";

/**
 * The identifier for a execution context.
 */
export type ExecutionContextId = string;

/**
 * A partial completion suggestion that can be used in combination with
 * info from completion.results to build completion suggestions
 * for not yet imported library tokens.
 */
export interface AvailableSuggestion {
	/**
	 * The identifier to present to the user for code completion.
	 */
	label: string;

	/**
	 * Information about the element reference being suggested.
	 */
	element: Element;

	/**
	 * A default String for use in generating argument list source contents
	 * on the client side.
	 */
	defaultArgumentListString?: string;

	/**
	 * Pairs of offsets and lengths describing 'defaultArgumentListString'
	 * text ranges suitable for use by clients to set up linked edits of
	 * default argument source contents. For example, given an argument list
	 * string 'x, y', the corresponding text range [0, 1, 3, 1], indicates
	 * two text ranges of length 1, starting at offsets 0 and 3. Clients can
	 * use these ranges to treat the 'x' and 'y' values specially for linked
	 * edits.
	 */
	defaultArgumentListTextRanges?: number[];

	/**
	 * The Dartdoc associated with the element being suggested. This field
	 * is omitted if there is no Dartdoc associated with the element.
	 */
	docComplete?: string;

	/**
	 * An abbreviated version of the Dartdoc associated with the element being suggested.
	 * This field is omitted if there is no Dartdoc associated with the element.
	 */
	docSummary?: string;

	/**
	 * If the element is an executable, the names of the formal parameters of
	 * all kinds - required, optional positional, and optional named. The
	 * names of positional parameters are empty strings. Omitted if the element
	 * is not an executable.
	 */
	parameterNames?: string[];

	/**
	 * If the element is an executable, the declared types of the formal parameters
	 * of all kinds - required, optional positional, and optional named.
	 * Omitted if the element is not an executable.
	 */
	parameterTypes?: string[];

	/**
	 * This field is set if the relevance of this suggestion might be
	 * changed depending on where completion is requested.
	 */
	relevanceTags?: AvailableSuggestionRelevanceTag[];

	/**
	 * 
	 */
	requiredParameterCount?: number;
}

/**
 * The opaque tag value.
 */
export type AvailableSuggestionRelevanceTag = string;

/**
 * 
 */
export interface AvailableSuggestionSet {
	/**
	 * The id associated with the library.
	 */
	id: number;

	/**
	 * The URI of the library.
	 */
	uri: string;

	/**
	 * 
	 */
	items: AvailableSuggestion[];
}

/**
 * A reference to an AvailableSuggestionSet noting
 * that the library's members which match the kind of this ref
 * should be presented to the user.
 */
export interface IncludedSuggestionSet {
	/**
	 * Clients should use it to access the set of precomputed completions
	 * to be displayed to the user.
	 */
	id: number;

	/**
	 * The relevance of completion suggestions from this
	 * library where a higher number indicates a higher relevance.
	 */
	relevance: number;

	/**
	 * The optional string that should be displayed instead of the
	 * uri of the referenced AvailableSuggestionSet.
	 * 
	 * For example libraries in the "test" directory of a package have only
	 * "file://" URIs, so are usually long, and don't look nice, but actual
	 * import directives will use relative URIs, which are short, so we
	 * probably want to display such relative URIs to the user.
	 */
	displayUri?: string;
}

/**
 * Each AvailableSuggestion can specify zero or more tags in the
 * field relevanceTags, so that when the included tag is equal to
 * one of the relevanceTags, the suggestion is given higher
 * relevance than the whole IncludedSuggestionSet.
 */
export interface IncludedSuggestionRelevanceTag {
	/**
	 * The opaque value of the tag.
	 */
	tag: AvailableSuggestionRelevanceTag;

	/**
	 * The boost to the relevance of the completion suggestions that match
	 * this tag, which is added to the relevance of the containing
	 * IncludedSuggestionSet.
	 */
	relevanceBoost: number;
}

/**
 * An enumeration of the completion services to which a client can subscribe.
 */
export type CompletionService =
	"AVAILABLE_SUGGESTION_SETS";

/**
 * A list of associations between paths and the libraries that should be
 * included for code completion when editing a file beneath that path.
 */
export interface LibraryPathSet {
	/**
	 * The filepath for which this request's libraries should be active
	 * in completion suggestions. This object associates filesystem regions
	 * to libraries and library directories of interest to the client.
	 */
	scope: FilePath;

	/**
	 * The paths of the libraries of interest to the client for completion suggestions.
	 */
	libraryPaths: FilePath[];
}

/**
 * An expression for which we want to know its runtime type.
 * In expressions like 'a.b.c.where((e) => e.^)' we want to know the
 * runtime type of 'a.b.c' to enforce it statically at the time when we
 * compute completion suggestions, and get better type for 'e'.
 */
export interface RuntimeCompletionExpression {
	/**
	 * The offset of the expression in the code for completion.
	 */
	offset: number;

	/**
	 * The length of the expression in the code for completion.
	 */
	length: number;

	/**
	 * When the expression is sent from the server to the client, the
	 * type is omitted. The client should fill the type when it sends the
	 * request to the server again.
	 */
	type?: RuntimeCompletionExpressionType;
}

/**
 * A variable in a runtime context.
 */
export interface RuntimeCompletionVariable {
	/**
	 * The name of the variable.
	 * The name "this" has a special meaning and is used as an implicit
	 * target for runtime completion, and in explicit "this" references.
	 */
	name: string;

	/**
	 * The type of the variable.
	 */
	type: RuntimeCompletionExpressionType;
}

/**
 * A type at runtime.
 */
export interface RuntimeCompletionExpressionType {
	/**
	 * The path of the library that has this type.
	 * Omitted if the type is not declared in any library, e.g. "dynamic",
	 * or "void".
	 */
	libraryPath?: FilePath;

	/**
	 * The kind of the type.
	 */
	kind: RuntimeCompletionExpressionTypeKind;

	/**
	 * The name of the type. Omitted if the type does not have a name, e.g.
	 * an inline function type.
	 */
	name?: string;

	/**
	 * The type arguments of the type.
	 * Omitted if the type does not have type parameters.
	 */
	typeArguments?: RuntimeCompletionExpressionType[];

	/**
	 * If the type is a function type, the return type of the function.
	 * Omitted if the type is not a function type.
	 */
	returnType?: RuntimeCompletionExpressionType;

	/**
	 * If the type is a function type, the types of the function parameters
	 * of all kinds - required, optional positional, and optional named.
	 * Omitted if the type is not a function type.
	 */
	parameterTypes?: RuntimeCompletionExpressionType[];

	/**
	 * If the type is a function type, the names of the function parameters
	 * of all kinds - required, optional positional, and optional named.
	 * The names of positional parameters are empty strings.
	 * Omitted if the type is not a function type.
	 */
	parameterNames?: string[];
}

/**
 * An enumeration of the kinds of runtime expression types.
 */
export type RuntimeCompletionExpressionTypeKind =
	"DYNAMIC"
	| "FUNCTION"
	| "INTERFACE";

/**
 * A scanned token along with its inferred type information.
 */
export interface TokenDetails {
	/**
	 * The raw token text.
	 */
	lexeme: string;

	/**
	 * The type of this token.
	 */
	type: string;

	/**
	 * The kinds of elements which could validly replace this token.
	 */
	validElementKinds: ElementKind[];
}

/**
 * An enumeration of the services provided by the execution
 * domain.
 */
export type ExecutionService =
	"LAUNCH_DATA";

/**
 * An enumeration of the kinds of files.
 */
export type FileKind =
	"LIBRARY"
	| "PART";

/**
 * An enumeration of the services provided by the flutter domain that
 * are related to a specific list of files.
 */
export type FlutterService =
	"OUTLINE";

/**
 * An node in the Flutter specific outline structure of a file.
 */
export interface FlutterOutline {
	/**
	 * The kind of the node.
	 */
	kind: FlutterOutlineKind;

	/**
	 * The offset of the first character of the element. This is different
	 * than the offset in the Element, which is the offset of the name of the
	 * element. It can be used, for example, to map locations in the file
	 * back to an outline.
	 */
	offset: number;

	/**
	 * The length of the element.
	 */
	length: number;

	/**
	 * The offset of the first character of the element code, which is
	 * neither documentation, nor annotation.
	 */
	codeOffset: number;

	/**
	 * The length of the element code.
	 */
	codeLength: number;

	/**
	 * The text label of the node children of the node.
	 * It is provided for any FlutterOutlineKind.GENERIC node,
	 * where better information is not available.
	 */
	label?: string;

	/**
	 * If this node is a Dart element, the description of it; omitted
	 * otherwise.
	 */
	dartElement?: Element;

	/**
	 * Additional attributes for this node, which might be interesting
	 * to display on the client. These attributes are usually arguments
	 * for the instance creation or the invocation that created the widget.
	 */
	attributes?: FlutterOutlineAttribute[];

	/**
	 * If the node creates a new class instance, or a reference to an
	 * instance, this field has the name of the class.
	 */
	className?: string;

	/**
	 * A short text description how this node is associated with the parent
	 * node. For example "appBar" or "body" in Scaffold.
	 */
	parentAssociationLabel?: string;

	/**
	 * If FlutterOutlineKind.VARIABLE, the name of the variable.
	 */
	variableName?: string;

	/**
	 * The children of the node. The field will be omitted if the node has no
	 * children.
	 */
	children?: FlutterOutline[];

	/**
	 * If the node is a widget, and it is instrumented, the unique identifier
	 * of this widget, that can be used to associate rendering information
	 * with this node.
	 */
	id?: number;

	/**
	 * True if the node is a widget class, so it can potentially be
	 * rendered, even if it does not yet have the rendering constructor.
	 * This field is omitted if the node is not a widget class.
	 */
	isWidgetClass?: boolean;

	/**
	 * If the node is a widget class that can be rendered for IDE, the name
	 * of the constructor that should be used to instantiate the widget.
	 * Empty string for default constructor. Absent if the node is not a
	 * widget class that can be rendered.
	 */
	renderConstructor?: string;

	/**
	 * If the node is a StatefulWidget, and its state class is defined in
	 * the same file, the name of the state class.
	 */
	stateClassName?: string;

	/**
	 * If the node is a StatefulWidget that can be rendered, and its state
	 * class is defined in the same file, the offset of the state class code
	 * in the file.
	 */
	stateOffset?: number;

	/**
	 * If the node is a StatefulWidget that can be rendered, and its state
	 * class is defined in the same file, the length of the state class code
	 * in the file.
	 */
	stateLength?: number;
}

/**
 * An attribute for a FlutterOutline.
 */
export interface FlutterOutlineAttribute {
	/**
	 * The name of the attribute.
	 */
	name: string;

	/**
	 * The label of the attribute value, usually the Dart code.
	 * It might be quite long, the client should abbreviate as needed.
	 */
	label: string;

	/**
	 * The boolean literal value of the attribute.
	 * This field is absent if the value is not a boolean literal.
	 */
	literalValueBoolean?: boolean;

	/**
	 * The integer literal value of the attribute.
	 * This field is absent if the value is not an integer literal.
	 */
	literalValueInteger?: number;

	/**
	 * The string literal value of the attribute.
	 * This field is absent if the value is not a string literal.
	 */
	literalValueString?: string;
}

/**
 * An enumeration of the kinds of FlutterOutline elements. The list of kinds
 * might be expanded with time, clients must be able to handle new kinds
 * in some general way.
 */
export type FlutterOutlineKind =
	"DART_ELEMENT"
	| "GENERIC"
	| "NEW_INSTANCE"
	| "INVOCATION"
	| "VARIABLE"
	| "PLACEHOLDER";

/**
 * An enumeration of the services provided by the analysis domain that are
 * general in nature (that is, are not specific to some list of files).
 */
export type GeneralAnalysisService =
	"ANALYZED_FILES";

/**
 * The hover information associated with a specific location.
 */
export interface HoverInformation {
	/**
	 * The offset of the range of characters that encompasses the
	 * cursor position and has the same hover information as the
	 * cursor position.
	 */
	offset: number;

	/**
	 * The length of the range of characters that encompasses the
	 * cursor position and has the same hover information as the
	 * cursor position.
	 */
	length: number;

	/**
	 * The path to the defining compilation unit of the library
	 * in which the referenced element is declared. This data is
	 * omitted if there is no referenced element, or if the
	 * element is declared inside an HTML file.
	 */
	containingLibraryPath?: string;

	/**
	 * The name of the library in which the referenced element is
	 * declared. This data is omitted if there is no referenced
	 * element, or if the element is declared inside an HTML
	 * file.
	 */
	containingLibraryName?: string;

	/**
	 * A human-readable description of the class declaring the element
	 * being referenced. This data is omitted if there is no referenced
	 * element, or if the element is not a class member.
	 */
	containingClassDescription?: string;

	/**
	 * The dartdoc associated with the referenced element. Other
	 * than the removal of the comment delimiters, including
	 * leading asterisks in the case of a block comment, the
	 * dartdoc is unprocessed markdown. This data is omitted if
	 * there is no referenced element, or if the element has no
	 * dartdoc.
	 */
	dartdoc?: string;

	/**
	 * A human-readable description of the element being
	 * referenced. This data is omitted if there is no referenced
	 * element.
	 */
	elementDescription?: string;

	/**
	 * A human-readable description of the kind of element being
	 * referenced (such as "class" or "function type
	 * alias"). This data is omitted if there is no referenced
	 * element.
	 */
	elementKind?: string;

	/**
	 * True if the referenced element is deprecated.
	 */
	isDeprecated?: boolean;

	/**
	 * A human-readable description of the parameter
	 * corresponding to the expression being hovered over. This
	 * data is omitted if the location is not in an argument to a
	 * function.
	 */
	parameter?: string;

	/**
	 * The name of the propagated type of the expression. This
	 * data is omitted if the location does not correspond to an
	 * expression or if there is no propagated type information.
	 */
	propagatedType?: string;

	/**
	 * The name of the static type of the expression. This data
	 * is omitted if the location does not correspond to an
	 * expression.
	 */
	staticType?: string;
}

/**
 * A description of a class that is implemented or extended.
 */
export interface ImplementedClass {
	/**
	 * The offset of the name of the implemented class.
	 */
	offset: number;

	/**
	 * The length of the name of the implemented class.
	 */
	length: number;
}

/**
 * A description of a class member that is implemented or overridden.
 */
export interface ImplementedMember {
	/**
	 * The offset of the name of the implemented member.
	 */
	offset: number;

	/**
	 * The length of the name of the implemented member.
	 */
	length: number;
}

/**
 * A description of the elements that are referenced in a region of a file
 * that come from a single imported library.
 */
export interface ImportedElements {
	/**
	 * The absolute and normalized path of the file containing the library.
	 */
	path: FilePath;

	/**
	 * The prefix that was used when importing the library into the original
	 * source.
	 */
	prefix: string;

	/**
	 * The names of the elements imported from the library.
	 */
	elements: string[];
}

/**
 * A description of a member that overrides an inherited member.
 */
export interface Override {
	/**
	 * The offset of the name of the overriding member.
	 */
	offset: number;

	/**
	 * The length of the name of the overriding member.
	 */
	length: number;

	/**
	 * The member inherited from a superclass that is overridden
	 * by the overriding member. The field is omitted if there is
	 * no superclass member, in which case there must be at least
	 * one interface member.
	 */
	superclassMember?: OverriddenMember;

	/**
	 * The members inherited from interfaces that are overridden
	 * by the overriding member. The field is omitted if there
	 * are no interface members, in which case there must be a
	 * superclass member.
	 */
	interfaceMembers?: OverriddenMember[];
}

/**
 * A description of a member that is being overridden.
 */
export interface OverriddenMember {
	/**
	 * The element that is being overridden.
	 */
	element: Element;

	/**
	 * The name of the class in which the member is defined.
	 */
	className: string;
}

/**
 * The description of a postfix completion template.
 */
export interface PostfixTemplateDescriptor {
	/**
	 * The template name, shown in the UI.
	 */
	name: string;

	/**
	 * The unique template key, not shown in the UI.
	 */
	key: string;

	/**
	 * A short example of the transformation performed when the template is
	 * applied.
	 */
	example: string;
}

/**
 * An indication of the current state of pub execution.
 */
export interface PubStatus {
	/**
	 * True if the server is currently running pub to produce a list of
	 * package directories.
	 */
	isListingPackageDirs: boolean;
}

/**
 * An abstract superclass of all refactoring feedbacks.
 */
export interface RefactoringFeedback { }

/**
 * An abstract superclass of all refactoring options.
 */
export interface RefactoringOptions { }

/**
 * An indication of a problem with the execution of the server,
 * typically in response to a request.
 */
export interface RequestError {
	/**
	 * A code that uniquely identifies the error that occurred.
	 */
	code: RequestErrorCode;

	/**
	 * A short description of the error.
	 */
	message: string;

	/**
	 * The stack trace associated with processing the request,
	 * used for debugging the server.
	 */
	stackTrace?: string;
}

/**
 * An enumeration of the types of errors that can occur in the
 * execution of the server.
 */
export type RequestErrorCode =
	"CONTENT_MODIFIED"
	| "DEBUG_PORT_COULD_NOT_BE_OPENED"
	| "FILE_NOT_ANALYZED"
	| "FORMAT_INVALID_FILE"
	| "FORMAT_WITH_ERRORS"
	| "GET_ERRORS_INVALID_FILE"
	| "GET_IMPORTED_ELEMENTS_INVALID_FILE"
	| "GET_KYTHE_ENTRIES_INVALID_FILE"
	| "GET_NAVIGATION_INVALID_FILE"
	| "GET_REACHABLE_SOURCES_INVALID_FILE"
	| "GET_SIGNATURE_INVALID_FILE"
	| "GET_SIGNATURE_INVALID_OFFSET"
	| "GET_SIGNATURE_UNKNOWN_FUNCTION"
	| "IMPORT_ELEMENTS_INVALID_FILE"
	| "INVALID_ANALYSIS_ROOT"
	| "INVALID_EXECUTION_CONTEXT"
	| "INVALID_FILE_PATH_FORMAT"
	| "INVALID_OVERLAY_CHANGE"
	| "INVALID_PARAMETER"
	| "INVALID_REQUEST"
	| "ORGANIZE_DIRECTIVES_ERROR"
	| "REFACTORING_REQUEST_CANCELLED"
	| "SERVER_ALREADY_STARTED"
	| "SERVER_ERROR"
	| "SORT_MEMBERS_INVALID_FILE"
	| "SORT_MEMBERS_PARSE_ERRORS"
	| "UNKNOWN_FIX"
	| "UNKNOWN_REQUEST"
	| "UNSUPPORTED_FEATURE";

/**
 * An identifier used to associate search results with a search
 * request.
 */
export type SearchId = string;

/**
 * A "fix" that can be specified in an edit.dartfix request.
 */
export interface DartFix {
	/**
	 * The name of the fix.
	 */
	name: string;

	/**
	 * A human readable description of the fix.
	 */
	description?: string;

	/**
	 * `true` if the fix is in the "required" fixes group.
	 */
	isRequired?: boolean;
}

/**
 * A suggestion from an edit.dartfix request.
 */
export interface DartFixSuggestion {
	/**
	 * A human readable description of the suggested change.
	 */
	description: string;

	/**
	 * The location of the suggested change.
	 */
	location?: Location;
}

/**
 * A single result from a search request.
 */
export interface SearchResult {
	/**
	 * The location of the code that matched the search criteria.
	 */
	location: Location;

	/**
	 * The kind of element that was found or the kind of
	 * reference that was found.
	 */
	kind: SearchResultKind;

	/**
	 * True if the result is a potential match but cannot be
	 * confirmed to be a match. For example, if all references to
	 * a method m defined in some class were requested, and a
	 * reference to a method m from an unknown class were found,
	 * it would be marked as being a potential match.
	 */
	isPotential: boolean;

	/**
	 * The elements that contain the result, starting with the
	 * most immediately enclosing ancestor and ending with the
	 * library.
	 */
	path: Element[];
}

/**
 * An enumeration of the kinds of search results returned by the
 * search domain.
 */
export type SearchResultKind =
	"DECLARATION"
	| "INVOCATION"
	| "READ"
	| "READ_WRITE"
	| "REFERENCE"
	| "UNKNOWN"
	| "WRITE";

/**
 * An enumeration of the services provided by the server domain.
 */
export type ServerService =
	"STATUS";

/**
 * A representation of a class in a type hierarchy.
 */
export interface TypeHierarchyItem {
	/**
	 * The class element represented by this item.
	 */
	classElement: Element;

	/**
	 * The name to be displayed for the class. This field will be
	 * omitted if the display name is the same as the name of the
	 * element. The display name is different if there is
	 * additional type information to be displayed, such as type
	 * arguments.
	 */
	displayName?: string;

	/**
	 * The member in the class corresponding to the member on
	 * which the hierarchy was requested. This field will be
	 * omitted if the hierarchy was not requested for a member or
	 * if the class does not have a corresponding member.
	 */
	memberElement?: Element;

	/**
	 * The index of the item representing the superclass of
	 * this class. This field will be omitted if this item
	 * represents the class Object.
	 */
	superclass?: number;

	/**
	 * The indexes of the items representing the interfaces
	 * implemented by this class. The list will be empty if
	 * there are no implemented interfaces.
	 */
	interfaces: number[];

	/**
	 * The indexes of the items representing the mixins
	 * referenced by this class. The list will be empty if
	 * there are no classes mixed in to this class.
	 */
	mixins: number[];

	/**
	 * The indexes of the items representing the subtypes of
	 * this class. The list will be empty if there are no
	 * subtypes or if this item represents a supertype of the
	 * pivot type.
	 */
	subclasses: number[];
}

/**
 * Create a local variable initialized by the expression that covers
 * the specified selection.
 * 
 * It is an error if the selection range is not covered by a
 * complete expression.
 */
export interface ExtractLocalVariableFeedback extends RefactoringFeedback {
	/**
	 * The offsets of the expressions that cover the specified
	 * selection, from the down most to the up most.
	 */
	coveringExpressionOffsets?: number[];

	/**
	 * The lengths of the expressions that cover the specified
	 * selection, from the down most to the up most.
	 */
	coveringExpressionLengths?: number[];

	/**
	 * The proposed names for the local variable.
	 */
	names: string[];

	/**
	 * The offsets of the expressions that would be replaced by
	 * a reference to the variable.
	 */
	offsets: number[];

	/**
	 * The lengths of the expressions that would be replaced by
	 * a reference to the variable. The lengths correspond to
	 * the offsets. In other words, for a given expression, if
	 * the offset of that expression is offsets[i], then
	 * the length of that expression is lengths[i].
	 */
	lengths: number[];
}

/**
 * Create a method whose body is the specified expression or
 * list of statements, possibly augmented with a return
 * statement.
 * 
 * It is an error if the range contains anything other than a
 * complete expression (no partial expressions are allowed) or
 * a complete sequence of statements.
 */
export interface ExtractMethodFeedback extends RefactoringFeedback {
	/**
	 * The offset to the beginning of the expression or
	 * statements that will be extracted.
	 */
	offset: number;

	/**
	 * The length of the expression or statements that will be
	 * extracted.
	 */
	length: number;

	/**
	 * The proposed return type for the method.
	 * If the returned element does not have a declared return type,
	 * this field will contain an empty string.
	 */
	returnType: string;

	/**
	 * The proposed names for the method.
	 */
	names: string[];

	/**
	 * True if a getter could be created rather than a method.
	 */
	canCreateGetter: boolean;

	/**
	 * The proposed parameters for the method.
	 */
	parameters: RefactoringMethodParameter[];

	/**
	 * The offsets of the expressions or statements that would
	 * be replaced by an invocation of the method.
	 */
	offsets: number[];

	/**
	 * The lengths of the expressions or statements that would
	 * be replaced by an invocation of the method. The lengths
	 * correspond to the offsets. In other words, for a given
	 * expression (or block of statements), if the offset of
	 * that expression is offsets[i], then the length
	 * of that expression is lengths[i].
	 */
	lengths: number[];
}

/**
 * Inline the initializer expression of a local variable in
 * place of any references to that variable.
 * 
 * It is an error if the range contains anything other than all
 * or part of the name of a single local variable.
 */
export interface InlineLocalVariableFeedback extends RefactoringFeedback {
	/**
	 * The name of the variable being inlined.
	 */
	name: string;

	/**
	 * The number of times the variable occurs.
	 */
	occurrences: number;
}

/**
 * Inline a method in place of one or all references to that
 * method.
 * 
 * It is an error if the range contains anything other than all
 * or part of the name of a single method.
 */
export interface InlineMethodFeedback extends RefactoringFeedback {
	/**
	 * The name of the class enclosing the method being inlined.
	 * If not a class member is being inlined, this field will be absent.
	 */
	className?: string;

	/**
	 * The name of the method (or function) being inlined.
	 */
	methodName: string;

	/**
	 * True if the declaration of the method is selected.
	 * So all references should be inlined.
	 */
	isDeclaration: boolean;
}

/**
 * Rename a given element and all of the references to that
 * element.
 * 
 * It is an error if the range contains anything other than all
 * or part of the name of a single function (including methods,
 * getters and setters), variable (including fields, parameters
 * and local variables), class or function type.
 */
export interface RenameFeedback extends RefactoringFeedback {
	/**
	 * The offset to the beginning of the name selected to be
	 * renamed, or -1 if the name does not exist yet.
	 */
	offset: number;

	/**
	 * The length of the name selected to be renamed.
	 */
	length: number;

	/**
	 * The human-readable description of the kind of element being
	 * renamed (such as "class" or "function type
	 * alias").
	 */
	elementKindName: string;

	/**
	 * The old name of the element before the refactoring.
	 */
	oldName: string;
}

/**
 * A directive to begin overlaying the contents of a file. The supplied
 * content will be used for analysis in place of the file contents in the
 * filesystem.
 * 
 * If this directive is used on a file that already has a file content
 * overlay, the old overlay is discarded and replaced with the new one.
 */
export interface AddContentOverlay {
	/**
	 * 
	 */
	type: "add";

	/**
	 * The new content of the file.
	 */
	content: string;
}

/**
 * An indication of an error, warning, or hint that was produced by the
 * analysis.
 */
export interface AnalysisError {
	/**
	 * The severity of the error.
	 */
	severity: AnalysisErrorSeverity;

	/**
	 * The type of the error.
	 */
	type: AnalysisErrorType;

	/**
	 * The location associated with the error.
	 */
	location: Location;

	/**
	 * The message to be displayed for this error. The message should
	 * indicate what is wrong with the code and why it is wrong.
	 */
	message: string;

	/**
	 * The correction message to be displayed for this error. The correction
	 * message should indicate how the user can fix the error. The field is
	 * omitted if there is no correction message associated with the error
	 * code.
	 */
	correction?: string;

	/**
	 * The name, as a string, of the error code associated with this error.
	 */
	code: string;


	/**
	 * The URL of a page containing documentation associated with this error.
	 */
	url?: string;

	/**
	 * A hint to indicate to interested clients that this error has an
	 * associated fix (or fixes). The absence of this field implies there
	 * are not known to be fixes. Note that since the operation to calculate
	 * whether fixes apply needs to be performant it is possible that
	 * complicated tests will be skipped and a false negative returned. For
	 * this reason, this attribute should be treated as a "hint". Despite the
	 * possibility of false negatives, no false positives should be returned.
	 * If a client sees this flag set they can proceed with the confidence
	 * that there are in fact associated fixes.
	 */
	hasFix?: boolean;
}

/**
 * An enumeration of the possible severities of analysis errors.
 */
export type AnalysisErrorSeverity =
	"INFO"
	| "WARNING"
	| "ERROR";

/**
 * An enumeration of the possible types of analysis errors.
 */
export type AnalysisErrorType =
	"CHECKED_MODE_COMPILE_TIME_ERROR"
	| "COMPILE_TIME_ERROR"
	| "HINT"
	| "LINT"
	| "STATIC_TYPE_WARNING"
	| "STATIC_WARNING"
	| "SYNTACTIC_ERROR"
	| "TODO";

/**
 * A directive to modify an existing file content overlay. One or more ranges
 * of text are deleted from the old file content overlay and replaced with
 * new text.
 * 
 * The edits are applied in the order in which they occur in the list. This
 * means that the offset of each edit must be correct under the assumption
 * that all previous edits have been applied.
 * 
 * It is an error to use this overlay on a file that does not yet have a file
 * content overlay or that has had its overlay removed via
 * RemoveContentOverlay.
 * 
 * If any of the edits cannot be applied due to its offset or length being
 * out of range, an INVALID_OVERLAY_CHANGE error will be reported.
 */
export interface ChangeContentOverlay {
	/**
	 * 
	 */
	type: "change";

	/**
	 * The edits to be applied to the file.
	 */
	edits: SourceEdit[];
}

/**
 * A suggestion for how to complete partially entered text. Many of the
 * fields are optional, depending on the kind of element being suggested.
 */
export interface CompletionSuggestion {
	/**
	 * The kind of element being suggested.
	 */
	kind: CompletionSuggestionKind;

	/**
	 * The relevance of this completion suggestion where a higher number
	 * indicates a higher relevance.
	 */
	relevance: number;

	/**
	 * The identifier to be inserted if the suggestion is selected. If the
	 * suggestion is for a method or function, the client might want to
	 * additionally insert a template for the parameters. The information
	 * required in order to do so is contained in other fields.
	 */
	completion: string;

	/**
	 * Text to be displayed in, for example, a completion pop-up. This field
	 * is only defined if the displayed text should be different than the
	 * completion.  Otherwise it is omitted.
	 */
	displayText?: string;

	/**
	 * The offset, relative to the beginning of the completion, of where the
	 * selection should be placed after insertion.
	 */
	selectionOffset: number;

	/**
	 * The number of characters that should be selected after insertion.
	 */
	selectionLength: number;

	/**
	 * True if the suggested element is deprecated.
	 */
	isDeprecated: boolean;

	/**
	 * True if the element is not known to be valid for the target. This
	 * happens if the type of the target is dynamic.
	 */
	isPotential: boolean;

	/**
	 * An abbreviated version of the Dartdoc associated with the element
	 * being suggested. This field is omitted if there is no Dartdoc
	 * associated with the element.
	 */
	docSummary?: string;

	/**
	 * The Dartdoc associated with the element being suggested. This field is
	 * omitted if there is no Dartdoc associated with the element.
	 */
	docComplete?: string;

	/**
	 * The class that declares the element being suggested. This field is
	 * omitted if the suggested element is not a member of a class.
	 */
	declaringType?: string;

	/**
	 * A default String for use in generating argument list source contents
	 * on the client side.
	 */
	defaultArgumentListString?: string;

	/**
	 * Pairs of offsets and lengths describing 'defaultArgumentListString'
	 * text ranges suitable for use by clients to set up linked edits of
	 * default argument source contents. For example, given an argument list
	 * string 'x, y', the corresponding text range [0, 1, 3, 1], indicates
	 * two text ranges of length 1, starting at offsets 0 and 3. Clients can
	 * use these ranges to treat the 'x' and 'y' values specially for linked
	 * edits.
	 */
	defaultArgumentListTextRanges?: number[];

	/**
	 * Information about the element reference being suggested.
	 */
	element?: Element;

	/**
	 * The return type of the getter, function or method or the type of the
	 * field being suggested. This field is omitted if the suggested element
	 * is not a getter, function or method.
	 */
	returnType?: string;

	/**
	 * The names of the parameters of the function or method being suggested.
	 * This field is omitted if the suggested element is not a setter,
	 * function or method.
	 */
	parameterNames?: string[];

	/**
	 * The types of the parameters of the function or method being suggested.
	 * This field is omitted if the parameterNames field is omitted.
	 */
	parameterTypes?: string[];

	/**
	 * The number of required parameters for the function or method being
	 * suggested. This field is omitted if the parameterNames field is
	 * omitted.
	 */
	requiredParameterCount?: number;

	/**
	 * True if the function or method being suggested has at least one named
	 * parameter. This field is omitted if the parameterNames field is
	 * omitted.
	 */
	hasNamedParameters?: boolean;

	/**
	 * The name of the optional parameter being suggested. This field is
	 * omitted if the suggestion is not the addition of an optional argument
	 * within an argument list.
	 */
	parameterName?: string;

	/**
	 * The type of the options parameter being suggested. This field is
	 * omitted if the parameterName field is omitted.
	 */
	parameterType?: string;
}

/**
 * An enumeration of the kinds of elements that can be included in a
 * completion suggestion.
 */
export type CompletionSuggestionKind =
	"ARGUMENT_LIST"
	| "IMPORT"
	| "IDENTIFIER"
	| "INVOCATION"
	| "KEYWORD"
	| "NAMED_ARGUMENT"
	| "OPTIONAL_ARGUMENT"
	| "OVERRIDE"
	| "PARAMETER";

/**
 * Information about an element (something that can be declared in code).
 */
export interface Element {
	/**
	 * The kind of the element.
	 */
	kind: ElementKind;

	/**
	 * The name of the element. This is typically used as the label in the
	 * outline.
	 */
	name: string;

	/**
	 * The location of the name in the declaration of the element.
	 */
	location?: Location;

	/**
	 * A bit-map containing the following flags:
	 */
	flags: number;

	/**
	 * The parameter list for the element. If the element is not a method or
	 * function this field will not be defined. If the element doesn't have
	 * parameters (e.g. getter), this field will not be defined. If the
	 * element has zero parameters, this field will have a value of "()".
	 */
	parameters?: string;

	/**
	 * The return type of the element. If the element is not a method or
	 * function this field will not be defined. If the element does not have
	 * a declared return type, this field will contain an empty string.
	 */
	returnType?: string;

	/**
	 * The type parameter list for the element. If the element doesn't have
	 * type parameters, this field will not be defined.
	 */
	typeParameters?: string;
}

/**
 * An enumeration of the kinds of elements.
 */
export type ElementKind =
	"CLASS"
	| "CLASS_TYPE_ALIAS"
	| "COMPILATION_UNIT"
	| "CONSTRUCTOR"
	| "CONSTRUCTOR_INVOCATION"
	| "ENUM"
	| "ENUM_CONSTANT"
	| "FIELD"
	| "FILE"
	| "FUNCTION"
	| "FUNCTION_INVOCATION"
	| "FUNCTION_TYPE_ALIAS"
	| "GETTER"
	| "LABEL"
	| "LIBRARY"
	| "LOCAL_VARIABLE"
	| "METHOD"
	| "MIXIN"
	| "PARAMETER"
	| "PREFIX"
	| "SETTER"
	| "TOP_LEVEL_VARIABLE"
	| "TYPE_PARAMETER"
	| "UNIT_TEST_GROUP"
	| "UNIT_TEST_TEST"
	| "UNKNOWN";

/**
 * The absolute, normalized path of a file.
 * 
 * If the format of a file path in a request is not valid, e.g. the path is
 * not absolute or is not normalized, then an error of type
 * INVALID_FILE_PATH_FORMAT will be generated.
 */
export type FilePath = string;

/**
 * An enumeration of the kinds of folding regions.
 */
export type FoldingKind =
	"ANNOTATIONS"
	| "CLASS_BODY"
	| "DIRECTIVES"
	| "DOCUMENTATION_COMMENT"
	| "FILE_HEADER"
	| "FUNCTION_BODY"
	| "INVOCATION"
	| "LITERAL";

/**
 * A description of a region that can be folded.
 */
export interface FoldingRegion {
	/**
	 * The kind of the region.
	 */
	kind: FoldingKind;

	/**
	 * The offset of the region to be folded.
	 */
	offset: number;

	/**
	 * The length of the region to be folded.
	 */
	length: number;
}

/**
 * A description of a region that could have special highlighting associated
 * with it.
 */
export interface HighlightRegion {
	/**
	 * The type of highlight associated with the region.
	 */
	type: HighlightRegionType;

	/**
	 * The offset of the region to be highlighted.
	 */
	offset: number;

	/**
	 * The length of the region to be highlighted.
	 */
	length: number;
}

/**
 * An enumeration of the kinds of highlighting that can be applied to files.
 */
export type HighlightRegionType =
	"ANNOTATION"
	| "BUILT_IN"
	| "CLASS"
	| "COMMENT_BLOCK"
	| "COMMENT_DOCUMENTATION"
	| "COMMENT_END_OF_LINE"
	| "CONSTRUCTOR"
	| "DIRECTIVE"
	| "DYNAMIC_TYPE"
	| "DYNAMIC_LOCAL_VARIABLE_DECLARATION"
	| "DYNAMIC_LOCAL_VARIABLE_REFERENCE"
	| "DYNAMIC_PARAMETER_DECLARATION"
	| "DYNAMIC_PARAMETER_REFERENCE"
	| "ENUM"
	| "ENUM_CONSTANT"
	| "FIELD"
	| "FIELD_STATIC"
	| "FUNCTION"
	| "FUNCTION_DECLARATION"
	| "FUNCTION_TYPE_ALIAS"
	| "GETTER_DECLARATION"
	| "IDENTIFIER_DEFAULT"
	| "IMPORT_PREFIX"
	| "INSTANCE_FIELD_DECLARATION"
	| "INSTANCE_FIELD_REFERENCE"
	| "INSTANCE_GETTER_DECLARATION"
	| "INSTANCE_GETTER_REFERENCE"
	| "INSTANCE_METHOD_DECLARATION"
	| "INSTANCE_METHOD_REFERENCE"
	| "INSTANCE_SETTER_DECLARATION"
	| "INSTANCE_SETTER_REFERENCE"
	| "INVALID_STRING_ESCAPE"
	| "KEYWORD"
	| "LABEL"
	| "LIBRARY_NAME"
	| "LITERAL_BOOLEAN"
	| "LITERAL_DOUBLE"
	| "LITERAL_INTEGER"
	| "LITERAL_LIST"
	| "LITERAL_MAP"
	| "LITERAL_STRING"
	| "LOCAL_FUNCTION_DECLARATION"
	| "LOCAL_FUNCTION_REFERENCE"
	| "LOCAL_VARIABLE"
	| "LOCAL_VARIABLE_DECLARATION"
	| "LOCAL_VARIABLE_REFERENCE"
	| "METHOD"
	| "METHOD_DECLARATION"
	| "METHOD_DECLARATION_STATIC"
	| "METHOD_STATIC"
	| "PARAMETER"
	| "SETTER_DECLARATION"
	| "TOP_LEVEL_VARIABLE"
	| "PARAMETER_DECLARATION"
	| "PARAMETER_REFERENCE"
	| "STATIC_FIELD_DECLARATION"
	| "STATIC_GETTER_DECLARATION"
	| "STATIC_GETTER_REFERENCE"
	| "STATIC_METHOD_DECLARATION"
	| "STATIC_METHOD_REFERENCE"
	| "STATIC_SETTER_DECLARATION"
	| "STATIC_SETTER_REFERENCE"
	| "TOP_LEVEL_FUNCTION_DECLARATION"
	| "TOP_LEVEL_FUNCTION_REFERENCE"
	| "TOP_LEVEL_GETTER_DECLARATION"
	| "TOP_LEVEL_GETTER_REFERENCE"
	| "TOP_LEVEL_SETTER_DECLARATION"
	| "TOP_LEVEL_SETTER_REFERENCE"
	| "TOP_LEVEL_VARIABLE_DECLARATION"
	| "TYPE_NAME_DYNAMIC"
	| "TYPE_PARAMETER"
	| "UNRESOLVED_INSTANCE_MEMBER_REFERENCE"
	| "VALID_STRING_ESCAPE";

/**
 * This object matches the format and documentation of the Entry object
 * documented in the
 * Kythe Storage
 * Model.
 */
export interface KytheEntry {
	/**
	 * The ticket of the source node.
	 */
	source: KytheVName;

	/**
	 * An edge label. The schema defines which labels are meaningful.
	 */
	kind?: string;

	/**
	 * The ticket of the target node.
	 */
	target?: KytheVName;

	/**
	 * A fact label. The schema defines which fact labels are meaningful.
	 */
	fact: string;

	/**
	 * The String value of the fact.
	 */
	value?: number[];
}

/**
 * This object matches the format and documentation of the Vector-Name object
 * documented in the
 * Kythe
 * Storage Model.
 */
export interface KytheVName {
	/**
	 * An opaque signature generated by the analyzer.
	 */
	signature: string;

	/**
	 * The corpus of source code this KytheVName belongs to.
	 * Loosely, a corpus is a collection of related files, such as the
	 * contents of a given source repository.
	 */
	corpus: string;

	/**
	 * A corpus-specific root label, typically a directory path or project
	 * identifier, denoting a distinct subset of the corpus. This may also be
	 * used to designate virtual collections like generated files.
	 */
	root: string;

	/**
	 * A path-structured label describing the “location” of the named object
	 * relative to the corpus and the root.
	 */
	path: string;

	/**
	 * The language this name belongs to.
	 */
	language: string;
}

/**
 * A collection of positions that should be linked (edited simultaneously)
 * for the purposes of updating code after a source change. For example, if a
 * set of edits introduced a new variable name, the group would contain all
 * of the positions of the variable name so that if the client wanted to let
 * the user edit the variable name after the operation, all occurrences of
 * the name could be edited simultaneously.
 */
export interface LinkedEditGroup {
	/**
	 * The positions of the regions that should be edited simultaneously.
	 */
	positions: Position[];

	/**
	 * The length of the regions that should be edited simultaneously.
	 */
	length: number;

	/**
	 * Pre-computed suggestions for what every region might want to be
	 * changed to.
	 */
	suggestions: LinkedEditSuggestion[];
}

/**
 * A suggestion of a value that could be used to replace all of the linked
 * edit regions in a LinkedEditGroup.
 */
export interface LinkedEditSuggestion {
	/**
	 * The value that could be used to replace all of the linked edit
	 * regions.
	 */
	value: string;

	/**
	 * The kind of value being proposed.
	 */
	kind: LinkedEditSuggestionKind;
}

/**
 * An enumeration of the kind of values that can be suggested for a linked
 * edit.
 */
export type LinkedEditSuggestionKind =
	"METHOD"
	| "PARAMETER"
	| "TYPE"
	| "VARIABLE";

/**
 * A location (character range) within a file.
 */
export interface Location {
	/**
	 * The file containing the range.
	 */
	file: FilePath;

	/**
	 * The offset of the range.
	 */
	offset: number;

	/**
	 * The length of the range.
	 */
	length: number;

	/**
	 * The one-based index of the line containing the first character of the
	 * range.
	 */
	startLine: number;

	/**
	 * The one-based index of the column containing the first character of
	 * the range.
	 */
	startColumn: number;
}

/**
 * A description of a region from which the user can navigate to the
 * declaration of an element.
 */
export interface NavigationRegion {
	/**
	 * The offset of the region from which the user can navigate.
	 */
	offset: number;

	/**
	 * The length of the region from which the user can navigate.
	 */
	length: number;

	/**
	 * The indexes of the targets (in the enclosing navigation response) to
	 * which the given region is bound. By opening the target, clients can
	 * implement one form of navigation. This list cannot be empty.
	 */
	targets: number[];
}

/**
 * A description of a target to which the user can navigate.
 */
export interface NavigationTarget {
	/**
	 * The kind of the element.
	 */
	kind: ElementKind;

	/**
	 * The index of the file (in the enclosing navigation response) to
	 * navigate to.
	 */
	fileIndex: number;

	/**
	 * The offset of the region to which the user can navigate.
	 */
	offset: number;

	/**
	 * The length of the region to which the user can navigate.
	 */
	length: number;

	/**
	 * The one-based index of the line containing the first character of the
	 * region.
	 */
	startLine: number;

	/**
	 * The one-based index of the column containing the first character of
	 * the region.
	 */
	startColumn: number;
}

/**
 * A description of the references to a single element within a single file.
 */
export interface Occurrences {
	/**
	 * The element that was referenced.
	 */
	element: Element;

	/**
	 * The offsets of the name of the referenced element within the file.
	 */
	offsets: number[];

	/**
	 * The length of the name of the referenced element.
	 */
	length: number;
}

/**
 * An node in the outline structure of a file.
 */
export interface Outline {
	/**
	 * A description of the element represented by this node.
	 */
	element: Element;

	/**
	 * The offset of the first character of the element. This is different
	 * than the offset in the Element, which is the offset of the name of the
	 * element. It can be used, for example, to map locations in the file
	 * back to an outline.
	 */
	offset: number;

	/**
	 * The length of the element.
	 */
	length: number;

	/**
	 * The offset of the first character of the element code, which is
	 * neither documentation, nor annotation.
	 */
	codeOffset: number;

	/**
	 * The length of the element code.
	 */
	codeLength: number;

	/**
	 * The children of the node. The field will be omitted if the node has no
	 * children. Children are sorted by offset.
	 */
	children?: Outline[];
}

/**
 * A description of a member that is being overridden.
 */
export interface ParameterInfo {
	/**
	 * The kind of the parameter.
	 */
	kind: ParameterKind;

	/**
	 * The name of the parameter.
	 */
	name: string;

	/**
	 * The type of the parameter.
	 */
	type: string;

	/**
	 * The default value for this parameter. This value will be omitted if the parameter
	 * does not have a default value.
	 */
	defaultValue?: string;
}

/**
 * An enumeration of the types of parameters.
 */
export type ParameterKind =
	"NAMED"
	| "OPTIONAL"
	| "REQUIRED";

/**
 * A position within a file.
 */
export interface Position {
	/**
	 * The file containing the position.
	 */
	file: FilePath;

	/**
	 * The offset of the position.
	 */
	offset: number;
}

/**
 * An enumeration of the kinds of refactorings that can be created.
 */
export type RefactoringKind =
	"CONVERT_GETTER_TO_METHOD"
	| "CONVERT_METHOD_TO_GETTER"
	| "EXTRACT_LOCAL_VARIABLE"
	| "EXTRACT_METHOD"
	| "EXTRACT_WIDGET"
	| "INLINE_LOCAL_VARIABLE"
	| "INLINE_METHOD"
	| "MOVE_FILE"
	| "RENAME";

/**
 * A description of a parameter in a method refactoring.
 */
export interface RefactoringMethodParameter {
	/**
	 * The unique identifier of the parameter. Clients may omit this field
	 * for the parameters they want to add.
	 */
	id?: string;

	/**
	 * The kind of the parameter.
	 */
	kind: RefactoringMethodParameterKind;

	/**
	 * The type that should be given to the parameter, or the return type of
	 * the parameter's function type.
	 */
	type: string;

	/**
	 * The name that should be given to the parameter.
	 */
	name: string;

	/**
	 * The parameter list of the parameter's function type. If the parameter
	 * is not of a function type, this field will not be defined. If the
	 * function type has zero parameters, this field will have a value of
	 * '()'.
	 */
	parameters?: string;
}

/**
 * An enumeration of the kinds of parameters.
 */
export type RefactoringMethodParameterKind =
	"REQUIRED"
	| "POSITIONAL"
	| "NAMED";

/**
 * A description of a problem related to a refactoring.
 */
export interface RefactoringProblem {
	/**
	 * The severity of the problem being represented.
	 */
	severity: RefactoringProblemSeverity;

	/**
	 * A human-readable description of the problem being represented.
	 */
	message: string;

	/**
	 * The location of the problem being represented. This field is omitted
	 * unless there is a specific location associated with the problem (such
	 * as a location where an element being renamed will be shadowed).
	 */
	location?: Location;
}

/**
 * An enumeration of the severities of problems that can be returned by the
 * refactoring requests.
 */
export type RefactoringProblemSeverity =
	"INFO"
	| "WARNING"
	| "ERROR"
	| "FATAL";

/**
 * A directive to remove an existing file content overlay. After processing
 * this directive, the file contents will once again be read from the file
 * system.
 * 
 * If this directive is used on a file that doesn't currently have a content
 * overlay, it has no effect.
 */
export interface RemoveContentOverlay {
	/**
	 * 
	 */
	type: "remove";
}

/**
 * A description of a set of edits that implement a single conceptual change.
 */
export interface SourceChange {
	/**
	 * A human-readable description of the change to be applied.
	 */
	message: string;

	/**
	 * A list of the edits used to effect the change, grouped by file.
	 */
	edits: SourceFileEdit[];

	/**
	 * A list of the linked editing groups used to customize the changes that
	 * were made.
	 */
	linkedEditGroups: LinkedEditGroup[];

	/**
	 * The position that should be selected after the edits have been
	 * applied.
	 */
	selection?: Position;

	/**
	 * The optional identifier of the change kind. The identifier remains
	 * stable even if the message changes, or is parameterized.
	 */
	id?: string;
}

/**
 * A description of a single change to a single file.
 */
export interface SourceEdit {
	/**
	 * The offset of the region to be modified.
	 */
	offset: number;

	/**
	 * The length of the region to be modified.
	 */
	length: number;

	/**
	 * The code that is to replace the specified region in the original code.
	 */
	replacement: string;

	/**
	 * An identifier that uniquely identifies this source edit from other
	 * edits in the same response. This field is omitted unless a containing
	 * structure needs to be able to identify the edit for some reason.
	 * 
	 * For example, some refactoring operations can produce edits that might
	 * not be appropriate (referred to as potential edits). Such edits will
	 * have an id so that they can be referenced. Edits in the same response
	 * that do not need to be referenced will not have an id.
	 */
	id?: string;
}

/**
 * A description of a set of changes to a single file.
 */
export interface SourceFileEdit {
	/**
	 * The file containing the code to be modified.
	 */
	file: FilePath;

	/**
	 * The modification stamp of the file at the moment when the change was
	 * created, in milliseconds since the "Unix epoch". Will be -1 if the
	 * file did not exist and should be created. The client may use this
	 * field to make sure that the file was not changed since then, so it is
	 * safe to apply the change.
	 */
	fileStamp: number;

	/**
	 * A list of the edits used to effect the change.
	 */
	edits: SourceEdit[];
}

