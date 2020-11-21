import React from 'react';

import {t} from 'app/locale';

import ReleaseListDropdown from './releaseListDropdown';
import {StatusOption} from './utils';

const options = {
  [StatusOption.ACTIVE]: t('Active'),
  [StatusOption.ARCHIVED]: t('Archived'),
};

type Props = {
  selected: StatusOption;
  onSelect: (key: string) => void;
};

function ReleaseListStatusOptions({selected, onSelect}: Props) {
  return (
    <ReleaseListDropdown
      label={t('Status')}
      options={options}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

export default ReleaseListStatusOptions;
