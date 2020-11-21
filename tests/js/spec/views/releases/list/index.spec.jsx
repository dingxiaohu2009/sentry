import React from 'react';

import {mountWithTheme} from 'sentry-test/enzyme';
import {initializeOrg} from 'sentry-test/initializeOrg';

import ProjectsStore from 'app/stores/projectsStore';
import ReleasesList from 'app/views/releases/list/';

describe('ReleasesList', function () {
  const {organization, routerContext, router} = initializeOrg();

  const props = {
    router,
    organization,
    selection: {projects: [2]},
    params: {orgId: organization.slug},
    location: {
      query: {
        query: 'derp',
        sort: 'crash_free_sessions',
        healthStatsPeriod: '24h',
        healthStat: 'sessions',
        somethingBad: 'XXX',
        display: 'active',
      },
    },
  };
  let wrapper, endpointMock;

  beforeEach(async function () {
    ProjectsStore.loadInitialData(organization.projects);
    endpointMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: [
        TestStubs.Release({version: '1.0.0'}),
        TestStubs.Release({version: '1.0.1'}),
        {
          ...TestStubs.Release({version: 'af4f231ec9a8'}),
          projects: [
            {
              id: 4383604,
              name: 'Sentry-IOS-Shop',
              slug: 'sentry-ios-shop',
              hasHealthData: false,
            },
          ],
        },
      ],
    });

    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/projects/',
      body: [],
    });

    wrapper = mountWithTheme(<ReleasesList {...props} />, routerContext);
    await tick();
    wrapper.update();
  });

  afterEach(function () {
    ProjectsStore.reset();
    MockApiClient.clearMockResponses();
  });

  it('renders list', function () {
    const items = wrapper.find('StyledPanel');

    expect(items).toHaveLength(3);
    expect(items.at(0).text()).toContain('1.0.0');
    expect(items.at(0).text()).toContain('User Adoption');
    expect(items.at(1).text()).toContain('1.0.1');
    expect(items.at(1).find('DailyColumn').at(1).text()).toContain('\u2014');
    expect(items.at(2).text()).toContain('af4f231ec9a8');
    expect(items.at(2).find('Header').text()).toContain('Project');
  });

  it('displays the right empty state', function () {
    let location;
    MockApiClient.addMockResponse({
      url: '/organizations/org-slug/releases/',
      body: [],
    });

    location = {query: {}};
    wrapper = mountWithTheme(
      <ReleasesList {...props} location={location} />,
      routerContext
    );
    expect(wrapper.find('StyledPanel')).toHaveLength(0);
    expect(wrapper.find('Promo').text()).toContain('Demystify Releases');

    location = {query: {statsPeriod: '30d'}};
    wrapper = mountWithTheme(
      <ReleasesList {...props} location={location} />,
      routerContext
    );
    expect(wrapper.find('StyledPanel')).toHaveLength(0);
    expect(wrapper.find('EmptyMessage').text()).toEqual('There are no releases.');

    location = {query: {query: 'abc'}};
    wrapper = mountWithTheme(
      <ReleasesList {...props} location={location} />,
      routerContext
    );
    expect(wrapper.find('EmptyMessage').text()).toEqual(
      "There are no releases that match: 'abc'."
    );
  });

  it('searches for a release', function () {
    const input = wrapper.find('input');

    expect(endpointMock).toHaveBeenCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.objectContaining({query: 'derp'}),
      })
    );

    expect(input.prop('value')).toBe('derp');

    input.simulate('change', {target: {value: 'a'}}).simulate('submit');

    expect(router.push).toHaveBeenCalledWith({
      query: expect.objectContaining({query: 'a'}),
    });
  });

  it('sorts releases', function () {
    expect(endpointMock).toHaveBeenCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.objectContaining({display: 'crash_free_sessions'}),
      })
    );

    const sortDropdown = wrapper.find('ReleaseListSortOptions').first();
    const sortOptions = sortDropdown.find('DropdownItem span');
    const sortByCrashFreeUsers = sortOptions.at(0);

    expect(sortOptions).toHaveLength(2);
    expect(sortByCrashFreeUsers.text()).toEqual('Crash Free Users');

    sortByCrashFreeUsers.simulate('click');

    expect(router.push).toHaveBeenCalledWith({
      query: expect.objectContaining({
        display: 'crash_free_users',
      }),
    });
  });

  it('displays archived releases', function () {
    const archivedWrapper = mountWithTheme(
      <ReleasesList {...props} location={{query: {status: 'archived'}}} />,
      routerContext
    );

    expect(endpointMock).toHaveBeenLastCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.objectContaining({status: 'archived'}),
      })
    );

    expect(archivedWrapper.find('ReleaseArchivedNotice').exists()).toBeTruthy();

    const statusOptions = archivedWrapper
      .find('ReleaseListStatusOptions')
      .first()
      .find('DropdownItem span');
    const statusActiveOption = statusOptions.at(0);
    const statusArchivedOption = statusOptions.at(1);

    expect(statusOptions).toHaveLength(2);
    expect(statusActiveOption.text()).toEqual('Active');
    expect(statusArchivedOption.text()).toEqual('Archived');

    statusActiveOption.simulate('click');
    expect(router.push).toHaveBeenLastCalledWith({
      query: expect.objectContaining({
        status: 'active',
      }),
    });

    expect(wrapper.find('ReleaseArchivedNotice').exists()).toBeFalsy();

    statusArchivedOption.simulate('click');
    expect(router.push).toHaveBeenLastCalledWith({
      query: expect.objectContaining({
        status: 'archived',
      }),
    });
  });

  it('calls api with only explicitly permitted query params', function () {
    expect(endpointMock).toHaveBeenCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.not.objectContaining({
          somethingBad: 'XXX',
        }),
      })
    );
  });

  it('toggles health stats chart period/subject', function () {
    expect(endpointMock).toHaveBeenCalledWith(
      '/organizations/org-slug/releases/',
      expect.objectContaining({
        query: expect.objectContaining({
          healthStatsPeriod: '24h',
          healthStat: 'sessions',
        }),
      })
    );

    const healthStatsControls = wrapper.find('DailyColumn').first();

    expect(healthStatsControls.find('Period[selected=true]').text()).toEqual('24h');
    expect(healthStatsControls.find('Title[selected=true]').text()).toEqual('Sessions');

    const period14d = healthStatsControls.find('Period[selected=false] Link').first();
    const subjectUsers = healthStatsControls.find('Title[selected=false] Link').first();

    expect(period14d.prop('to')).toEqual({
      pathname: undefined,
      query: expect.objectContaining({
        healthStatsPeriod: '14d',
      }),
    });

    expect(subjectUsers.prop('to')).toEqual({
      pathname: undefined,
      query: expect.objectContaining({
        healthStat: 'users',
      }),
    });
  });
});
