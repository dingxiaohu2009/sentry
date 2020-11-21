import React from 'react';

import {t} from 'app/locale';

import ReleaseListDropdown from './releaseListDropdown';
import {DisplayOption} from './utils';

const displayOptions = {
  [DisplayOption.CRASH_FREE_USERS]: t('Crash Free Users'),
  [DisplayOption.CRASH_FREE_SESSIONS]: t('Crash Free Sessions'),
};

type Props = {
  selected: DisplayOption;
  onSelect: (key: string) => void;
};

function ReleaseListDisplayOptions({selected, onSelect}: Props) {
  return (
    <ReleaseListDropdown
      label={t('Display')}
      options={displayOptions}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

export default ReleaseListDisplayOptions;
