import React from 'react';
import {forceCheck} from 'react-lazyload';
import {RouteComponentProps} from 'react-router/lib/Router';
import styled from '@emotion/styled';
import pick from 'lodash/pick';

import EmptyStateWarning from 'app/components/emptyStateWarning';
import LightWeightNoProjectMessage from 'app/components/lightWeightNoProjectMessage';
import LoadingIndicator from 'app/components/loadingIndicator';
import GlobalSelectionHeader from 'app/components/organizations/globalSelectionHeader';
import PageHeading from 'app/components/pageHeading';
import Pagination from 'app/components/pagination';
import SearchBar from 'app/components/searchBar';
import {t} from 'app/locale';
import {PageContent, PageHeader} from 'app/styles/organization';
import space from 'app/styles/space';
import {GlobalSelection, Organization, Release, ReleaseStatus} from 'app/types';
import {defined} from 'app/utils';
import routeTitleGen from 'app/utils/routeTitle';
import withGlobalSelection from 'app/utils/withGlobalSelection';
import withOrganization from 'app/utils/withOrganization';
import AsyncView from 'app/views/asyncView';

import ReleaseArchivedNotice from '../detail/overview/releaseArchivedNotice';

import ReleaseCard from './releaseCard';
import ReleaseLanding from './releaseLanding';
import ReleaseListDisplayOptions from './releaseListDisplayOptions';
import ReleaseListStatusOptions from './releaseListStatusOptions';
import {DisplayOption, StatusOption} from './utils';

type RouteParams = {
  orgId: string;
};

type Props = RouteComponentProps<RouteParams, {}> & {
  organization: Organization;
  selection: GlobalSelection;
};

type State = {
  releases: Release[];
  loadingHealth: boolean;
} & AsyncView['state'];

class ReleasesList extends AsyncView<Props, State> {
  shouldReload = true;

  getTitle() {
    return routeTitleGen(t('Releases'), this.props.organization.slug, false);
  }

  getEndpoints(): ReturnType<AsyncView['getEndpoints']> {
    const {organization, location} = this.props;
    const {statsPeriod} = location.query;
    const status = this.getStatus();

    const query = {
      ...pick(location.query, [
        'project',
        'environment',
        'cursor',
        'query',
        'display',
        'healthStatsPeriod',
        'healthStat',
      ]),
      summaryStatsPeriod: statsPeriod,
      per_page: 25,
      health: 1,
      flatten: 1,
      status:
        status === StatusOption.ARCHIVED ? ReleaseStatus.Archived : ReleaseStatus.Active,
    };

    return [
      ['releasesWithHealth', `/organizations/${organization.slug}/releases/`, {query}],
    ];
  }

  onRequestSuccess({stateKey, data, jqXHR}) {
    const {remainingRequests} = this.state;

    // make sure there's no withHealth/withoutHealth race condition and set proper loading state
    if (stateKey === 'releasesWithHealth' || remainingRequests === 1) {
      this.setState({
        reloading: false,
        loading: false,
        loadingHealth: stateKey === 'releasesWithoutHealth',
        releases: data,
        releasesPageLinks: jqXHR?.getResponseHeader('Link'),
      });
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    super.componentDidUpdate(prevProps, prevState);

    if (prevState.releases !== this.state.releases) {
      /**
       * Manually trigger checking for elements in viewport.
       * Helpful when LazyLoad components enter the viewport without resize or scroll events,
       * https://github.com/twobin/react-lazyload#forcecheck
       *
       * HealthStatsCharts are being rendered only when they are scrolled into viewport.
       * This is how we re-check them without scrolling once releases change as this view
       * uses shouldReload=true and there is no reloading happening.
       */
      forceCheck();
    }
  }

  getQuery() {
    const {query} = this.props.location.query;

    return typeof query === 'string' ? query : undefined;
  }

  getDisplay(): DisplayOption {
    const {display} = this.props.location.query;

    switch (display) {
      case DisplayOption.CRASH_FREE_USERS:
        return DisplayOption.CRASH_FREE_USERS;
      default:
        return DisplayOption.CRASH_FREE_SESSIONS;
    }
  }

  getStatus(): StatusOption {
    const {status} = this.props.location.query;

    switch (status) {
      case StatusOption.ARCHIVED:
        return StatusOption.ARCHIVED;
      default:
        return StatusOption.ACTIVE;
    }
  }

  handleSearch = (query: string) => {
    const {location, router} = this.props;

    router.push({
      ...location,
      query: {...location.query, cursor: undefined, query},
    });
  };

  handleDisplay = (display: string) => {
    const {location, router} = this.props;

    router.push({
      ...location,
      query: {...location.query, cursor: undefined, display},
    });
  };

  handleStatus = (status: string) => {
    const {location, router} = this.props;

    router.push({
      ...location,
      query: {...location.query, cursor: undefined, status},
    });
  };

  shouldShowLoadingIndicator() {
    const {loading, releases, reloading} = this.state;

    return (loading && !reloading) || (loading && !releases?.length);
  }

  renderLoading() {
    return this.renderBody();
  }

  renderEmptyMessage() {
    const {location, organization} = this.props;
    const {statsPeriod} = location.query;
    const searchQuery = this.getQuery();
    const status = this.getStatus();

    if (searchQuery && searchQuery.length) {
      return (
        <EmptyStateWarning small>{`${t(
          'There are no releases that match'
        )}: '${searchQuery}'.`}</EmptyStateWarning>
      );
    }

    if (status === StatusOption.ARCHIVED) {
      return (
        <EmptyStateWarning small>
          {t('There are no archived releases.')}
        </EmptyStateWarning>
      );
    }

    if (defined(statsPeriod) && statsPeriod !== '14d') {
      return <EmptyStateWarning small>{t('There are no releases.')}</EmptyStateWarning>;
    }

    return <ReleaseLanding organization={organization} />;
  }

  renderInnerBody(activeDisplay: DisplayOption) {
    const {location, selection, organization} = this.props;
    const {releases, reloading, loadingHealth, releasesPageLinks} = this.state;

    if (this.shouldShowLoadingIndicator()) {
      return <LoadingIndicator />;
    }

    if (!releases?.length) {
      return this.renderEmptyMessage();
    }

    return (
      <React.Fragment>
        {releases.map(release => (
          <ReleaseCard
            key={`${release.version}-${release.projects[0].slug}`}
            activeDisplay={activeDisplay}
            release={release}
            orgSlug={organization.slug}
            location={location}
            selection={selection}
            reloading={reloading}
            showHealthPlaceholders={loadingHealth}
          />
        ))}
        <Pagination pageLinks={releasesPageLinks} />
      </React.Fragment>
    );
  }

  renderBody() {
    const {organization} = this.props;
    const {releases, reloading} = this.state;

    const activeDisplay = this.getDisplay();
    const activeStatus = this.getStatus();

    return (
      <GlobalSelectionHeader
        showAbsolute={false}
        timeRangeHint={t(
          'Changing this date range will recalculate the release metrics.'
        )}
      >
        <PageContent>
          <LightWeightNoProjectMessage organization={organization}>
            <StyledPageHeader>
              <PageHeading>{t('Releases')}</PageHeading>
              <SortAndFilterWrapper>
                <SearchBar
                  placeholder={t('Search')}
                  onSearch={this.handleSearch}
                  query={this.getQuery()}
                />
                <ReleaseListStatusOptions
                  selected={activeStatus}
                  onSelect={this.handleStatus}
                />
                <ReleaseListDisplayOptions
                  selected={activeDisplay}
                  onSelect={this.handleDisplay}
                />
              </SortAndFilterWrapper>
            </StyledPageHeader>

            {!reloading &&
              activeStatus === StatusOption.ARCHIVED &&
              !!releases?.length && <ReleaseArchivedNotice multi />}

            {this.renderInnerBody(activeDisplay)}
          </LightWeightNoProjectMessage>
        </PageContent>
      </GlobalSelectionHeader>
    );
  }
}

const StyledPageHeader = styled(PageHeader)`
  display: grid;
  grid-gap: ${space(2)};
  grid-template-columns: 1fr;
  justify-content: flex-start;
  margin-bottom: ${space(3)};
`;

const SortAndFilterWrapper = styled('div')`
  display: grid;
  grid-gap: ${space(2)};

  @media (min-width: ${p => p.theme.breakpoints[0]}) {
    grid-template-columns: 1fr repeat(2, auto);
  }
`;

export default withOrganization(withGlobalSelection(ReleasesList));
export {ReleasesList};
