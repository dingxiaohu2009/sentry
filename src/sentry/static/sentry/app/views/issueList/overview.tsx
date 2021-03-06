import React from 'react';
import {browserHistory} from 'react-router';
import {RouteComponentProps} from 'react-router/lib/Router';
import {css} from '@emotion/core';
import styled from '@emotion/styled';
import {withProfiler} from '@sentry/react';
import {Location} from 'history';
import Cookies from 'js-cookie';
import isEqual from 'lodash/isEqual';
import pickBy from 'lodash/pickBy';
import * as qs from 'query-string';

import {fetchOrgMembers, indexMembersByProject} from 'app/actionCreators/members';
import {
  deleteSavedSearch,
  fetchSavedSearches,
  resetSavedSearches,
} from 'app/actionCreators/savedSearches';
import {fetchTagValues, loadOrganizationTags} from 'app/actionCreators/tags';
import {Client} from 'app/api';
import Feature from 'app/components/acl/feature';
import LoadingError from 'app/components/loadingError';
import LoadingIndicator from 'app/components/loadingIndicator';
import {extractSelectionParameters} from 'app/components/organizations/globalSelectionHeader/utils';
import Pagination from 'app/components/pagination';
import {Panel, PanelBody} from 'app/components/panels';
import QueryCount from 'app/components/queryCount';
import StreamGroup from 'app/components/stream/group';
import ProcessingIssueList from 'app/components/stream/processingIssueList';
import {DEFAULT_QUERY, DEFAULT_STATS_PERIOD} from 'app/constants';
import {tct} from 'app/locale';
import GroupStore from 'app/stores/groupStore';
import {PageContent} from 'app/styles/organization';
import space from 'app/styles/space';
import {
  GlobalSelection,
  Member,
  Organization,
  SavedSearch,
  TagCollection,
} from 'app/types';
import {defined} from 'app/utils';
import {analytics, metric} from 'app/utils/analytics';
import {callIfFunction} from 'app/utils/callIfFunction';
import CursorPoller from 'app/utils/cursorPoller';
import {getUtcDateString} from 'app/utils/dates';
import parseApiError from 'app/utils/parseApiError';
import parseLinkHeader from 'app/utils/parseLinkHeader';
import StreamManager from 'app/utils/streamManager';
import withApi from 'app/utils/withApi';
import withGlobalSelection from 'app/utils/withGlobalSelection';
import withIssueTags from 'app/utils/withIssueTags';
import withOrganization from 'app/utils/withOrganization';
import withSavedSearches from 'app/utils/withSavedSearches';

import IssueListActions from './actions';
import IssueListFilters from './filters';
import IssueListHeader from './header';
import NoGroupsHandler from './noGroupsHandler';
import IssueListSidebar from './sidebar';

const MAX_ITEMS = 25;
const DEFAULT_SORT = 'date';
// the default period for the graph in each issue row
const DEFAULT_GRAPH_STATS_PERIOD = '24h';
// the allowed period choices for graph in each issue row
const DYNAMIC_COUNTS_STATS_PERIODS = new Set(['14d', '24h', 'auto']);

type Params = {
  orgId: string;
};

type Props = {
  api: Client;
  location: Location;
  organization: Organization;
  params: Params;
  selection: GlobalSelection;
  savedSearch: SavedSearch;
  savedSearches: SavedSearch[];
  savedSearchLoading: boolean;
  tags: TagCollection;
} & RouteComponentProps<{searchId?: string}, {}>;

type State = {
  groupIds: string[];
  selectAllActive: boolean;
  realtimeActive: boolean;
  pageLinks: string;
  queryCount: number;
  queryMaxCount: number;
  error: string | null;
  isSidebarVisible: boolean;
  renderSidebar: boolean;
  issuesLoading: boolean;
  tagsLoading: boolean;
  memberList: ReturnType<typeof indexMembersByProject>;
  query?: string;
};

type EndpointParams = Partial<GlobalSelection['datetime']> & {
  project: number[];
  environment: string[];
  query?: string;
  sort?: string;
  statsPeriod?: string;
  groupStatsPeriod?: string;
  cursor?: string;
  page?: number | string;
};

class IssueListOverview extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);

    const realtimeActiveCookie = Cookies.get('realtimeActive');
    const realtimeActive =
      typeof realtimeActiveCookie === 'undefined'
        ? false
        : realtimeActiveCookie === 'true';

    this.state = {
      groupIds: [],
      selectAllActive: false,
      realtimeActive,
      pageLinks: '',
      queryCount: 0,
      queryMaxCount: 0,
      error: null,
      isSidebarVisible: false,
      renderSidebar: false,
      issuesLoading: true,
      tagsLoading: true,
      memberList: {},
    };
  }

  componentDidMount() {
    const links = parseLinkHeader(this.state.pageLinks);
    this._poller = new CursorPoller({
      endpoint: links.previous?.href || '',
      success: this.onRealtimePoll,
    });

    // Start by getting searches first so if the user is on a saved search
    // or they have a pinned search we load the correct data the first time.
    this.fetchSavedSearches();
    this.fetchTags();
    this.fetchMemberList();
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    // Fire off profiling/metrics first
    if (prevState.issuesLoading && !this.state.issuesLoading) {
      // First Meaningful Paint for /organizations/:orgId/issues/
      if (prevState.queryCount === null) {
        metric.measure({
          name: 'app.page.perf.issue-list',
          start: 'page-issue-list-start',
          data: {
            // start_type is set on 'page-issue-list-start'
            org_id: parseInt(this.props.organization.id, 10),
            group: this.props.organization.features.includes('enterprise-perf')
              ? 'enterprise-perf'
              : 'control',
            milestone: 'first-meaningful-paint',
            is_enterprise: this.props.organization.features
              .includes('enterprise-orgs')
              .toString(),
            is_outlier: this.props.organization.features
              .includes('enterprise-orgs-outliers')
              .toString(),
          },
        });
        metric.endTransaction({name: '/organizations/:orgId/issues/'});
      }
    }

    if (prevState.realtimeActive !== this.state.realtimeActive) {
      // User toggled realtime button
      if (this.state.realtimeActive) {
        this.resumePolling();
      } else {
        this._poller.disable();
      }
    }

    // If the project selection has changed reload the member list and tag keys
    // allowing autocomplete and tag sidebar to be more accurate.
    if (!isEqual(prevProps.selection.projects, this.props.selection.projects)) {
      this.fetchMemberList();
      this.fetchTags();
    }

    // Wait for saved searches to load before we attempt to fetch stream data
    if (this.props.savedSearchLoading) {
      return;
    } else if (prevProps.savedSearchLoading) {
      this.fetchData();
      return;
    }

    const prevQuery = prevProps.location.query;
    const newQuery = this.props.location.query;

    // If any important url parameter changed or saved search changed
    // reload data.
    if (
      !isEqual(prevProps.selection, this.props.selection) ||
      prevQuery.cursor !== newQuery.cursor ||
      prevQuery.sort !== newQuery.sort ||
      prevQuery.query !== newQuery.query ||
      prevQuery.statsPeriod !== newQuery.statsPeriod ||
      prevQuery.groupStatsPeriod !== newQuery.groupStatsPeriod ||
      prevProps.savedSearch !== this.props.savedSearch
    ) {
      this.fetchData();
    } else if (
      !this._lastRequest &&
      prevState.issuesLoading === false &&
      this.state.issuesLoading
    ) {
      // Reload if we issues are loading or their loading state changed.
      // This can happen when transitionTo is called
      this.fetchData();
    }
  }

  componentWillUnmount() {
    this._poller.disable();
    GroupStore.reset();
    this.props.api.clear();
    callIfFunction(this.listener);
    // Reset store when unmounting because we always fetch on mount
    // This means if you navigate away from stream and then back to stream,
    // this component will go from:
    // "ready" ->
    // "loading" (because fetching saved searches) ->
    // "ready"
    //
    // We don't render anything until saved searches is ready, so this can
    // cause weird side effects (e.g. ProcessingIssueList mounting and making
    // a request, but immediately unmounting when fetching saved searches)
    resetSavedSearches();
  }

  private _poller: any;
  private _lastRequest: any;
  private _streamManager = new StreamManager(GroupStore);

  getQuery(): string {
    if (this.props.savedSearch) {
      return this.props.savedSearch.query;
    }

    const {query} = this.props.location.query;

    if (query !== undefined) {
      return query as string;
    }

    return DEFAULT_QUERY;
  }

  getSort(): string {
    return (this.props.location.query.sort as string) || DEFAULT_SORT;
  }

  getGroupStatsPeriod(): string {
    const currentPeriod =
      typeof this.props.location.query?.groupStatsPeriod === 'string'
        ? this.props.location.query?.groupStatsPeriod
        : DEFAULT_GRAPH_STATS_PERIOD;
    return DYNAMIC_COUNTS_STATS_PERIODS.has(currentPeriod)
      ? currentPeriod
      : DEFAULT_GRAPH_STATS_PERIOD;
  }

  getEndpointParams = (): EndpointParams => {
    const {selection} = this.props;

    const params: EndpointParams = {
      project: selection.projects,
      environment: selection.environments,
      query: this.getQuery(),
      ...selection.datetime,
    };

    if (selection.datetime.period) {
      delete params.period;
      params.statsPeriod = selection.datetime.period;
    }
    if (params.end) {
      params.end = getUtcDateString(params.end);
    }
    if (params.start) {
      params.start = getUtcDateString(params.start);
    }

    const sort = this.getSort();
    if (sort !== DEFAULT_SORT) {
      params.sort = sort;
    }

    const groupStatsPeriod = this.getGroupStatsPeriod();
    if (groupStatsPeriod !== DEFAULT_GRAPH_STATS_PERIOD) {
      params.groupStatsPeriod = groupStatsPeriod;
    }

    // only include defined values.
    return pickBy(params, v => defined(v)) as EndpointParams;
  };

  getGlobalSearchProjectIds = () => {
    return this.props.selection.projects;
  };

  fetchMemberList() {
    const projectIds = this.getGlobalSearchProjectIds()?.map(projectId =>
      String(projectId)
    );

    fetchOrgMembers(this.props.api, this.props.organization.slug, projectIds).then(
      members => {
        this.setState({memberList: indexMembersByProject(members)});
      }
    );
  }

  fetchTags() {
    const {organization, selection} = this.props;
    this.setState({tagsLoading: true});
    loadOrganizationTags(this.props.api, organization.slug, selection).then(() =>
      this.setState({tagsLoading: false})
    );
  }

  fetchData = () => {
    GroupStore.loadInitialData([]);

    this.setState({
      issuesLoading: true,
      queryCount: 0,
      error: null,
    });

    const requestParams: any = {
      ...this.getEndpointParams(),
      limit: MAX_ITEMS,
      shortIdLookup: 1,
    };

    const currentQuery = this.props.location.query || {};
    if ('cursor' in currentQuery) {
      requestParams.cursor = currentQuery.cursor;
    }

    // If no stats period values are set, use default
    if (!requestParams.statsPeriod && !requestParams.start) {
      requestParams.statsPeriod = DEFAULT_STATS_PERIOD;
    }

    const orgFeatures = new Set(this.props.organization.features);
    if (orgFeatures.has('inbox')) {
      requestParams.expand = 'inbox';
    }

    if (this._lastRequest) {
      this._lastRequest.cancel();
    }

    this._poller.disable();

    this._lastRequest = this.props.api.request(this.getGroupListEndpoint(), {
      method: 'GET',
      data: qs.stringify(requestParams),
      success: (data, _, jqXHR) => {
        if (!jqXHR) {
          return;
        }

        const {orgId} = this.props.params;
        // If this is a direct hit, we redirect to the intended result directly.
        if (jqXHR.getResponseHeader('X-Sentry-Direct-Hit') === '1') {
          let redirect: string;
          if (data[0] && data[0].matchingEventId) {
            const {id, matchingEventId} = data[0];
            redirect = `/organizations/${orgId}/issues/${id}/events/${matchingEventId}/`;
          } else {
            const {id} = data[0];
            redirect = `/organizations/${orgId}/issues/${id}/`;
          }

          browserHistory.replace({
            pathname: redirect,
            query: extractSelectionParameters(this.props.location.query),
          });
          return;
        }

        this._streamManager.push(data);

        const queryCount = jqXHR.getResponseHeader('X-Hits');
        const queryMaxCount = jqXHR.getResponseHeader('X-Max-Hits');
        const pageLinks = jqXHR.getResponseHeader('Link');

        this.setState({
          error: null,
          issuesLoading: false,
          queryCount:
            typeof queryCount !== 'undefined' && queryCount
              ? parseInt(queryCount, 10) || 0
              : 0,
          queryMaxCount:
            typeof queryMaxCount !== 'undefined' && queryMaxCount
              ? parseInt(queryMaxCount, 10) || 0
              : 0,
          pageLinks: pageLinks !== null ? pageLinks : '',
        });
      },
      error: err => {
        this.setState({
          error: parseApiError(err),
          issuesLoading: false,
        });
      },
      complete: () => {
        this._lastRequest = null;

        this.resumePolling();
      },
    });
  };

  resumePolling = () => {
    if (!this.state.pageLinks) {
      return;
    }

    // Only resume polling if we're on the first page of results
    const links = parseLinkHeader(this.state.pageLinks);
    if (links && !links.previous.results && this.state.realtimeActive) {
      this._poller.setEndpoint(links.previous.href);
      this._poller.enable();
    }
  };

  getGroupListEndpoint(): string {
    const params = this.props.params;

    return `/organizations/${params.orgId}/issues/`;
  }

  onRealtimeChange = (realtime: boolean) => {
    Cookies.set('realtimeActive', realtime.toString());
    this.setState({
      realtimeActive: realtime,
    });
  };

  onSelectStatsPeriod = (period: string) => {
    if (period !== this.getGroupStatsPeriod()) {
      this.transitionTo({groupStatsPeriod: period});
    }
  };

  onRealtimePoll = (data: any, _links: any) => {
    // Note: We do not update state with cursors from polling,
    // `CursorPoller` updates itself with new cursors
    this._streamManager.unshift(data);
  };

  listener = GroupStore.listen(() => this.onGroupChange(), undefined);

  onGroupChange() {
    const groupIds = this._streamManager.getAllItems().map(item => item.id);
    if (!isEqual(groupIds, this.state.groupIds)) {
      this.setState({groupIds});
    }
  }

  onIssueListSidebarSearch = (query: string) => {
    analytics('search.searched', {
      org_id: this.props.organization.id,
      query,
      search_type: 'issues',
      search_source: 'search_builder',
    });

    this.onSearch(query);
  };

  onSearch = (query: string) => {
    if (query === this.state.query) {
      // if query is the same, just re-fetch data
      this.fetchData();
    } else {
      // Clear the saved search as the user wants something else.
      this.transitionTo({query}, null);
    }
  };

  onSortChange = (sort: string) => {
    this.transitionTo({sort});
  };

  onCursorChange = (cursor: string | undefined, _path, query, pageDiff: number) => {
    const queryPageInt = parseInt(query.page, 10);
    let nextPage: number | undefined = isNaN(queryPageInt)
      ? pageDiff
      : queryPageInt + pageDiff;

    // unset cursor and page when we navigate back to the first page
    // also reset cursor if somehow the previous button is enabled on
    // first page and user attempts to go backwards
    if (nextPage <= 0) {
      cursor = undefined;
      nextPage = undefined;
    }

    this.transitionTo({cursor, page: nextPage});
  };

  onSidebarToggle = () => {
    const {organization} = this.props;
    this.setState({
      isSidebarVisible: !this.state.isSidebarVisible,
      renderSidebar: true,
    });
    analytics('issue.search_sidebar_clicked', {
      org_id: parseInt(organization.id, 10),
    });
  };

  /**
   * Returns true if all results in the current query are visible/on this page
   */
  allResultsVisible(): boolean {
    if (!this.state.pageLinks) {
      return false;
    }

    const links = parseLinkHeader(this.state.pageLinks);
    return links && !links.previous.results && !links.next.results;
  }

  transitionTo = (
    newParams: Partial<EndpointParams> = {},
    savedSearch: (SavedSearch & {projectId?: number}) | null = this.props.savedSearch
  ) => {
    const query = {
      ...this.getEndpointParams(),
      ...newParams,
    };
    const {organization} = this.props;
    let path: string;

    if (savedSearch && savedSearch.id) {
      path = `/organizations/${organization.slug}/issues/searches/${savedSearch.id}/`;

      // Remove the query as saved searches bring their own query string.
      delete query.query;

      // If we aren't going to another page in the same search
      // drop the query and replace the current project, with the saved search search project
      // if available.
      if (!query.cursor && savedSearch.projectId) {
        query.project = [savedSearch.projectId];
      }
    } else {
      path = `/organizations/${organization.slug}/issues/`;
    }

    if (
      path !== this.props.location.pathname ||
      !isEqual(query, this.props.location.query)
    ) {
      browserHistory.push({
        pathname: path,
        query,
      });
      this.setState({issuesLoading: true});
    }
  };

  renderGroupNodes = (ids: string[], groupStatsPeriod: string) => {
    const topIssue = ids[0];
    const {memberList} = this.state;

    const groupNodes = ids.map(id => {
      const hasGuideAnchor = id === topIssue;
      const group = GroupStore.get(id);
      let members: Member['user'][] | undefined;
      if (group && group.project) {
        members = memberList[group.project.slug];
      }

      return (
        <StreamGroup
          key={id}
          id={id}
          statsPeriod={groupStatsPeriod}
          query={this.getQuery()}
          hasGuideAnchor={hasGuideAnchor}
          memberList={members}
          useFilteredStats
        />
      );
    });
    return <PanelBody>{groupNodes}</PanelBody>;
  };

  renderLoading(): React.ReactNode {
    return <LoadingIndicator />;
  }

  renderStreamBody(): React.ReactNode {
    let body: React.ReactNode;
    if (this.state.issuesLoading) {
      body = this.renderLoading();
    } else if (this.state.error) {
      body = <LoadingError message={this.state.error} onRetry={this.fetchData} />;
    } else if (this.state.groupIds.length > 0) {
      body = this.renderGroupNodes(this.state.groupIds, this.getGroupStatsPeriod());
    } else {
      body = (
        <NoGroupsHandler
          api={this.props.api}
          organization={this.props.organization}
          query={this.getQuery()}
          selectedProjectIds={this.props.selection.projects}
          groupIds={this.state.groupIds}
        />
      );
    }
    return body;
  }

  fetchSavedSearches = () => {
    const {organization} = this.props;

    fetchSavedSearches(this.props.api, organization.slug);
  };

  onSavedSearchSelect = (savedSearch: SavedSearch) => {
    this.setState({issuesLoading: true}, () => this.transitionTo(undefined, savedSearch));
  };

  onSavedSearchDelete = (search: SavedSearch) => {
    const {orgId} = this.props.params;

    deleteSavedSearch(this.props.api, orgId, search).then(() => {
      this.setState(
        {
          issuesLoading: true,
        },
        () => this.transitionTo({}, null)
      );
    });
  };

  handleTabClick = (query: string) => {
    this.transitionTo({query}, null);
  };

  tagValueLoader = (key: string, search: string) => {
    const {orgId} = this.props.params;
    const projectIds = this.getGlobalSearchProjectIds().map(id => id.toString());
    const endpointParams = this.getEndpointParams();

    return fetchTagValues(
      this.props.api,
      orgId,
      key,
      search,
      projectIds,
      endpointParams as any
    );
  };

  render() {
    if (this.props.savedSearchLoading) {
      return this.renderLoading();
    }

    const {
      renderSidebar,
      isSidebarVisible,
      tagsLoading,
      pageLinks,
      queryCount,
      realtimeActive,
      groupIds,
      queryMaxCount,
    } = this.state;
    const {
      organization,
      savedSearch,
      savedSearches,
      tags,
      selection,
      location,
    } = this.props;
    const query = this.getQuery();
    const queryPageInt = parseInt(location.query.page, 10);
    const page = isNaN(queryPageInt) ? 0 : queryPageInt;
    const pageCount = page * MAX_ITEMS + groupIds?.length;

    // TODO(workflow): When organization:inbox flag is removed add 'inbox' to tagStore
    if (organization.features.includes('inbox') && !tags?.is?.values?.includes('inbox')) {
      tags?.is?.values?.push('inbox');
    }

    return (
      <Feature organization={organization} features={['organizations:inbox']}>
        {({hasFeature}) => (
          <React.Fragment>
            {hasFeature && (
              <IssueListHeader
                query={query}
                queryCount={queryCount}
                queryMaxCount={queryMaxCount}
                onTabChange={this.handleTabClick}
              />
            )}
            <StyledPageContent isInbox={hasFeature}>
              <StreamContent showSidebar={isSidebarVisible}>
                <IssueListFilters
                  organization={organization}
                  query={query}
                  savedSearch={savedSearch}
                  sort={this.getSort()}
                  queryCount={queryCount}
                  queryMaxCount={queryMaxCount}
                  onSortChange={this.onSortChange}
                  onSearch={this.onSearch}
                  onSavedSearchSelect={this.onSavedSearchSelect}
                  onSavedSearchDelete={this.onSavedSearchDelete}
                  onSidebarToggle={this.onSidebarToggle}
                  isSearchDisabled={isSidebarVisible}
                  savedSearchList={savedSearches}
                  tagValueLoader={this.tagValueLoader}
                  tags={tags}
                />

                <Panel>
                  <IssueListActions
                    orgId={organization.slug}
                    organization={organization}
                    selection={selection}
                    query={query}
                    queryCount={queryCount}
                    onSelectStatsPeriod={this.onSelectStatsPeriod}
                    onRealtimeChange={this.onRealtimeChange}
                    realtimeActive={realtimeActive}
                    statsPeriod={this.getGroupStatsPeriod()}
                    groupIds={groupIds}
                    allResultsVisible={this.allResultsVisible()}
                  />
                  <PanelBody>
                    <ProcessingIssueList
                      organization={organization}
                      projectIds={selection?.projects?.map(p => p.toString())}
                      showProject
                    />
                    {this.renderStreamBody()}
                  </PanelBody>
                </Panel>
                <PaginationWrapper>
                  {hasFeature && groupIds?.length > 0 && (
                    <div>
                      {/* total includes its own space */}
                      {tct('Showing [count] of[total] issues', {
                        count: <React.Fragment>{pageCount}</React.Fragment>,
                        total: (
                          <QueryCount hideParens count={queryCount} max={queryMaxCount} />
                        ),
                      })}
                    </div>
                  )}
                  <StyledPagination
                    pageLinks={pageLinks}
                    onCursor={this.onCursorChange}
                  />
                </PaginationWrapper>
              </StreamContent>

              <SidebarContainer showSidebar={isSidebarVisible}>
                {/* Avoid rendering sidebar until first accessed */}
                {renderSidebar && (
                  <IssueListSidebar
                    loading={tagsLoading}
                    tags={tags}
                    query={query}
                    onQueryChange={this.onIssueListSidebarSearch}
                    orgId={organization.slug}
                    tagValueLoader={this.tagValueLoader}
                  />
                )}
              </SidebarContainer>
            </StyledPageContent>
          </React.Fragment>
        )}
      </Feature>
    );
  }
}

export default withApi(
  withGlobalSelection(
    withSavedSearches(withOrganization(withIssueTags(withProfiler(IssueListOverview))))
  )
);

export {IssueListOverview};

// TODO(workflow): Replace PageContent with thirds body
const StyledPageContent = styled(PageContent)<{isInbox: boolean}>`
  display: flex;
  flex-direction: row;
  ${p =>
    p.isInbox &&
    css`
      background-color: ${p.theme.background};
    `}

  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    /* Matches thirds layout */
    padding: ${space(2)} ${space(2)} 0 ${space(2)};
  }
`;

const StreamContent = styled('div')<{showSidebar: boolean}>`
  width: ${p => (p.showSidebar ? '75%' : '100%')};
  transition: width 0.2s ease-in-out;

  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    width: 100%;
  }
`;

const SidebarContainer = styled('div')<{showSidebar: boolean}>`
  display: ${p => (p.showSidebar ? 'block' : 'none')};
  overflow: ${p => (p.showSidebar ? 'visible' : 'hidden')};
  height: ${p => (p.showSidebar ? 'auto' : 0)};
  width: ${p => (p.showSidebar ? '25%' : 0)};
  transition: width 0.2s ease-in-out;
  margin-left: 20px;

  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    display: none;
  }
`;

const PaginationWrapper = styled('div')`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  font-size: ${p => p.theme.fontSizeMedium};
`;

const StyledPagination = styled(Pagination)`
  margin-top: 0;
  margin-left: ${space(2)};
`;
