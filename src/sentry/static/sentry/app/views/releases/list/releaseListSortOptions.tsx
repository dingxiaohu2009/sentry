import React from 'react';

import {t} from 'app/locale';

import ReleaseListDropdown from './releaseListDropdown';
import {SortOption} from './utils';

const sortOptions = {
  [SortOption.DATE]: t('Date Created'),
  [SortOption.SESSIONS]: t('Total Sessions'),
  [SortOption.USERS_24_HOURS]: t('Active Users'),
  [SortOption.CRASH_FREE_USERS]: t('Crash Free Users'),
  [SortOption.CRASH_FREE_SESSIONS]: t('Crash Free Sessions'),
};

type Props = {
  selected: SortOption;
  onSelect: (key: string) => void;
};

function ReleaseListSortOptions({selected, onSelect}: Props) {
  return (
    <ReleaseListDropdown
      label={t('Sort By')}
      options={sortOptions}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

export default ReleaseListSortOptions;
