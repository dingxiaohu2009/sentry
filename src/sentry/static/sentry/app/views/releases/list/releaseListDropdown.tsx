import React from 'react';

import DropdownControl, {DropdownItem} from 'app/components/dropdownControl';

import {DisplayOption, StatusOption} from './utils';

type Props = {
  label: string;
  options: Record<DisplayOption, string> | Record<StatusOption, string>;
  selected: string;
  onSelect: (key: string) => void;
};

const ReleaseListDropdown = ({label: prefix, options, selected, onSelect}: Props) => {
  const optionEntries = Object.entries(options);
  const selectedLabel = optionEntries.find(([key, _value]) => key === selected)?.[1];

  return (
    <DropdownControl buttonProps={{prefix}} label={selectedLabel}>
      {optionEntries.map(([key, label]) => (
        <DropdownItem
          key={key}
          onSelect={onSelect}
          eventKey={key}
          isActive={selected === key}
        >
          {label}
        </DropdownItem>
      ))}
    </DropdownControl>
  );
};

export default ReleaseListDropdown;
